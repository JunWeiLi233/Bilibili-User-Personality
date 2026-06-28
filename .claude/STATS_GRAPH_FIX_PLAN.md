# Stats Graph Fix Plan

> Generated 2026-06-28 after analyzing current SVGs + generator code.

## Problems Identified

### Graph 1: `corpus-keyword-stats.svg` — "Corpus Collection + Keyword Analysis"

| # | Problem | Root Cause |
|---|---------|-----------|
| 1 | **Redundant data display** | Same 3 numbers shown twice: hero cards AND bar chart. Competing for attention. |
| 2 | **Keywords bar invisible** | 1,669 / 153,875 = 1.1% → rendered as 5px bar. Unreadable. |
| 3 | **No coverage visualization** | Most important metric (89.10% coverage) buried as text-only footer. |
| 4 | **Unnormalized bars** | Comments (25K) and danmaku (154K) share one scale → Comments bar looks like a sliver. |
| 5 | **No delta/trend** | Static snapshot. Cannot tell if things improved or degraded since last run. |
| 6 | **Missing weak-terms context** | "182 weak terms" shown without target (0) or trend arrow. |

### Graph 2: `corpus-growth-timeline.svg` — "Corpus Growth Over Time"

| # | Problem | Root Cause |
|---|---------|-----------|
| 1 | **456-point smear** | 456 timeline points crammed into ~748px → 1.6px spacing → thick opaque smear, no visible trend. |
| 2 | **Comments line is a flatline** | Comments (25K max) vs Y-axis (200K max) → Comments line barely deviates from bottom. |
| 3 | **Total line hidden** | Total sits between Comments and Danmaku lines. Danmaku = 86% of total, so Total ≈ Danmaku visually. |
| 4 | **Only 2 days of data** | X-axis range: 06-17 03:59 → 06-19 06:57. Timeline over hours, not days/weeks. |
| 5 | **No coverage timeline** | Most important trend (coverage ratio over time) not tracked at all. |
| 6 | **Raw-number Y-axis labels** | 0, 50000, 100000, 150000, 200000 — hard to parse quickly. |
| 7 | **Tieba data still loaded** | `_payload()` reads `tiebaKeywordCorpus.json` (defunct, 40 records). Inflates source count. |

---

## Proposed Redesign

### Graph 1 → "Dictionary Coverage Dashboard" (single SVG)

Replace hero-cards + bar-chart redundancy with a **3-panel dashboard layout**:

```
┌──────────────────────────────────────────────────────┐
│  Corpus Collection + Keyword Analysis                 │
│  auto-generated 2026-06-28                            │
├─────────────────┬────────────────┬───────────────────┤
│                 │                │                   │
│   Coverage      │  Weak Terms    │  Evidence Deficit │
│   ████████░░    │               │                   │
│   89.10%        │  182           │  351              │
│   (donut gauge) │  remaining     │  gap to close     │
│                 │  ↓ target: 0   │                   │
├─────────────────┴────────────────┴───────────────────┤
│  📊 25,753 comments  │  🎬 153,875 danmaku  │  📖 1,669 terms  │
│  (compact stat row)                                   │
└──────────────────────────────────────────────────────┘
```

**Key changes:**
- Coverage ratio gets a **donut/progress-ring gauge** — most prominent element
- Weak terms + evidence deficit as **compact metric tiles** with target
- Raw counts (comments, danmaku, terms) move to a **single compact row** at bottom
- Remove the unnormalized bar chart entirely

### Graph 2 → "Corpus Growth Timeline" (single SVG)

Replace 456-point polylines with **downsampled + dual-scale chart**:

```
┌──────────────────────────────────────────────────────┐
│  Corpus Growth Over Time                              │
│  auto-generated 2026-06-28                            │
│                                                       │
│  200K ┤                                    ╭─ Total   │
│       │                              ╭─────╯           │
│  150K ┤                       ╭──────╯                 │
│       │                ╭──────╯     Danmaku            │
│  100K ┤         ╭──────╯                               │
│       │  ╭──────╯                                       │
│   50K ┤──╯                                              │
│       │                                                 │
│    0K ┼────┬────┬────┬────┬────┬────┬────               │
│       Jun 17    Jun 18    Jun 19    Jun 20             │
│                                                       │
│  ── Total 179,628  ── Danmaku 153,875                │
│  ── Comments 25,753  (right-axis, 0–30K scale)       │
└──────────────────────────────────────────────────────┘
```

