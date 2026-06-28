/**
 * Tier 3: LLM Relationship Analysis
 *
 * Uses DeepSeek API to analyze term relationships in edge cases
 * where regex patterns (Tier 1) and statistical models (Tier 2)
 * can't reach a high-confidence decision.
 *
 * Opt-in via BILIBILI_LLM_RELATIONS=1 env var.
 *
 * Contract:
 *   export async function analyzeRelationships(commentText, matchedTerms, options) -> AnalyzerResult
 *
 *   AnalyzerResult: {
 *     relationships: Array<{
 *       terms: string[],
 *       type: 'llm',
 *       effect: 'boost' | 'suppress' | 'neutral',
 *       confidence: number,   // 0.0-1.0
 *       reason: string,
 *     }>,
 *     adjustedWeights: Map<string, number>,
 *   }
 */

const RELATIONSHIP_TYPES = ['negation', 'intensification', 'target_binding', 'contrast', 'independent'];
const VALID_EFFECTS = new Set(['boost', 'suppress', 'neutral']);
const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSystemPrompt() {
  return `You are a Chinese linguistics analyzer specializing in argumentative discourse on Bilibili (a Chinese video-sharing platform).

You analyze relationships between matched keyword terms in comment text. Each term belongs to a "family" that indicates its role:
- attack: offensive or hostile language
- absolutes: absolute or categorical statements
- evidence: citations, data, or sources
- evasion: deflection or avoidance language
- cooperation: conciliatory or collaborative language
- correction: corrective or clarifying language

For each pair or group of nearby terms, identify the relationship type:
1. negation: one term negates or weakens another (e.g., 不是 + attack term)
2. intensification: one term strengthens another (e.g., 完全 + 垃圾)
3. target_binding: one term identifies a target, another describes them (e.g., 策划 + 傻逼)
4. contrast: terms appear in contrasting clauses (e.g., 虽然X但是Y)
5. independent: terms appear together but do not semantically interact

For each relationship, provide:
- The terms involved (exactly as listed in the input)
- The relationship type from the list above
- The effect on overall argumentativeness: "boost" (more argumentative), "suppress" (less argumentative), or "neutral" (no change)
- A confidence score from 0.0 to 1.0
- A brief reason explaining the analysis

Output ONLY valid JSON with a "relationships" array. No explanation, no markdown.`;
}

function buildUserPrompt(commentText, matchedTerms) {
  const termList = matchedTerms
    .map(t => `"${t.term}" (${t.family || 'unknown'})`)
    .join(', ');

  return `Comment: "${commentText}"

Matched terms: ${termList}

Analyze the relationships between these terms in the comment text. Consider their positions, Chinese grammar patterns, and semantic interaction.

Return a JSON object with this structure:
{
  "relationships": [
    {
      "terms": ["term1", "term2"],
      "type": "negation | intensification | target_binding | contrast | independent",
      "effect": "boost | suppress | neutral",
      "confidence": 0.0-1.0,
      "reason": "brief explanation in English or Chinese"
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Convert raw LLM output into the contract format.
 * Validates fields and applies weight adjustments.
 *
 * @param {object} llmOutput - parsed JSON from DeepSeek
 * @param {Array<{term: string, family?: string, weight?: number}>} matchedTerms
 * @returns {{ relationships: Array, adjustedWeights: Map<string, number> }}
 */
export function convertToContract(llmOutput, matchedTerms) {
  const relationships = [];
  const adjustedWeights = new Map();

  const rawRelationships = Array.isArray(llmOutput?.relationships) ? llmOutput.relationships : [];

  for (const rel of rawRelationships) {
    // Validate required fields
    if (!Array.isArray(rel.terms) || rel.terms.length < 2) continue;
    if (!VALID_EFFECTS.has(rel.effect)) continue;

    // Accept any string type; only filter non-strings
    if (rel.type && typeof rel.type !== 'string') continue;

    // Normalize confidence to [0, 1]
    const confidence = Math.min(1, Math.max(0, Number(rel.confidence) || 0.6));

    relationships.push({
      terms: rel.terms,
      type: 'llm',
      effect: rel.effect,
      confidence,
      reason: String(rel.reason || 'LLM-analyzed relationship').trim(),
    });

    // Apply weight adjustments based on effect
    for (const term of rel.terms) {
      const match = matchedTerms.find(m => m.term === term);
      if (!match) continue;

      const baseWeight = Number(match.weight) || 1;

      if (rel.effect === 'boost') {
        const adjusted = +(baseWeight * (1 + 0.15 * confidence)).toFixed(2);
        adjustedWeights.set(term, adjusted);
      } else if (rel.effect === 'suppress') {
        const adjusted = +(baseWeight * (1 - 0.3 * confidence)).toFixed(2);
        adjustedWeights.set(term, adjusted);
      }
    }
  }

  return { relationships, adjustedWeights };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Analyze term relationships using DeepSeek LLM.
 *
 * Graceful degradation: returns empty result on any error, missing config,
 * or when opt-in env var is not set. Never throws.
 *
 * @param {string} commentText - full comment text
 * @param {Array<{term: string, family?: string, weight?: number}>} matchedTerms
 * @param {object} [options]
 * @param {string} [options.apiKey] - DeepSeek API key override
 * @param {boolean} [options.force] - bypass BILIBILI_LLM_RELATIONS opt-in check
 * @param {object} [options.env] - environment override (for testing)
 * @returns {Promise<{ relationships: Array, adjustedWeights: Map<string, number> }>}
 */
export async function analyzeRelationships(commentText, matchedTerms, options = {}) {
  // Opt-in check: must set BILIBILI_LLM_RELATIONS=1 or pass options.force
  const env = options.env || process.env;
  if ((env.BILIBILI_LLM_RELATIONS || '0') !== '1' && !options.force) {
    return { relationships: [], adjustedWeights: new Map() };
  }

  // Need at least 2 terms to find relationships
  if (!matchedTerms || matchedTerms.length < 2) {
    return { relationships: [], adjustedWeights: new Map() };
  }

  // Check API key availability
  const apiKey = options.apiKey || env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error('[llmRelationAnalysis] No DeepSeek API key available -- skipping Tier 3 analysis');
    return { relationships: [], adjustedWeights: new Map() };
  }

  const baseUrl = String(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

  // Build prompts
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(commentText, matchedTerms);

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
  };

  // Set up timeout via AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(
        `[llmRelationAnalysis] DeepSeek API error: ${response.status} ${response.statusText}` +
        (errorBody ? ` -- ${errorBody.slice(0, 200)}` : ''),
      );
      return { relationships: [], adjustedWeights: new Map() };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error('[llmRelationAnalysis] Empty DeepSeek response content');
      return { relationships: [], adjustedWeights: new Map() };
    }

    // Parse LLM JSON output
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error(`[llmRelationAnalysis] Failed to parse LLM JSON output: ${parseErr.message}`);
      return { relationships: [], adjustedWeights: new Map() };
    }

    return convertToContract(parsed, matchedTerms);
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      console.error('[llmRelationAnalysis] DeepSeek API request timed out');
    } else {
      console.error(`[llmRelationAnalysis] DeepSeek API request failed: ${err.message}`);
    }

    return { relationships: [], adjustedWeights: new Map() };
  }
}
