/**
 * atomicWrite.js — crash-safe atomic file writes for HTTP-server persistence.
 *
 * Writes to a temp file, fsyncs the fd, atomically renames over the target,
 * then fsyncs the parent directory. A crash after the rename cannot leave a
 * half-written or zeroed target (the failure mode that corrupted the AICU DB
 * and annotation store under concurrent writers).
 *
 * Used by routes that persist per-request (aicu-user-database.json,
 * annotation_tasks.json) where concurrent writes must not interleave.
 * Pair with an in-process mutex (promise chain) for read-modify-write
 * atomicity — the atomic write alone does not serialize the RMW.
 *
 * @module server/utils/atomicWrite
 */
import { writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { openSync, closeSync, fsyncSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Atomically write a string to `filePath`. Temp file → fsync → rename → dir fsync.
 * @param {string} filePath
 * @param {string} serialized  already-serialized content
 */
// Per-call counter guarantees a unique temp path even when many writers fire
// in the same millisecond — without it, concurrent writers using
// `${pid}.${Date.now()}.tmp` collide on the same path and one truncates the
// other's temp before rename (ENOENT).
let _writeCounter = 0;

export async function writeSerializedAtomic(filePath, serialized) {
  await mkdir(dirname(filePath), { recursive: true });
  _writeCounter += 1;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${_writeCounter}.tmp`;
  try {
    await writeFile(tempPath, serialized, 'utf8');
    // fsync the temp fd so the bytes reach stable storage before the rename.
    let fd = -1;
    try { fd = openSync(tempPath, 'r'); fsyncSync(fd); } catch { /* best-effort */ }
    finally { if (fd !== -1) { try { closeSync(fd); } catch {} } }
    await rename(tempPath, filePath);
    // fsync the parent directory so the rename's dirent update is durable too.
    let dirFd = -1;
    try { dirFd = openSync(dirname(filePath), 'r'); fsyncSync(dirFd); } catch { /* unsupported on some FS */ }
    finally { if (dirFd !== -1) { try { closeSync(dirFd); } catch {} } }
  } catch (error) {
    try { await rm(tempPath, { force: true }); } catch {}
    throw error;
  }
}

/**
 * Atomically write a JSON-serializable value (pretty-printed, trailing newline).
 * @param {string} filePath
 * @param {any} value
 */
export async function writeJsonAtomic(filePath, value) {
  await writeSerializedAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
