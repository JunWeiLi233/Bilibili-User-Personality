# Daily Harvest Pipeline

Unattended daily automation that keeps the Bilibili personality-analysis
dictionary fully covered. Each run audits the dictionary for weak/zero-evidence
terms, harvests fresh comment evidence from Bilibili, trains the dictionary, and
prunes terms that cannot be attested — so `coverageRatio` stays at `1.0` as the
dictionary evolves.

> Scope: this is a **maintenance** pipeline, not an optimization loop. Today the
> dictionary is already at 100% coverage (`server/data/keywordCoverageAudit.json`
> → `coverageRatio: 1`, `zeroEvidenceTerms: 0`). The daily job's job is to *keep*
> it there: catch new terms, refresh stale evidence, drop un-attestable ones.

---

## How it works — four layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ 4. SCHEDULE         Windows Task Scheduler                           │
│    register-daily-harvest.ps1  →  fires daily-harvest.ps1 at 03:07   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  (powershell.exe -File ...)
┌──────────────────────────────▼──────────────────────────────────────┐
│ 3. DAILY JOB        daily-harvest.ps1                      [NEW]     │
│    CWD-pin + Global mutex lock + Start-Transcript dated log          │
│    + bounded daily defaults (MaxCycles, MaxQueries)                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  (delegates all tuning)
┌──────────────────────────────▼──────────────────────────────────────┐
│ 2. TUNING WRAPPER   run-bilibili-auto-coverage.ps1        [exists]  │
│    sources set-deepseek-env.ps1, sets every rate-limit/budget env,  │
│    prints config banner, chooses engine                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  node server/scripts/...
┌──────────────────────────────▼──────────────────────────────────────┐
│ 1. ENGINE           runCoverageHarvestLoop.js             [exists]  │
│    (or runCorpusMiningLoop.js with -CorpusMining)                   │
│    resilient audit→harvest→train→prune loop: cycle retry, backoff,  │
│    checkpointed per-item state, optional watchdog                   │
└─────────────────────────────────────────────────────────────────────┘
```

Layers 1–2 already existed. This change adds **layers 3–4** (the daily wrapper
and the scheduler) without modifying the engine or its tuning surface.

### What one daily run does

```
Phase 0  (only with -CorpusMining)   offline local-corpus mine — free, no API
                                      scan local comment shards → merge evidence
                                      into the dictionary.

Phase 1+ online coverage loop, up to MaxCycles (default 5):
   ┌─ audit coverage (python coverage_audit) ── keywordCoverageAudit.json
   ├─ export priority queries for weak / zero-evidence / near-target terms
   ├─ scrape Bilibili comments + danmaku (conservative rate limiting)
   ├─ DeepSeek extraction (v4-flash, reasoning max) → evidence + sources
   ├─ train dictionary (atomic write), update harvest state (checkpointed)
   ├─ re-audit → compute coverage delta
   └─ prune exhausted terms (optional, default off)

Final   writes the coverage-loop report; exits nonzero only with -Strict
        if the coverage gate is unmet.
```

Every phase is **checkpointed per-item**, so an interruption (rate-limit, network
drop, machine reboot, manual stop) loses zero progress — the next run resumes from
the saved audit and harvest state.

---

## Prerequisites

1. **`set-deepseek-env.ps1`** at repo root (gitignored) with a real
   `DEEPSEEK_API_KEY` and `BILIBILI_COOKIE`. Copy `set-deepseek-env.example.ps1`
   and fill in real values. The cookie unblocks the Bilibili search API.
2. **Node + deps**: `npm install` (ESM runtime for the engine).
3. **Python + `python_backend` deps** (the coverage audit is Python).
4. *(Optional)* **Decodo proxy** via `set-decodo-env.ps1` for a CN residential
   exit — see `docs/PROJECT_MAP.md` / the Decodo wiring notes.

---

## Run it manually (one-off)

```powershell
# From the repo root. Sources env, locks, logs, runs 5 cycles.
.\daily-harvest.ps1

# Add Phase 0 offline mining + a tighter cycle bound.
.\daily-harvest.ps1 -CorpusMining -MaxCycles 3

# Forward any tuning flag the underlying wrapper accepts (-Strict, -PruneExhaustedAfter, ...).
.\daily-harvest.ps1 -Strict -PruneExhaustedAfter 8
```

Output is teed to `logs\harvest-YYYYMMDD.log` (gitignored via `*.log`).

> The first real run spends DeepSeek budget and takes minutes-to-hours depending
> on `MaxCycles`/`MaxQueries`. Trigger it yourself; do not let it run in CI.

---

## Register the daily schedule

From an **elevated** PowerShell at the repo root, once:

```powershell
.\register-daily-harvest.ps1                    # daily 03:07, current user
.\register-daily-harvest.ps1 -Time '06:13'      # pick another off-minute
```

Then:

```powershell
schtasks /Query /TN BilibiliDailyHarvest /V /FO LIST   # inspect
schtasks /Run  /TN BilibiliDailyHarvest                # trigger immediately
.\register-daily-harvest.ps1 -Remove                   # uninstall
```

**Default run context:** current user, runs while logged on. This is the robust
choice — it inherits the user `PATH` (so `node` / `python` resolve) and needs no
stored password. On an always-on, always-logged-in workstation it fires daily.

### Truly unattended (run whether logged on or not)

Re-register under `SYSTEM`. **Caveat:** `SYSTEM` does not see the user `PATH`, so
`node` and `python` must be installed machine-wide (on the system `PATH`) or the
task will fail at "command not found". If so:

```powershell
schtasks /Create /SC DAILY /TN BilibiliDailyHarvest /ST 03:07 `
  /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PWD\daily-harvest.ps1`"" `
  /RU SYSTEM /RL HIGHEST /F
```

