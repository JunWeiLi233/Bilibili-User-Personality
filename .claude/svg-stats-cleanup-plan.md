# SVG Stats Cleanup Plan

## Context

After debugging the "word replacing out-range" issue in `corpus-keyword-stats.svg`, two secondary problems surfaced:

1. **Donut text overflow** — The coverage label (`font-size="32"`) overflows the donut hole when coverage reaches ≥90% (8-char labels like "100.00%")
2. **JS file ambiguity** — `updateReadmeStatsGraph.js` still exists with its own `renderSvg()` that's never called, causing maintenance confusion. However, its utility functions (`buildCollectionTimeline`, `paddedTimelineMax`) are still tested.

## Fix 1: Donut Text Overflow

**File:** `python_backend/analysis/readme_stats.py`
**Lines:** 627-628

**Current code:**
```python
<text x="{cx}" y="{cy - 8}" text-anchor="middle" class="metric" font-size="32">{self._escape(label)}</text>
<text x="{cx}" y="{cy + 18}" text-anchor="middle" class="small">{self._escape(sublabel)}</text>
```

**Change to:**
```python
<text x="{cx}" y="{cy - 6}" text-anchor="middle" class="metric" font-size="26">{self._escape(label)}</text>
<text x="{cx}" y="{cy + 18}" text-anchor="middle" class="small">{self._escape(sublabel)}</text>
```

**Why:** At 32px, "100.00%" is ~128px wide. The donut hole inner diameter is 132px (2 × (78r − 12px half-stroke)). At 26px, the same text is ~104px — fits with 14px margin on each side. Y-offset adjusted from 8→6 to keep vertical centering.

## Fix 2: Clarify JS File Status

**File:** `server/scripts/updateReadmeStatsGraph.js`
**Line:** Before line 1

**Insert at top of file:**
```js
// NOTE: SVG rendering has been migrated to Python (python_backend/analysis/readme_stats.py,
// ReadmeStatsSvgRenderer). The renderSvg() and renderTimelineSvg() functions below are dead
// and should NOT be used to generate stats SVGs. The npm script `stats:update` runs the Python
// renderer. The helper functions (buildCollectionTimeline, paddedTimelineMax, etc.) remain
// active — they are tested by updateReadmeStatsGraph.test.js and used by migration parity checks.
```

Then remove or comment out the `renderSvg()` function body (lines 198-236) and `renderTimelineSvg()` function body (lines 267-317), replacing them with `throw new Error('SVG rendering migrated to Python — use npm run stats:update')`. Keep the helper functions intact.

**Why:** Prevents confusion when someone reads the JS file and sees a completely different SVG layout. Makes it clear the Python path is the active one. The helper functions are kept because they're still tested and could be useful for future parity comparisons.

## Files Changed

| File | Action |
|------|--------|
| `python_backend/analysis/readme_stats.py:627` | `font-size="32"` → `font-size="26"`, `cy-8` → `cy-6` |
| `server/scripts/updateReadmeStatsGraph.js:1` | Add deprecation header comment |
| `server/scripts/updateReadmeStatsGraph.js:198-236` | Replace `renderSvg()` body with throw |
| `server/scripts/updateReadmeStatsGraph.js:267-317` | Replace `renderTimelineSvg()` body with throw |

## Verification

```bash
# 1. Donut fix — run stats update, check SVG
npm run stats:update
# Open docs/stats/corpus-keyword-stats.svg — verify font-size="26" in donut text

# 2. JS tests still pass
node --test server/scripts/updateReadmeStatsGraph.test.js

# 3. Python stats still work
python -m python_backend.cli.readme_stats
```
