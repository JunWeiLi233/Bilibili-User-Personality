/**
 * Scraper Link Memory — JSON dedup store for already-analyzed links.
 *
 * Prevents re-scraping the same video, UID space, or favorite collection
 * across multiple runs of run-bilibili-video.ps1.
 *
 * Memory file: server/data/scraper_link_memory.json
 * Override path: SCRAPER_MEMORY_PATH env var (for testing)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dirname, '..', 'data', 'scraper_link_memory.json');

function resolvePath() {
  return process.env.SCRAPER_MEMORY_PATH || DEFAULT_PATH;
}

/**
 * Load the memory store. Returns a default empty structure if the file
 * doesn't exist or is corrupt.
 * @returns {{ version: number, entries: Record<string, { processedAt: string, type: string, identifier: string }> }}
 */
export function loadMemory() {
  const filePath = resolvePath();
  try {
    if (!existsSync(filePath)) {
      return { version: 1, entries: {} };
    }
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.entries) {
      return { version: 1, entries: {} };
    }
    return data;
  } catch {
    return { version: 1, entries: {} };
  }
}

/**
 * Write the memory store to disk. Creates parent directories if needed.
 * @param {object} memory
 */
export function saveMemory(memory) {
  const filePath = resolvePath();
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf8');
}

/**
 * Build the lookup key for a link type + identifier pair.
 * @param {'video'|'uid'|'favorite'} type
 * @param {string} identifier — canonical identifier (BVID, numeric UID, favorite ID)
 * @returns {string}
 */
function entryKey(type, identifier) {
  return `${type}:${identifier}`;
}

/**
 * Check whether a link has already been processed.
 * @param {'video'|'uid'|'favorite'} type
 * @param {string} identifier
 * @returns {boolean}
 */
export function isProcessed(type, identifier) {
  const memory = loadMemory();
  const key = entryKey(type, identifier);
  return key in memory.entries;
}

/**
 * Record a successfully-processed link. Saves immediately.
 * @param {'video'|'uid'|'favorite'} type
 * @param {string} identifier
 * @param {object} [metadata={}] — extra fields to store alongside the entry
 */
export function markProcessed(type, identifier, metadata = {}) {
  const memory = loadMemory();
  const key = entryKey(type, identifier);
  memory.entries[key] = {
    processedAt: new Date().toISOString(),
    type,
    identifier,
    ...metadata,
  };
  saveMemory(memory);
}

/**
 * Clear all entries from the memory store. Useful for --reset-memory.
 */
export function clearMemory() {
  saveMemory({ version: 1, entries: {} });
}
