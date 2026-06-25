/**
 * Extract isAmbiguousBenignEvidenceSample rules as structured JSON.
 * Outputs a JSON array of rule objects Python can load and evaluate.
 *
 * Handles: multi-line consts, parenthesized OR conditions, inline regex/includes
 * in if statements, unconditional return true, and nested function calls.
 */
const fs = require('fs');
const src = fs.readFileSync('server/services/deepseekKeywordTrainer.js', 'utf8');

// Find the function body
const startIdx = src.indexOf('function isAmbiguousBenignEvidenceSample(');
const afterStart = src.slice(startIdx);
const nextFn = afterStart.slice(1).search(/\nfunction \w|\nexport function/);
const fnBody = nextFn > 0 ? afterStart.slice(0, nextFn + 1) : afterStart;
const lines = fnBody.split('\n');

// Decode all \uXXXX in a string
function decode(s) {
  if (!s) return s;
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Parse a JS regex literal like /pattern/u or /pattern/iu into {pattern, flags}
function parseRegex(expr) {
  const m = expr.match(/^\/(.+)\/([iu]*)$/);
  if (!m) return null;
  return { pattern: decode(m[1]), caseInsensitive: m[2].includes('i') };
}

// Match balanced parenthesized content
function matchParenContent(text) {
  if (!text.startsWith('(')) return null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(1, i);
    }
  }
  return null;
}

// Merge continuation lines (lines ending with || or &&)
function mergeContinuationLines(blockLines) {
  const merged = [];
  for (let i = 0; i < blockLines.length; i++) {
    let line = blockLines[i];
    while (i + 1 < blockLines.length) {
      const next = blockLines[i + 1].trim();
      if (next.startsWith('||') || next.startsWith('&&')) {
        i++;
        line += ' ' + blockLines[i].trim();
      } else {
        break;
      }
    }
    merged.push(line);
  }
  return merged;
}

// Normalize inline JS expressions in returnTrue to named conditions
// Converts /regex/flags.test(var) → synthetic condition names Python can evaluate
function normalizeInlineExpressions(conditions, returnTrue) {
  if (!returnTrue || returnTrue === 'true') return { conditions, returnTrue };

  let result = returnTrue;
  let inlineIdx = conditions.length;

  // Replace /regex/flags.test(varName) patterns
  const regexTestRe = /\/(.+?)\/([iu]*?)\.test\((\w+)\)/g;
  let m;
  while ((m = regexTestRe.exec(returnTrue)) !== null) {
    const pattern = m[1];
    const flags = m[2] || '';
    const varName = m[3];
    const condName = '_in_' + (inlineIdx++);

    const parsed = parseRegex('/' + pattern + '/' + flags);
    if (parsed) {
      conditions.push({
        name: condName,
        pattern: parsed.pattern,
        caseInsensitive: parsed.caseInsensitive,
        target: varName === 'cleanSample' ? 'clean_sample' :
                varName === 'rawContextSample' ? 'raw_context_sample' :
                varName === 'contextSample' ? 'context_sample' :
                varName === 'rawSample' ? 'raw_sample' :
                varName === 'textOutsideEmotes' ? 'text_outside_emotes' : varName,
      });
      result = result.replace(m[0], condName);
    }
  }

  // Replace cleanSample === 'XXX' patterns (inline equality)
  const equalsRe = /cleanSample\s*===\s*'(.+?)'/g;
  while ((m = equalsRe.exec(result)) !== null) {
    // Skip if this equals is inside a condition name context (already handled)
    const condName = '_in_' + (inlineIdx++);
    conditions.push({ name: condName, type: 'equals', value: decode(m[1]) });
    result = result.replace(m[0], condName);
  }

  // Replace var.includes('XXX') patterns (single-pass to avoid exec/lastIndex issues)
  result = result.replace(/(\w+)\.includes\('(.+?)'\)/g, (match, varName, value) => {
    const condName = '_in_' + (inlineIdx++);
    conditions.push({
      name: condName,
      type: 'includes',
      value: decode(value),
      target: varName === 'cleanSample' ? 'clean_sample' :
              varName === 'rawContextSample' ? 'raw_context_sample' :
              varName === 'rawSample' ? 'raw_sample' :
              varName === 'textOutsideEmotes' ? 'text_outside_emotes' :
              varName === 'contextSample' ? 'context_sample' :
              varName === 'textWithoutMentions' ? 'text_without_mentions' : varName,
    });
    return condName;
  });

  return { conditions, returnTrue: result };
}

