export function computeTiebaScrapeHardStopMs(options = {}) {
  const maxQueries = Math.max(1, Number(options.maxQueries) || 1);
  const overallTimeoutMs = Math.max(0, Number(options.overallTimeoutMs) || 0);
  const blockCooldownMs = Math.max(0, Number(options.blockCooldownMs) || 0);
  return Math.max((overallTimeoutMs + blockCooldownMs) * maxQueries + 10000, overallTimeoutMs + 10000);
}
