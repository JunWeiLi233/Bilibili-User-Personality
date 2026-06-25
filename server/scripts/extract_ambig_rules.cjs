/**
 * Extract isAmbiguousBenignEvidenceSample rules as structured JSON.
 * Outputs a JSON array of rule objects Python can load and evaluate.
 */
const fs = require('fs');
const src = fs.readFileSync('server/services/deepseekKeywordTrainer.js', 'utf8');

// Extract the function body
const startIdx = src.indexOf('function isAmbiguousBenignEvidenceSample(term, family, sample)');
const afterStart = src.slice(startIdx + 10);
const nextFn = afterStart.search(/\nfunction \w|\nexport function/);
const fnBody = nextFn > 0 ? src.slice(startIdx, startIdx + 10 + nextFn) : src.slice(startIdx);

// Decode all \uXXXX in a string
function decode(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Parse a JS regex literal like /pattern/u or /pattern/iu into {pattern, flags}
function parseRegex(expr) {
  const m = expr.match(/^\/(.+)\/([iu]*)$/);
  if (!m) return null;
  return { pattern: decode(m[1]), caseInsensitive: m[2].includes('i') };
}

const lines = fnBody.split('\n');
const rules = [];
let currentRule = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Rule header: if (term === 'X' && family === 'Y') {
  let m = line.match(/^\s*if \(term === '(.+?)' && family === '(.+?)'\) \{/);
  if (m) {
    currentRule = {
      terms: [decode(m[1])],
      family: m[2],
      conditions: [],
      returnTrue: null,  // will be the final if(...) return true condition
    };
    continue;
  }

  // Multi-term header: if (['X','Y'].includes(term) && family === 'Z') {
  m = line.match(/^\s*if \(\[(.+?)\]\.includes\(term\) && family === '(.+?)'\) \{/);
  if (m) {
    const terms = m[1].split(',').map(t => decode(t.trim().replace(/^'|'$/g, '')));
    currentRule = {
      terms: terms,
      family: m[2],
      conditions: [],
      returnTrue: null,
    };
    continue;
  }

  // Within a rule: extract const declarations and if conditions
  if (currentRule) {
    // const name = /regex/flags.test(var);
    m = line.match(/^\s*const (\w+) = \/(.+)\/([iu]*)\.test\((\w+)\)\s*;?\s*$/);
    if (m) {
      const parsed = parseRegex('/' + m[2] + '/' + m[3]);
      if (parsed) {
        currentRule.conditions.push({
          name: m[1],
          pattern: parsed.pattern,
          caseInsensitive: parsed.caseInsensitive,
          target: m[4] === 'cleanSample' ? 'clean_sample' :
                  m[4] === 'rawContextSample' ? 'raw_context_sample' :
                  m[4] === 'contextSample' ? 'context_sample' : m[4],
        });
      }
      continue;
    }

    // const name = cleanSample === 'XXX';
    m = line.match(/^\s*const (\w+) = cleanSample === '(.+)'\s*;?\s*$/);
    if (m) {
      currentRule.conditions.push({
        name: m[1],
        type: 'equals',
        value: decode(m[2]),
      });
      continue;
    }

    // const name = cleanSample === 'XXX' || /regex/flags.test(var);
    m = line.match(/^\s*const (\w+) = cleanSample === '(.+)' \|\| (.+);\s*$/);
    if (m) {
      currentRule.conditions.push({
        name: m[1],
        type: 'equals_or_regex',
        value: decode(m[2]),
        rawExpr: m[3],
      });
      continue;
    }

    // const name = /regex/flags.test(var1) || /regex2/flags.test(var2);
    m = line.match(/^\s*const (\w+) = (.+);\s*$/);
    if (m && m[2].includes('.test(')) {
      // Complex expression — store raw
      currentRule.conditions.push({
        name: m[1],
        type: 'complex',
        rawExpr: m[2],
      });
      continue;
    }

    // if (name && !name2) return true;
    m = line.match(/^\s*if \(([^)]+)\) return true;\s*$/);
    if (m) {
      currentRule.returnTrue = m[1]
        .replace(/&&/g, ' and ')
        .replace(/\|\|/g, ' or ')
        .replace(/!/g, 'not ');
      rules.push(currentRule);
      currentRule = null;
      continue;
    }

    // Multi-line if (complex ||
    //     expression) return true;
    m = line.match(/^\s*if \(([^)]+)\)\s*$/);
    if (m) {
      currentRule._pendingIf = m[1];
      continue;
    }

    // return true; after a pending if
    if (line.trim() === 'return true;' && currentRule && currentRule._pendingIf) {
      currentRule.returnTrue = currentRule._pendingIf
        .replace(/&&/g, ' and ')
        .replace(/\|\|/g, ' or ')
        .replace(/!/g, 'not ');
      delete currentRule._pendingIf;
      rules.push(currentRule);
      currentRule = null;
      continue;
    }

    // return !name; — negated condition
    m = line.match(/^\s*return !(\w+);\s*$/);
    if (m && currentRule) {
      currentRule.returnTrue = 'not ' + m[1];
      rules.push(currentRule);
      currentRule = null;
      continue;
    }

    // return name; — direct condition (not true/false)
    m = line.match(/^\s*return (\w+);\s*$/);
    if (m && m[1] !== 'true' && m[1] !== 'false' && currentRule) {
      currentRule.returnTrue = m[1];
      rules.push(currentRule);
      currentRule = null;
      continue;
    }

    // return !cleanSample.includes('XXX');
    m = line.match(/^\s*return !cleanSample\.includes\('(.+?)'\);\s*$/);
    if (m && currentRule) {
      currentRule.conditions.push({
        name: '_term_in_sample',
        type: 'term_in_sample',
        term: decode(m[1]),
      });
      currentRule.returnTrue = 'not _term_in_sample';
      rules.push(currentRule);
      currentRule = null;
      continue;
    }

    // const name = cleanSample.includes('XXX');
    m = line.match(/^\s*const (\w+) = cleanSample\.includes\('(.+?)'\)\s*;?\s*$/);
    if (m) {
      currentRule.conditions.push({
        name: m[1],
        type: 'includes',
        value: decode(m[2]),
      });
      continue;
    }

    // const name = !cleanSample.includes('XXX');
    m = line.match(/^\s*const (\w+) = !cleanSample\.includes\('(.+?)'\)\s*;?\s*$/);
    if (m) {
      currentRule.conditions.push({
        name: m[1],
        type: 'not_includes',
        value: decode(m[2]),
      });
      continue;
    }

    // } closing brace
    if (line.trim() === '}') {
      if (currentRule && currentRule.returnTrue) {
        rules.push(currentRule);
        currentRule = null;
      }
      continue;
    }
  }
}

// Output as JSON
const output = {
  version: 1,
  ruleCount: rules.length,
  rules: rules,
};

fs.writeFileSync('server/data/ambig_benign_rules.json', JSON.stringify(output, null, 2), 'utf8');
console.log('Exported', rules.length, 'rules to server/data/ambig_benign_rules.json');
console.log('First rule:', JSON.stringify(rules[0], null, 2).slice(0, 400));