No password is stored with `/RU SYSTEM`. Verify node/python are on the system
PATH with `schtasks /Run` followed by a log tail before relying on it.

---

## Configuration

Daily defaults are intentionally **bounded** so the job always terminates at a
predictable budget. Override anything by passing flags through to
`run-bilibili-auto-coverage.ps1`.

| Concern | Default | Knob |
|---|---|---|
| Cycles per run | `5` | `-MaxCycles` |
| Harvest queries / cycle (budget cap) | `12` | `-MaxQueries` |
| Phase 0 offline mining | off | `-CorpusMining` |
| Fail the run if gate unmet | off | `-Strict` |
| Drop un-attestable terms after N tries | off | `-PruneExhaustedAfter N` |
| Min coverage to pass the gate | `1.0` | `-MinCoverageRatio` |
| Crawler min delay / jitter | auto (≥2500 / ≥1500 ms) | `-CrawlerMinDelayMs`, `-CrawlerJitterMs` |
| Per-query timeout | `180s` | `-QueryTimeoutSeconds` |
| Engine model / effort | `deepseek-v4-flash` / `max` | env in `set-deepseek-env.ps1` |

The crawler is **deliberately conservative** — sequential requests, brief caching,
capped pages, cooldown on rate-limit. Do not raise concurrency or add bypass logic
without explicit instruction (see `CLAUDE.md` → Scraping & Rate Limiting).

---

## Logging & monitoring

- **Run log:** `logs\harvest-YYYYMMDD.log` — full transcript of every run.
- **Task Scheduler → "Last Run Result":** `0x0` = success; anything else, tail the
  day's log.
- **Coverage drift check** (parse the audit the loop already writes):

  ```powershell
  node -e "const c=require('./server/data/keywordCoverageAudit.json').coverage; `
    console.log('ratio', c.coverageRatio, 'weak', c.weakTerms, 'zero', c.zeroEvidenceTerms)"
  ```

  On a healthy daily run this prints `ratio 1 weak 0 zero 0`. If `weak`/`zero`
  rise (new terms added, evidence gone stale), the next harvest run chases them.

- **Coverage-loop report:** the engine writes a detailed per-cycle report path
  (see `DEFAULT_COVERAGE_LOOP_REPORT_PATH` in `server/utils/paths.js`) with deltas
  per cycle.

---

## Budget & safety

- **Bounded:** `MaxCycles` × `MaxQueries` caps each run's DeepSeek spend.
- **No overlap:** the `Global\BilibiliDailyHarvest` mutex prevents a manual run and
  a scheduled run (or two scheduled fires) from colliding on the shared dictionary
  and harvest-state files. A second run logs `SKIP: another run holds the lock` and
  exits `0`.
- **Local only:** the DeepSeek key must never leave this machine. This pipeline
  runs under Task Scheduler on the workstation, **never in CI** — GitHub Actions
  has no key, by design.
- **Resilient:** transient errors (429, 5xx, network) retry with exponential
  backoff inside each cycle; a single bad cycle is skipped, not fatal. The engine
  only stops early after several *consecutive* failed cycles (likely systemic).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Task shows "Last Run Result" ≠ `0x0` | Tail `logs\harvest-<date>.log`. Most often `set-deepseek-env.ps1` missing or key invalid. |
| `SKIP: another run holds the lock` every time | A prior run is still going, or crashed holding the mutex. A reboot clears a stuck Global mutex; or close other PowerShell sessions running the harvest. |
| `node`/`python` "command not found" under SYSTEM | SYSTEM has no user PATH — install machine-wide or run under current user instead. |
| Exit nonzero with `-Strict` | Coverage gate unmet — re-run with `-CorpusMining`, raise `-MaxCycles`, or check whether evidence sources are being blocked (cookie / proxy). |
| Coverage ratio drifting below 1.0 | Expected after adding new dictionary terms; the next run resolves them. Persistently stuck terms → consider `-PruneExhaustedAfter`. |
| Task didn't fire | Confirm the machine was on/awake at the scheduled time. `schtasks /Query /TN BilibiliDailyHarvest /V` shows "Next Run Time" / "Last Run Time". |

---

## Uninstall

```powershell
.\register-daily-harvest.ps1 -Remove          # delete the scheduled task
# Optionally remove logs:
Remove-Item -Recurse .\logs                   # logs are gitignored; safe to drop
```

`daily-harvest.ps1` and `register-daily-harvest.ps1` are tracked source files —
delete them from the repo if you want the feature fully gone.