// Extract conditions and returnTrue from a rule block
function extractRule(blockLines) {
  const merged = mergeContinuationLines(blockLines);
  const conditions = [];
  let returnTrue = null;

  for (let i = 0; i < merged.length; i++) {
    const line = merged[i];

    // --- Const declarations ---

    // const name = /regex/flags.test(var);
    let m = line.match(/^\s*const (\w+) = \/(.+)\/([iu]*)\.test\((\w+)\)\s*;?\s*$/);
    if (m) {
      const parsed = parseRegex('/' + m[2] + '/' + m[3]);
      if (parsed) {
        conditions.push({
          name: m[1],
          pattern: parsed.pattern,
          caseInsensitive: parsed.caseInsensitive,
          target: m[4] === 'cleanSample' ? 'clean_sample' :
                  m[4] === 'rawContextSample' ? 'raw_context_sample' :
                  m[4] === 'contextSample' ? 'context_sample' :
                  m[4] === 'rawSample' ? 'raw_sample' :
                  m[4] === 'textOutsideEmotes' ? 'text_outside_emotes' : m[4],
        });
      }
      continue;
    }

    // const name = cleanSample === 'XXX';
    m = line.match(/^\s*const (\w+) = cleanSample === '(.+)'\s*;?\s*$/);
    if (m) {
      conditions.push({ name: m[1], type: 'equals', value: decode(m[2]) });
      continue;
    }

    // const name = cleanSample === 'XXX' || expr;
    m = line.match(/^\s*const (\w+) = cleanSample === '(.+)' \|\| (.+);\s*$/);
    if (m) {
      conditions.push({ name: m[1], type: 'equals_or_regex', value: decode(m[2]), rawExpr: m[3] });
      continue;
    }

    // const name = cleanSample.includes('XXX');
    m = line.match(/^\s*const (\w+) = cleanSample\.includes\('(.+?)'\)\s*;?\s*$/);
    if (m) {
      conditions.push({ name: m[1], type: 'includes', value: decode(m[2]) });
      continue;
    }

    // const name = !cleanSample.includes('XXX');
    m = line.match(/^\s*const (\w+) = !cleanSample\.includes\('(.+?)'\)\s*;?\s*$/);
    if (m) {
      conditions.push({ name: m[1], type: 'not_includes', value: decode(m[2]) });
      continue;
    }

    // const name = rawSample === 'XXX';
    m = line.match(/^\s*const (\w+) = rawSample === '(.+)'\s*;?\s*$/);
    if (m) {
      conditions.push({ name: m[1], type: 'equals_raw', value: decode(m[2]) });
      continue;
    }

    // const name = /regex/flags.test(var1) || /regex2/flags.test(var2);
    // (complex multi-regex const — split into named sub-conditions)
    m = line.match(/^\s*const (\w+) = (.+);\s*$/);
    if (m && m[2].includes('.test(')) {
      const expr = m[2];
      const name = m[1];

      // Try to split on ||
      const orParts = expr.split(/\s*\|\|\s*/);
      if (orParts.length > 1) {
        const subConditions = [];
        let allParsed = true;
        for (let pi = 0; pi < orParts.length; pi++) {
          const andParts = orParts[pi].split(/\s*&&\s*/);
          for (let ai = 0; ai < andParts.length; ai++) {
            const ap = andParts[ai].trim();
            const rm = ap.match(/^\/(.+)\/([iu]*)\.test\((\w+)\)$/);
            if (rm) {
              const parsed = parseRegex('/' + rm[1] + '/' + rm[2]);
              if (parsed) {
                const subName = name + '_p' + pi + (andParts.length > 1 ? 'a' + ai : '');
                subConditions.push({
                  sub: name,
                  name: subName,
                  pattern: parsed.pattern,
                  caseInsensitive: parsed.caseInsensitive,
                  target: rm[3] === 'cleanSample' ? 'clean_sample' :
                          rm[3] === 'rawContextSample' ? 'raw_context_sample' :
                          rm[3] === 'rawSample' ? 'raw_sample' :
                          rm[3] === 'contextSample' ? 'context_sample' :
                          rm[3] === 'textOutsideEmotes' ? 'text_outside_emotes' : rm[3],
                });
              } else { allParsed = false; }
            } else { allParsed = false; }
          }
        }
        if (allParsed && subConditions.length > 0) {
          for (const sc of subConditions) conditions.push(sc);
          conditions.push({
            name: name,
            type: 'composite',
            parts: subConditions.map(sc => sc.name),
            operator: expr.includes('||') ? 'or' : 'and',
          });
          continue;
        }
      }

      // Fallback: store as complex
      conditions.push({ name: m[1], type: 'complex', rawExpr: expr });
      continue;
    }

    // --- Return patterns ---

    // if (isVideoContextSample(sample)) return true;
    m = line.match(/^\s*if \(isVideoContextSample\(sample\)\)\s+return true;\s*$/);
    if (m) {
      conditions.push({name: '_is_video_context', type: 'function_call', function: 'isVideoContextSample'});
      returnTrue = '_is_video_context';
      break;
    }

    // if (cleanSample.includes('XXX')) return true;
    m = line.match(/^\s*if \(cleanSample\.includes\('(.+?)'\)\)\s+return true;\s*$/);
    if (m) {
      const condName = '_term_in_sample';
      conditions.push({name: condName, type: 'includes', value: decode(m[1])});
      returnTrue = condName;
      break;
    }

    // if (expr) return true;  — with balanced paren matching
    m = line.match(/^\s*if (\(.+\))\s+return true;\s*$/);
    if (m) {
      const inner = matchParenContent(m[1]);
      if (inner !== null) {
        returnTrue = inner
          .replace(/\s*&&\s*/g, ' and ')
          .replace(/\s*\|\|\s*/g, ' or ')
          .replace(/!/g, 'not ');
        break;
      }
      // Fallback: simple [^)]+ match for if(name) return true;
      const simpleMatch = line.match(/^\s*if \(([^)]+)\) return true;\s*$/);
      if (simpleMatch) {
        returnTrue = simpleMatch[1]
          .replace(/\s*&&\s*/g, ' and ')
          .replace(/\s*\|\|\s*/g, ' or ')
          .replace(/!/g, 'not ');
        break;
      }
    }

    // Multi-line if (condition) — capture condition, expect return true on next line
    m = line.match(/^\s*if (\(.+\))\s*$/);
    if (m) {
      const inner = matchParenContent(m[1]);
      if (inner !== null) {
        for (let j = i + 1; j < Math.min(i + 5, merged.length); j++) {
          if (merged[j].trim() === 'return true;') {
            returnTrue = inner
              .replace(/\s*&&\s*/g, ' and ')
              .replace(/\s*\|\|\s*/g, ' or ')
              .replace(/!/g, 'not ');
            break;
          }
          if (merged[j].trim() && !merged[j].trim().startsWith('//')) break;
        }
        if (returnTrue) break;
      }
    }

    // return true; (possibly after a multi-line if captured above, or unconditional)
    if (line.trim() === 'return true;') {
      if (i > 0) {
        const prevLine = merged[i - 1].trim();
        const prevIf = prevLine.match(/^\s*if (\(.+\))\s*$/);
        if (prevIf) {
          const inner = matchParenContent(prevIf[1]);
          if (inner !== null) {
            returnTrue = inner
              .replace(/\s*&&\s*/g, ' and ')
              .replace(/\s*\|\|\s*/g, ' or ')
              .replace(/!/g, 'not ');
            break;
          }
        }
      }
      returnTrue = 'true';
      break;
    }

    // return !name;
    m = line.match(/^\s*return !(\w+);\s*$/);
    if (m && m[1] !== 'true' && m[1] !== 'false') {
      returnTrue = 'not ' + m[1];
      break;
    }

    // return name;
    m = line.match(/^\s*return (\w+);\s*$/);
    if (m && m[1] !== 'true' && m[1] !== 'false') {
      returnTrue = m[1];
      break;
    }

    // return !cleanSample.includes('XXX');
    m = line.match(/^\s*return !cleanSample\.includes\('(.+?)'\);\s*$/);
    if (m) {
      const condName = '_term_in_sample';
      conditions.push({ name: condName, type: 'term_in_sample', term: decode(m[1]) });
      returnTrue = 'not ' + condName;
      break;
    }

    // return !rawSample.includes('XXX');
    m = line.match(/^\s*return !rawSample\.includes\('(.+?)'\);\s*$/);
    if (m) {
      const condName = '_term_in_raw_sample';
      conditions.push({ name: condName, type: 'term_in_raw_sample', term: decode(m[1]) });
      returnTrue = 'not ' + condName;
      break;
    }
  }

  return { conditions, returnTrue };
}

