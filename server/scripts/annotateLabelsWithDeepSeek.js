#!/usr/bin/env node
/**
 * DeepSeek Annotation Script — Ziegenbein 4-Axis Protocol
 *
 * Annotates each comment in .claude/annotation_data/labels_500.json using
 * the DeepSeek API as a trained annotator following the Ziegenbein et al.
 * (2023) 4-category classification framework.
 *
 * Usage:
 *   node server/scripts/annotateLabelsWithDeepSeek.js --annotator A1
 *   node server/scripts/annotateLabelsWithDeepSeek.js --annotator A2 --variant strict
 *   node server/scripts/annotateLabelsWithDeepSeek.js --annotator A1 --batch-size 20 --start 0
 *
 * Options:
 *   --annotator <id>   A1 or A2 (required)
 *   --variant <type>   "default" or "strict" (default: "default")
 *   --batch-size <n>   Number of comments per batch (default: 20)
 *   --start <n>        Start index (default: 0, for resume)
 *   --input <path>     Input file (default: .claude/annotation_data/labels_500.json)
 *   --output <path>    Output file (default: same as input, overwrites)
 *
 * Ziegenbein Framework:
 *   Axes: toxicEmotions, missingCommitment, missingIntelligibility, otherReasons
 *   Rating: 0 = absent, 1 = present, 2 = strongly present
 *   gangjing_subtypes: from Chen Yansen (2020) 5-type classification
 *
 * References:
 *   - Ziegenbein et al. (2023). ACL 2023.
 *   - Chen Yansen (2020). "5 Types of Gangjing."
 *
 * Environment:
 *   DEEPSEEK_API_KEY (required)
 *   DEEPSEEK_BASE_URL (default: https://api.deepseek.com)
 *   DEEPSEEK_MODEL (default: deepseek-v4-flash for light annotation)
 *   DEEPSEEK_ANNOTATION_EFFORT (default: low for fast annotation)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CWD = process.cwd();

// ——— CLI args ———
function parseArgs(argv) {
  const args = { annotator: null, variant: 'default', batchSize: 20, start: 0, input: null, output: null, model: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--annotator': args.annotator = argv[++i]; break;
      case '--variant': args.variant = argv[++i]; break;
      case '--batch-size': args.batchSize = parseInt(argv[++i], 10) || 20; break;
      case '--start': args.start = parseInt(argv[++i], 10) || 0; break;
      case '--input': args.input = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
      case '--model': args.model = argv[++i]; break;
    }
  }
  return args;
}

// ——— Multi-provider API routing ———
function detectProvider(model) {
  if (!model) return 'deepseek';
  if (model.startsWith('claude-')) return 'claude';
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
  return 'deepseek';
}

function resolveModel(args) {
  if (args.model) return args.model;
  return process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
}

// DeepSeek
const DEEPSEEK_BASE_URL = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

// Anthropic (Claude)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_BASE_URL = String(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');

function getApiKey(provider) {
  switch (provider) {
    case 'claude': return ANTHROPIC_API_KEY;
    case 'openai': return OPENAI_API_KEY;
    default: return DEEPSEEK_API_KEY;
  }
}

async function deepseekCompletion(model, messages, options = {}) {
  if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');
  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? 1024,
    response_format: options.responseFormat || undefined,
  };
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`DeepSeek API error ${response.status}: ${errorText.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function claudeCompletion(model, messages, systemPrompt, options = {}) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  // Convert from OpenAI-style messages to Anthropic format
  const systemMessages = [];
  const conversationMessages = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg.content);
    } else {
      conversationMessages.push({ role: msg.role, content: msg.content });
    }
  }
  const body = {
    model,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.1,
    system: [...systemMessages, systemPrompt].filter(Boolean).join('\n\n') || undefined,
    messages: conversationMessages,
  };
  const response = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Claude API error ${response.status}: ${errorText.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.content?.find((c) => c.type === 'text')?.text || '';
}

async function openaiCompletion(model, messages, options = {}) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? 1024,
    response_format: options.responseFormat || undefined,
  };
  const response = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI API error ${response.status}: ${errorText.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function chatCompletion(model, messages, options = {}) {
  const provider = detectProvider(model);
  // Validate API key
  const key = getApiKey(provider);
  if (!key) throw new Error(`${provider.toUpperCase()}_API_KEY not set — cannot call ${model}`);

  switch (provider) {
    case 'claude':
      return claudeCompletion(model, messages, options.systemPrompt || '', options);
    case 'openai':
      return openaiCompletion(model, messages, options);
    default:
      return deepseekCompletion(model, messages, options);
  }
}

// ——— Prompt Templates ———
const ZIEGENBEIN_AXES = [
  { key: 'toxicEmotions', label: '情绪过激', desc: '情绪化表达，包括愤怒、讽刺、辱骂、人身攻击等' },
  { key: 'missingCommitment', label: '回避讨论', desc: '回避实质性讨论，包括转移话题、重复无意义内容、拒绝提供证据等' },
  { key: 'missingIntelligibility', label: '逻辑混乱', desc: '表达混乱难以理解，包括自相矛盾、逻辑谬误、绝对化断言等' },
  { key: 'otherReasons', label: '其他问题', desc: '其他影响讨论质量的问题，如刷屏、无关广告、恶意引战等' },
];

const GANGJING_SUBTYPES = [
  '偷换概念型',   // Equivocation / moving goalposts
  '反智型',       // Anti-intellectualism
  '双标型',       // Double standards
  '情绪宣泄型',   // Emotional venting
  '人身攻击型',   // Ad hominem
];

function buildSystemPrompt(annotatorId, variant) {
  const base = `You are a trained annotator (${annotatorId}) for a Chinese-language argumentative discourse analysis project following the Ziegenbein et al. (2023) 4-category classification framework.

Your task: Annotate each Chinese comment across 4 axes:

1. toxicEmotions (情绪过激): Emotional toxicity — anger, sarcasm, insults, ad hominem attacks
2. missingCommitment (回避讨论): Discussion avoidance — topic-shifting, refusing to provide evidence, repetitive non-substantive content
3. missingIntelligibility (逻辑混乱): Logical incoherence — self-contradiction, logical fallacies, absolute/extreme assertions without reasoning
4. otherReasons (其他问题): Other discourse issues — spam, off-topic ads, intentional trolling/flame-baiting

Rating scale for each axis:
- 0 = absent (not present in the comment)
- 1 = present (somewhat evident in the comment)
- 2 = strongly present (clearly and prominently evident)

Also identify any applicable gangjing subtypes from Chen Yansen (2020):
${GANGJING_SUBTYPES.map(t => `- ${t}`).join('\n')}

Output ONLY valid JSON with this exact structure (no markdown, no explanation):
{"toxicEmotions": <0|1|2>, "missingCommitment": <0|1|2>, "missingIntelligibility": <0|1|2>, "otherReasons": <0|1|2>, "gangjing_subtypes": [<applicable types>], "notes": "<brief justification in Chinese>"}`;

  switch (variant) {
    case 'strict':
      return base + '\n\nIMPORTANT (strict mode): Only mark an axis as 1 or 2 when there is CLEAR and UNAMBIGUOUS evidence in the text. When in doubt, default to 0 (absent). Be conservative.';

    case 'calibrated':
      return base + '\n\nIMPORTANT (calibrated evidence-based mode): Mark an axis as 1 ONLY when you can point to SPECIFIC WORDS or phrases in the comment as evidence. For each score of 1 or 2, include the specific Chinese word(s) in your notes that justify the rating. If you cannot quote a specific word or phrase from the comment as evidence, mark 0 (absent). This is NOT about being conservative — it is about being EVIDENCE-BASED. Even a single clearly argumentative word is sufficient for a score of 1.';

    case 'consensus':
      return base + '\n\nIMPORTANT (consensus reconciliation mode): You are the tie-breaking third annotator. You will be shown the ratings from two other independent annotators (A1 and A2). Review both ratings carefully. Your job is to: (1) provide your own independent assessment of the comment, (2) if A1 and A2 disagree on an axis, explain which rating you believe is more accurate and why, referencing specific words in the comment as evidence, (3) provide your final rating. You are NOT required to agree with either A1 or A2 — use your own judgment.';

    default:
      return base + '\n\nNOTE: Use the full 0-2 range comfortably. A score of 1 means "somewhat present" — use it liberally for borderline cases.';
  }
}

function buildUserMessage(commentText, variant, a1Rating, a2Rating) {
  if (variant === 'consensus' && a1Rating && a2Rating) {
    const fmtAxis = (axis, label) => {
      const a1 = a1Rating[axis] ?? '?';
      const a2 = a2Rating[axis] ?? '?';
      return `  ${label} (${axis}): A1=${a1}, A2=${a2}`;
    };
    return `Annotate this Chinese comment. A1 and A2 have already rated it:

${fmtAxis('toxicEmotions', '情绪过激')}
${fmtAxis('missingCommitment', '回避讨论')}
${fmtAxis('missingIntelligibility', '逻辑混乱')}
${fmtAxis('otherReasons', '其他问题')}

A1 notes: "${String(a1Rating.notes || '(none)').slice(0, 200)}"
A2 notes: "${String(a2Rating.notes || '(none)').slice(0, 200)}"

Provide your INDEPENDENT rating and reconcile any disagreements:

"""${commentText}"""`;
  }
  return `Annotate this Chinese comment:\n\n"""${commentText}"""`;
}

// ——— Parse JSON response from DeepSeek ———
function parseAnnotation(rawContent, annotatorId) {
  // Strip markdown code fences if present
  let clean = rawContent.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Try to extract JSON object
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON object found in response: ${clean.slice(0, 200)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Invalid JSON in response: ${jsonMatch[0].slice(0, 200)}`);
  }

  // Validate and normalize
  return {
    annotator_id: annotatorId,
    toxicEmotions: clamp(Number(parsed.toxicEmotions) || 0, 0, 2),
    missingCommitment: clamp(Number(parsed.missingCommitment) || 0, 0, 2),
    missingIntelligibility: clamp(Number(parsed.missingIntelligibility) || 0, 0, 2),
    otherReasons: clamp(Number(parsed.otherReasons) || 0, 0, 2),
    gangjing_subtypes: Array.isArray(parsed.gangjing_subtypes) ? parsed.gangjing_subtypes : [],
    notes: String(parsed.notes || '').slice(0, 200),
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// ——— Delay helper ———
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ——— Main ———
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.annotator || !['A1', 'A2', 'A3'].includes(args.annotator)) {
    console.error('ERROR: --annotator A1, A2, or A3 is required');
    process.exit(1);
  }

  if (!['default', 'strict', 'calibrated', 'consensus'].includes(args.variant)) {
    console.error('ERROR: --variant must be default, strict, calibrated, or consensus');
    process.exit(1);
  }

  if (args.annotator === 'A3' && args.variant !== 'consensus') {
    console.error('ERROR: A3 annotator requires --variant consensus');
    process.exit(1);
  }

  const resolvedModel = resolveModel(args);
  const provider = detectProvider(resolvedModel);
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    console.error(`ERROR: ${provider.toUpperCase()}_API_KEY environment variable is not set`);
    console.error('Set the appropriate API key for the model provider.');
    process.exit(1);
  }

  const inputPath = resolve(CWD, args.input || '.claude/annotation_data/labels_500.json');
  const outputPath = resolve(CWD, args.output || inputPath);

  console.log(`Annotation Settings:`);
  console.log(`  Annotator: ${args.annotator}`);
  console.log(`  Variant: ${args.variant}`);
  console.log(`  Batch Size: ${args.batchSize}`);
  console.log(`  Start Index: ${args.start}`);
  console.log(`  Model: ${resolvedModel} (provider: ${provider})`);
  console.log(`  Input: ${inputPath}`);
  console.log(`  Output: ${outputPath}`);

  // Load annotations
  let entries;
  try {
    entries = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR loading input file: ${e.message}`);
    process.exit(1);
  }

  console.log(`Loaded ${entries.length} comment entries`);

  const end = Math.min(args.start + args.batchSize, entries.length);
  console.log(`Processing entries ${args.start}–${end}/${entries.length}`);
  console.log();

  const systemPrompt = buildSystemPrompt(args.annotator, args.variant);
  let successCount = 0;
  let errorCount = 0;

  for (let i = args.start; i < end; i++) {
    const entry = entries[i];
    const idx = i - args.start + 1;
    const commentPreview = (entry.comment_text || '').slice(0, 60);

    console.log(`[${idx}/${end - args.start}] annot_${String(i + 1).padStart(4, '0')}: "${commentPreview}..."`);

    // Find or create the annotation slot for this annotator
    let annotation = entry.annotations.find((a) => a.annotator_id === args.annotator);
    if (!annotation) {
      annotation = {
        annotator_id: args.annotator,
        toxicEmotions: null,
        missingCommitment: null,
        missingIntelligibility: null,
        otherReasons: null,
        gangjing_subtypes: [],
        notes: '',
      };
      entry.annotations.push(annotation);
    }

    // Skip if already annotated
    if (annotation.toxicEmotions !== null && annotation.missingCommitment !== null) {
      console.log(`  → Already annotated, skipping`);
      successCount++;
      continue;
    }

    try {
      // For consensus mode, look up A1 and A2 ratings
      let a1Rating = null;
      let a2Rating = null;
      if (args.variant === 'consensus') {
        a1Rating = entry.annotations.find((a) => a.annotator_id === 'A1') || null;
        a2Rating = entry.annotations.find((a) => a.annotator_id === 'A2') || null;
      }

      const userMessage = buildUserMessage(entry.comment_text, args.variant, a1Rating, a2Rating);
      const result = await chatCompletion(resolvedModel, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ]);

      const parsed = parseAnnotation(result, args.annotator);

      // Update annotation
      annotation.toxicEmotions = parsed.toxicEmotions;
      annotation.missingCommitment = parsed.missingCommitment;
      annotation.missingIntelligibility = parsed.missingIntelligibility;
      annotation.otherReasons = parsed.otherReasons;
      annotation.gangjing_subtypes = parsed.gangjing_subtypes;
      annotation.notes = parsed.notes;

      console.log(`  → TE=${parsed.toxicEmotions} MC=${parsed.missingCommitment} MI=${parsed.missingIntelligibility} OR=${parsed.otherReasons} [${(parsed.gangjing_subtypes || []).join(', ') || 'no subtype'}]`);
      successCount++;

      // Save after each successful annotation (incremental progress)
      writeFileSync(outputPath, JSON.stringify(entries, null, 2), 'utf8');
    } catch (e) {
      console.error(`  ✗ ERROR: ${e.message}`);
      errorCount++;

      // On rate limit, wait and retry once
      if (e.message.includes('429') || e.message.includes('rate')) {
        console.log(`  → Rate limited, waiting 30s...`);
        await sleep(30000);
        try {
          const result = await chatCompletion(resolvedModel, [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ]);
          const parsed = parseAnnotation(result, args.annotator);
          annotation.toxicEmotions = parsed.toxicEmotions;
          annotation.missingCommitment = parsed.missingCommitment;
          annotation.missingIntelligibility = parsed.missingIntelligibility;
          annotation.otherReasons = parsed.otherReasons;
          annotation.gangjing_subtypes = parsed.gangjing_subtypes;
          annotation.notes = parsed.notes;
          console.log(`  → (retry) TE=${parsed.toxicEmotions} MC=${parsed.missingCommitment} MI=${parsed.missingIntelligibility} OR=${parsed.otherReasons}`);
          successCount++;
          errorCount--;
          writeFileSync(outputPath, JSON.stringify(entries, null, 2), 'utf8');
        } catch (e2) {
          console.error(`  ✗ Retry also failed: ${e2.message}`);
        }
      }
    }

    // Pace requests to avoid rate limiting (DeepSeek flash ~10 req/s)
    if (i < end - 1) {
      await sleep(100); // 100ms between requests
    }
  }

  console.log(`\nDone! Success: ${successCount}, Errors: ${errorCount}`);
  console.log(`Output written to: ${outputPath}`);
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
