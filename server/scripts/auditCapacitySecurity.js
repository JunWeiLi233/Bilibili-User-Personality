#!/usr/bin/env node
/**
 * auditCapacitySecurity.js — Verify harness: counts unresolved crack/leak
 * vectors under 1000+ concurrent users. Prints the unfixed count on the last
 * stdout line. Lower is better; target = 0.
 *
 * Each check statically confirms the remediation is present in the source.
 */
import { readFileSync } from 'node:fs';

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
// Strip JS comments (line + block) so audit pattern-matches hit CODE, not the
// docstring describing the fix. Conservative: removes //...EOL and /*...*/.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
const rcode = (p) => stripComments(read(p));
const AICU = rcode('server/routes/aicu.js');
const ANNOTATE = rcode('server/routes/annotate.js');
const INDEX = rcode('server/index.js');
const DEEPSEEK = rcode('server/routes/deepseek.js');
const BILIBILI = rcode('server/routes/bilibili.js');
const CRAWLER = rcode('server/services/bilibiliCrawler.js');

const findings = [];
const mark = (id, ok, detail) => { if (!ok) findings.push(`${id}: ${detail}`); };

// C1: aicu.js must use atomic write (writeJsonAtomic/atomicWrite/rename) + a mutex.
mark('C1-aicu-atomic-write',
  /writeJsonAtomic|atomicWrite|rename|withDatabaseLock|mutateUserDb/.test(AICU),
  'aicu.js plain writeFile on shared 14MB DB — concurrent /scrape corrupts + wipes it',
);
// C2a: annotate.js must use atomic rename.
mark('C2a-annotate-atomic',
  /writeJsonAtomic|atomicWrite|rename/.test(ANNOTATE) && !ANNOTATE.match(/writeFileSync\(TASKS_PATH/),
  'annotate.js saveTasks non-atomic — lost annotations + false crash-safety',
);
// C2b: annotate.js must use async fs (no sync I/O CALLS in hot path; comments ok).
mark('C2b-annotate-async-io',
  !/[^a-zA-Z]readFileSync\(|[^a-zA-Z]writeFileSync\(|[^a-zA-Z]unlinkSync\(/.test(ANNOTATE),
  'annotate.js sync I/O call in async handler — event-loop stall',
);
// C3: bodyLimit on serve().
mark('C3-body-size-limit', /bodyLimit/.test(INDEX), 'no request body-size limit — single huge POST OOMs');
// C4: /score caps input text length.
mark('C4-score-text-cap', /MAX_SCORE_TEXT|text\.slice|text\.length\s*>|\.length\s*>\s*\d/.test(DEEPSEEK),
  '/api/deepseek/score unbounded client text — CPU spin / OOM');
// C5: /semantic-match caps comments array length.
mark('C5-semantic-match-cap', /MAX_SEMANTIC|comments\.slice|comments\.length\s*>/.test(DEEPSEEK),
  '/api/deepseek/semantic-match unbounded Promise.all');
// C6: process error handlers.
mark('C6-process-error-handlers',
  INDEX.includes('unhandledRejection') && INDEX.includes('uncaughtException'),
  'no unhandledRejection/uncaughtException handler — one escaped rejection kills process',
);
// L1: gated routes (adminAuth or a shared apiAuth middleware applied).
const hasGate = (src) => /adminAuth|apiAuth|requireApiAuth/.test(src);
mark('L1-bilibili-gate', hasGate(BILIBILI), '/api/bilibili/* unauthenticated — operator session abuse');
mark('L1a-deepseek-gate', hasGate(DEEPSEEK), '/api/deepseek/* unauthenticated — credit drain + dict mutation');
mark('L1b-aicu-gate', hasGate(AICU), '/api/aicu/* unauthenticated — third-party PII + amplification');
// L2: CORS not wide-open star.
mark('L2-cors-restricted', !/app\.use\('\*', cors\(\)\)/.test(INDEX) && !/\.use\(cors\(\)\)/.test(INDEX),
  'CORS wide-open — any origin can drive every route');
// L4: operator identity redacted from logs.
mark('L4-operator-redacted', !/logged in as \$\{uname\}/.test(CRAWLER),
  'crawler logs operator uname+mid to stdout — de-anonymization');
// L6: error responses sanitized (no raw err.message / upstream-body interpolation).
mark('L6-error-sanitized',
  !/err\?\.message|err\.message|\$\{errorBody|\$\{err/.test(DEEPSEEK),
  '/api/deepseek/* echoes err.message / upstream bodies');
// L5: /config gated (if config handler present, route file must have a gate).
mark('L5-config-gated', !DEEPSEEK.includes('getDeepSeekConfig') || hasGate(DEEPSEEK),
  '/api/deepseek/config discloses baseUrl/model/keyConfigured anonymously');

console.error(`[audit] ${findings.length} unresolved of 14 checked:`);
for (const f of findings) console.error(`  - ${f}`);
console.log(findings.length);