**Key changes:**
- **Downsample** 456 points → ~30–50 key milestones (one per significant batch, or one per ~10 runs)
- **Dual Y-axis**: left = danmaku/total (0–200K), right = comments (0–30K) so Comments line is visible
- Remove Total line (it's redundant when Danmaku = 86% of Total) OR render Total as a subtle dashed line
- **Human-readable Y labels**: "0K", "50K", "100K", "150K", "200K"
- Show full date range properly (should cover actual calendar span, not just 2 days)

---

## Implementation Steps

All changes are in **one file**: `python_backend/analysis/readme_stats.py` — the `ReadmeStatsSvgRenderer` class.

### Step 1: Remove Tieba data from payload (5 min)

**File:** `python_backend/analysis/readme_stats.py`, method `_payload()` (line 426-441)

Remove the Tieba corpus source line:
```python
# Remove:
tieba = CorpusLoader(data_dir / "tiebaKeywordCorpus.json", fallback={"comments": [], "runs": []}).load()
# and its source entry:
{"name": "Tieba corpus", "comments": tieba.comments, "runs": tieba.runs},
```

This also fixes the stale "Tieba corpus" source (40 records) showing in stats.

### Step 2: Redesign `render_summary_svg()` (20 min)

**File:** `python_backend/analysis/readme_stats.py`, method `render_summary_svg()` (lines 492-530)

Replace the current hero-cards + bar-chart layout with:
1. **Coverage donut gauge** (center-left, ~180px SVG arc): shows 89.10% fill with large centered text
2. **Weak terms + Evidence deficit tiles** (right side, two compact cards)
3. **Compact stat row** (bottom): 3 small labeled numbers for comments/danmaku/terms

Implementation approach for donut: SVG `circle` with `stroke-dasharray` — standard technique.
```python
# Donut gauge helper
def _donut_gauge(self, cx, cy, r, ratio, label, color, sublabel):
    circumference = 2 * math.pi * r
    dash = ratio * circumference
    return f"""<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#e8e1d2" stroke-width="24"/>
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" stroke-width="24"
      stroke-dasharray="{dash:.1f} {circumference - dash:.1f}" stroke-linecap="round"
      transform="rotate(-90 {cx} {cy})"/>
    <text x="{cx}" y="{cy - 8}" text-anchor="middle" class="metric" font-size="32">{label}</text>
    <text x="{cx}" y="{cy + 18}" text-anchor="middle" class="small">{sublabel}</text>"""
```

### Step 3: Redesign `render_timeline_svg()` (25 min)

**File:** `python_backend/analysis/readme_stats.py`, method `render_timeline_svg()` (lines 532-576)

Changes:
1. **Downsample points**: Add `_downsample_points()` — take every Nth point (N = max(1, len(points) // 50)) plus always include first and last
2. **Dual Y-axis**: Add right Y-axis for Comments scale (0–30K). Add left axis labels in "K" format.
3. **Drop Total line** (Danmaku dominates it, making it redundant). Or keep as a subtle dashed background line.
4. **Add axis labels**: "Comments (right scale)" and "Danmaku (left scale)" in legend.

```python
def _downsample_points(self, points, target=50):
    if len(points) <= target:
        return points
    step = max(1, len(points) // target)
    result = points[::step]
    if result[-1] != points[-1]:
        result.append(points[-1])
    return result

def _format_k(self, value):
    n = int(_number(value))
    if n >= 1000:
        return f"{n // 1000}K"
    return str(n)
```

### Step 4: Regenerate and verify (5 min)

```powershell
npm run stats:update
```

Then view `docs/stats/corpus-keyword-stats.svg` and `docs/stats/corpus-growth-timeline.svg` in a browser/image viewer to verify:
- Coverage donut renders correctly
- Timeline lines are distinguishable
- No rendering artifacts

### Step 5: Run tests to confirm no regressions (2 min)

```powershell
npm run python:test
```

---

## What NOT to change

- **Color palette**: The vintage warm scheme (#f7f0df, #27231c, #8c5f32, #3f7558) is intentional and distinctive. Keep it.
- **SVG dimensions**: 920×430 fits README width well. Keep.
- **Font choices**: Georgia titles + monospace data is a deliberate style choice.
- **Data pipeline**: `ReadmeStatsBuilder.build_from_payload()` and `ReadmeStatsRepositoryUpdater` logic is correct — only the renderer needs work.
- **JSON output**: The `corpus-keyword-stats.json` and `corpus-growth-timeline.json` files are fine as-is.

---

## Estimated Total: ~1 hour

| Step | Time |
|------|------|
| Remove Tieba from payload | 5 min |
| Redesign summary SVG (donut + tiles) | 20 min |
| Redesign timeline SVG (downsample + dual-scale) | 25 min |
| Regenerate + verify | 5 min |
| Run tests | 2 min |
