# Next 01: Context Classifier Hardening (polysemy-02)

**Status**: Ready | **Estimate**: ~45 min | **Depends on**: polysemy-01 ✅, polysemy-03 ✅

## Why

The disambiguator now scores 100% on 76 eval cases, and `contextAwareDisambiguate()` is wired into production. But the context classifier (`server/services/contextClassifier.js`) still mislabels ~40% of comments — it confuses taunting for praise, argument for neutral, etc. Since `contextAwareDisambiguate()` uses scenario output to bias confidence, fixing the classifier makes the production path trustworthy.

## Concrete steps

### Step 1: Expand taunting signals (15 min)
Add 15+ strong/weak patterns to `SIGNALS.taunting` in `server/services/contextClassifier.js`:
- Blame/accusation: `[你他她]{0,4}(垃圾|废物|脑残|...)`
- Authority-blame: `(策划|官方|运营).{0,4}(傻|蠢|垃圾|...)`
- Dismissive memes: `(配吗|也配|就这|急了|绷不住了|孝了|典了)`
- Exaggerated mockery: `(真有意思|可真行|挺会|好一个|好意思)`
- Mild negative: `(不太行|不怎么样|差评|劝退|失望|离谱)`

### Step 2: Add negation-aware scoring (10 min)
Before scoring, detect negation scopes (`不是...`, `没有...`) and halve the weight of positive signals inside them. Add cross-scenario suppression: when taunting ≥ 3, suppress praise by 50%.

### Step 3: Argument vs taunting tiebreaker (5 min)
When `argument` and `taunting` scores are within 2 points, prefer `taunting` (Bilibili discourse defaults to mockery, not reasoned debate).

### Step 4: Add classifier eval cases to evalPolysemy.js (10 min)
Add scenario-expected labels to existing eval cases, or a dedicated classifier eval script. Run both disambiguator and classifier evals.

### Step 5: Run validation (5 min)
```bash
node --test server/services/contextClassifier.test.js
node server/scripts/evalPolysemy.js
npm test
```

## Files to modify
- `server/services/contextClassifier.js` — expand SIGNALS.taunting, add negation pre-filter, add cross-scenario suppression, add tiebreaker
- `server/services/contextClassifier.test.js` — add test cases for new patterns

## Success criteria
| Metric | Before | Target |
|---|---|---|
| Taunting mislabeled as praise | 4+ | 0 |
| Taunting mislabeled as argument | 5+ | ≤1 |
| Scenario plausibility | ~60% | ≥85% |
| ContextClassifier tests | 37 pass | All pass |
| Disambiguator eval | 76/76 correct | 76/76 correct (no regression) |