// Main parsing: collect blocks between rule headers and their closing braces
const rules = [];
let currentRule = null;  // { terms, family, blockLines }
let ruleDepth = 0;       // brace depth within current rule (0 = outside any rule)

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Rule header: if (term === 'X' && family === 'Y') {
  let m = line.match(/^\s*if \(term === '(.+?)' && family === '(.+?)'\) \{/);
  if (m) {
    // If we were already in a rule without capturing returnTrue, discard it
    if (currentRule && !currentRule._hasReturn) {
      // ignored
    }
    currentRule = { terms: [decode(m[1])], family: m[2], blockLines: [] };
    ruleDepth = 1;  // The header's { opened depth
    continue;
  }

  // Multi-term header: if (['X','Y'].includes(term) && family === 'Z') {
  m = line.match(/^\s*if \(\[(.+?)\]\.includes\(term\) && family === '(.+?)'\) \{/);
  if (m) {
    if (currentRule && !currentRule._hasReturn) {
      // ignored
    }
    const terms = m[1].split(',').map(t => decode(t.trim().replace(/^'|'$/g, '')));
    currentRule = { terms, family: m[2], blockLines: [] };
    ruleDepth = 1;
    continue;
  }

  // Multi-term + multi-family header: if (['X','Y'].includes(term) && (family === 'A' || family === 'B')) {
  m = line.match(/^\s*if \(\[(.+?)\]\.includes\(term\) && \(family === '(.+?)' \|\| family === '(.+?)'\)\) \{/);
  if (m) {
    if (currentRule && !currentRule._hasReturn) {
      // ignored
    }
    const terms = m[1].split(',').map(t => decode(t.trim().replace(/^'|'$/g, '')));
    currentRule = { terms, family: m[2], _multiFamily: m[3], blockLines: [] };
    ruleDepth = 1;
    continue;
  }

  if (currentRule) {
    currentRule.blockLines.push(line);

    // Track brace depth for the block
    for (const ch of line) {
      if (ch === '{') ruleDepth++;
      if (ch === '}') ruleDepth--;
    }

    if (ruleDepth <= 0) {
      // Block complete — extract conditions and return
      let { conditions, returnTrue } = extractRule(currentRule.blockLines);
      if (returnTrue) {
        const normalized = normalizeInlineExpressions(conditions, returnTrue);
        const baseRule = {
          terms: currentRule.terms,
          conditions: normalized.conditions,
          returnTrue: normalized.returnTrue,
        };
        rules.push({ ...baseRule, family: currentRule.family });
        // Emit a second rule for multi-family headers
        if (currentRule._multiFamily) {
          rules.push({ ...baseRule, family: currentRule._multiFamily });
        }
      }
      currentRule = null;
    }
  }
}

// Deduplicate by term+family (keep first)
const seen = new Set();
const deduped = [];
for (const rule of rules) {
  let duped = false;
  for (const term of rule.terms) {
    const key = term + '|' + rule.family;
    if (seen.has(key)) { duped = true; break; }
  }
  if (!duped) {
    for (const term of rule.terms) seen.add(term + '|' + rule.family);
    deduped.push(rule);
  }
}

// Output as JSON
const output = {
  version: 2,
  ruleCount: deduped.length,
  rules: deduped,
};

fs.writeFileSync('server/data/ambig_benign_rules.json', JSON.stringify(output, null, 2), 'utf8');
console.log('Exported', deduped.length, 'rules (', rules.length, 'before dedup) to server/data/ambig_benign_rules.json');
