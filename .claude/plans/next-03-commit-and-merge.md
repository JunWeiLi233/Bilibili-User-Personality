# Next 03: Commit polysemy-01 + polysemy-03, Merge to Main

**Status**: Ready | **Estimate**: ~15 min | **Depends on**: polysemy-01 ✅, polysemy-03 ✅

## Why

The current branch `feat/stop-hook-coverage-scrape-check` has accumulated ~20 files of disambiguator work across plans 01 and 03. This is production-ready code (1463 tests pass, 76/76 eval correct, disambiguator wired into commentCoverage with feature flag). Committing and merging reduces divergence risk and clears the way for polysemy-02 and scraper work.

## Concrete steps

### Step 1: Review the diff (5 min)
```bash
git diff --stat main...HEAD
git log main..HEAD --oneline
```
Verify no generated files (`server/data/deepseekKeywordDictionary.*/`, `server/data/keywordCoverage*`) are staged. Verify no secrets are in the diff.

### Step 2: Stage only the disambiguator/classifier/eval files (3 min)
```bash
git add server/data/disambiguation_rules.json
git add server/services/disambiguator.js
git add server/services/disambiguator.test.js
git add server/services/commentCoverage.js
git add server/services/contextClassifier.js
git add server/services/contextClassifier.test.js
git add server/scripts/evalPolysemy.js
git add .claude/plans/polysemy-01-pattern-coverage.md
git add .claude/plans/polysemy-03-integration-tests.md
git add .claude/plans/next-01-polysemy-02-classifier.md
git add .claude/plans/next-02-scraper-hardening.md
git add .claude/plans/next-03-commit-and-merge.md
```

### Step 3: Commit with a structured message (2 min)
```
git commit -m "feat: polysemy disambiguation — rules, integration, eval (plans 01 + 03)

- Add 15 regex rules across 8 term groups (pattern coverage gaps)
- Wire applyDisambiguation into commentCoverage.js (feature-flagged)
- Add contextAwareDisambiguate wrapper with scenario confidence bias
- Expand eval from 48 to 76 cases covering all 22+ terms
- 76/76 correct (100%), 51 disambiguator tests pass, 1463 total pass
- Feature flag: BILIBILI_DISAMBIGUATION (default on)"
```

### Step 4: Push and create PR (3 min)
```bash
git push origin feat/stop-hook-coverage-scrape-check
gh pr create --base main --title "feat: polysemy disambiguation — rules, integration, eval" --body "..."
```

### Step 5: Merge after CI passes (2 min)
```bash
gh pr merge --squash
git checkout main
git pull
```

## Pre-commit checklist
- [ ] `npm test` passes (1463 tests, 0 failures)
- [ ] `node server/scripts/evalPolysemy.js` → 76/76 correct
- [ ] `node --test server/services/disambiguator.test.js` → 51/51 pass
- [ ] `node --test server/services/contextClassifier.test.js` → 37/37 pass
- [ ] No generated files staged
- [ ] No secrets in diff
- [ ] `set-deepseek-env.ps1` not staged

## Success criteria
- PR created and merged to main
- All CI checks green
- `main` branch has the disambiguator wired in
- Ready to branch for polysemy-02 or scraper work
