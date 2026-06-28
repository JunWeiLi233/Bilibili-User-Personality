// Fix indentation of composite eval section in evalPolysemy.js
const { readFileSync, writeFileSync } = require('fs');
const path = 'server/scripts/evalPolysemy.js';
let content = readFileSync(path, 'utf8');

// First, find and remove the bad indented insert
const badMarker = '\t\t// ─── Tier 1 Composite Pattern Evaluation';
const badIdx = content.indexOf(badMarker);
if (badIdx >= 0) {
  const endMarker = "console.log();\r\nconsole.log('='.repeat(80));\r\n";
  const endIdx = content.indexOf(endMarker, badIdx + 100);
  if (endIdx >= 0) {
    content = content.slice(0, badIdx - 2) + content.slice(endIdx);
    console.log('Removed bad indented insert');
  }
}

// Find the insertion point (last console.log before final '====')
const marker = "console.log();\r\nconsole.log('='.repeat(80));\r\n";
const idx = content.lastIndexOf(marker);
if (idx === -1) {
  console.error('Marker not found!');
  process.exit(1);
}

const insert = [
  '',
  '// ─── Tier 1 Composite Pattern Evaluation ──────────────────────────────────────',
  'console.log();',
  "console.log('='.repeat(80));",
  "console.log('TIER 1 COMPOSITE PATTERN EVALUATION');",
  "console.log('='.repeat(80));",
  '',
  '// Count composite firings across all standard test cases',
  'const compFired = results.filter(r => r.composite).length;',
  'const compRate = ((compFired / results.length) * 100).toFixed(1);',
  "console.log('Standard cases with composite match: ' + compFired + '/' + results.length + ' (' + compRate + '%))');",
  '',
  'if (compFired > 0) {',
  '  console.log();',
  "  console.log('Composite matches detail:');",
  '  const byComp = {};',
  '  for (const r of results) {',
  '    if (r.composite) {',
  '      if (!byComp[r.composite]) byComp[r.composite] = [];',
  '      byComp[r.composite].push(r);',
  '    }',
  '  }',
  '  for (const [compId, matches] of Object.entries(byComp)) {',
  "    console.log('  ' + compId + ': ' + matches.length + ' case(s) \\u2014 ' + matches.map(r => '[' + r.label + '] ' + r.term).join(', '));",
  '  }',
  '}',
  '',
  '// Run composite-specific test cases',
  'console.log();',
  "console.log('COMPOSITE-SPECIFIC TEST CASES:');",
  'let compCorrect = 0;',
  'let compTotal = 0;',
  'const compResultsArr = [];',
  '',
  'for (const tc of COMPOSITE_TEST_CASES) {',
  '  compTotal++;',
  '  const disamb = disambiguateTerm(tc.text, tc.term, tc.family);',
  "  const disambAction = disamb ? disamb.action : 'none';",
  "  const disambReason = disamb ? disamb.reason : 'N/A';",
  '  const compositeMatch = disamb && disamb._composite ? disamb._composite : null;',
  '',
  '  let compVerdict;',
  '  if (disambAction === tc.expected) {',
  "    compVerdict = '\\u2713 CORRECT';",
  '    compCorrect++;',
  "  } else if (disambAction === 'neutral' && tc.expected !== 'neutral') {",
  "    compVerdict = '\\u26a0 PARTIAL';",
  '  } else {',
  "    compVerdict = '\\u2717 WRONG';",
  '  }',
  '',
  '  const compFiredOk = compositeMatch === tc.compositeId;',
  "  const compMarker = compFiredOk ? ' [comp \\u2713]' : (compositeMatch ? ' [comp \\u2717 got ' + compositeMatch + ']' : ' [comp \\u2717 none]');",
  '',
  '  compResultsArr.push({ expected: tc.expected, actual: disambAction, verdict: compVerdict, compositeMatch, compFiredOk });',
  '',
  "  const V = compVerdict.startsWith('\\u2713') ? '\\u2713' : compVerdict.startsWith('\\u26a0') ? '\\u26a0' : '\\u2717';",
  "  console.log('[' + tc.label + '] ' + V + ' \"' + tc.term + '\"' + compMarker);",
  "  console.log('  \"' + tc.text.slice(0, 55) + (tc.text.length > 55 ? '...' : '') + '\"');",
  "  console.log('  Expected: ' + tc.expected + ' | Actual: ' + disambAction + ' | Reason: ' + disambReason);",
  "  console.log('  Composite expected: ' + tc.compositeId + ' | Fired: ' + (compositeMatch || 'none'));",
  "  console.log('  ' + tc.explanation);",
  '  console.log();',
  '}',
  '',
  'const compAccuracy = ((compCorrect / compTotal) * 100).toFixed(1);',
  'const compFiredCorrectly = compResultsArr.filter(r => r.compFiredOk).length;',
  "console.log('Composite case accuracy: ' + compCorrect + '/' + compTotal + ' (' + compAccuracy + '%))');",
  "console.log('Composite pattern matched correctly: ' + compFiredCorrectly + '/' + compTotal + ' (' + ((compFiredCorrectly/compTotal)*100).toFixed(1) + '%))');",
  "console.log('Overall composite firing rate (standard cases): ' + compRate + '% (target: \\u226530%)');",
  '',
  'const compTargetMet = parseFloat(compRate) >= 30;',
  "console.log('Composite firing target: ' + (compTargetMet ? '\\u2705 MET' : '\\u274c NOT MET') + ' (need \\u226530%)');",
  '',
].join('\r\n');

content = content.slice(0, idx) + insert + '\r\n' + content.slice(idx);
writeFileSync(path, content);
console.log('OK: inserted clean composite eval section');
