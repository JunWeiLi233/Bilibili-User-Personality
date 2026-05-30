import { readFile, writeFile } from 'node:fs/promises';

// Semantic comment/evidence matcher using local embeddings via @xenova/transformers.
// Complements exact substring matching by accepting comments whose meaning
// is similar to a term's definition, even when the term doesn't appear literally.

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMS = 384;
const DEFAULT_THRESHOLD = 0.72;
const DEFAULT_MAX_CHUNKS = 50;
const MIN_CHUNK_LENGTH = 8;
const CACHE_PATH_DEFAULT = 'server/semanticTermEmbeddings.json';

// --- singleton pipeline ---

let _embedPipeline = null;

async function getEmbedPipeline() {
  if (!_embedPipeline) {
    const { pipeline } = await import('@xenova/transformers');
    _embedPipeline = await pipeline('feature-extraction', EMBEDDING_MODEL);
  }
  return _embedPipeline;
}

// Normalize a vector to unit length (in-place, returns input).
function normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const len = Math.sqrt(sum);
  if (len > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= len;
  }
  return vec;
}

// --- public API ---

/**
 * Embed an array of texts via local @xenova/transformers pipeline.
 * Returns an array of Float32Array (384-dim, un-normalized).
 */
export async function embedTexts(texts, _options = {}) {
  const clean = texts.map((t) => String(t || '').trim()).filter(Boolean);
  if (clean.length === 0) return [];

  const pipe = await getEmbedPipeline();
  const results = [];
  for (const text of clean) {
    const output = await pipe(text, { pooling: 'mean', normalize: false });
    // output is a 1×384 tensor; extract data as Float32Array
    const data = Array.from(output.data);
    results.push(new Float32Array(data));
  }
  return results;
}

/**
 * Cosine similarity between two vectors.
 * Pre-normalize for pure dot-product similarity.
 * Returns 0..1 (higher = more similar).
 */
export function cosineSimilarity(a, b) {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Build term embeddings for every entry in the dictionary.
 * Embedding text = "{term}: {meaning}" plus variant list if present.
 * Caches results to disk; reuses cache when dictionary version matches.
 * Returns Map<term, Float32Array>.
 */
export async function buildTermEmbeddings(dictionary, options = {}) {
  const cachePath = options.cachePath || CACHE_PATH_DEFAULT;
  const force = options.force || false;

  // Check cache
  if (!force) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf-8'));
      if (cached && cached.dictionaryVersion === dictionary.version && cached.termCount === (dictionary.entries || []).length) {
        const map = new Map();
        for (const [term, arr] of Object.entries(cached.embeddings || {})) {
          map.set(term, new Float32Array(arr));
        }
        return map;
      }
    } catch { /* cache miss, rebuild */ }
  }

  const entries = dictionary.entries || [];
  const texts = [];
  const terms = [];
  for (const entry of entries) {
    const term = String(entry.term || '').trim();
    if (!term) continue;
    const meaning = String(entry.meaning || '').trim();
    const variants = Array.isArray(entry.variants) ? entry.variants.filter(Boolean).join(', ') : '';
    const text = variants ? `${term}: ${meaning} | 变体: ${variants}` : `${term}: ${meaning}`;
    texts.push(text);
    terms.push(term);
  }

  if (texts.length === 0) return new Map();

  const embeddings = await embedTexts(texts, options);
  const map = new Map();
  for (let i = 0; i < terms.length; i++) {
    if (embeddings[i]) map.set(terms[i], embeddings[i]);
  }

  // Write cache
  const cacheObj = {
    dictionaryVersion: dictionary.version,
    termCount: entries.length,
    builtAt: new Date().toISOString(),
    embeddings: Object.fromEntries([...map].map(([t, v]) => [t, Array.from(v)])),
  };
  try {
    await writeFile(cachePath, JSON.stringify(cacheObj), 'utf-8');
  } catch { /* non-critical */ }

  return map;
}

/**
 * Split text into sentence-level chunks.
 * Bilibili comments are short; we split on Chinese/English punctuation and newlines.
 */
export function chunkCommentText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const sentences = raw
    .split(/[。！？\n!?;；]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_CHUNK_LENGTH);
  // Also include the full text as a chunk if it's a single short comment
  if (sentences.length === 0 && raw.length >= MIN_CHUNK_LENGTH) {
    return [raw];
  }
  return sentences;
}

/**
 * Match comment chunks to dictionary terms via semantic similarity.
 *
 * @param {string[]} chunks - sentence-level comment chunks
 * @param {Map<string, Float32Array>} termEmbeddings - pre-built term embeddings
 * @param {number} threshold - cosine similarity threshold (0..1)
 * @param {object} options - embedTexts options
 * @returns {Promise<Array<{term: string, chunk: string, score: number}>>}
 */
export async function matchCommentToTerms(chunks, termEmbeddings, threshold = DEFAULT_THRESHOLD, options = {}) {
  const cleanChunks = chunks.map((c) => String(c || '').trim()).filter((c) => c.length >= MIN_CHUNK_LENGTH);
  if (cleanChunks.length === 0 || termEmbeddings.size === 0) return [];

  const chunkEmbeddings = await embedTexts(cleanChunks, options);
  if (chunkEmbeddings.length === 0) return [];

  // Normalize all term embeddings once
  const normalizedTerms = new Map();
  for (const [term, emb] of termEmbeddings) {
    normalizedTerms.set(term, normalize(new Float32Array(emb)));
  }

  const matches = [];
  for (let ci = 0; ci < cleanChunks.length; ci++) {
    const chunkEmb = normalize(new Float32Array(chunkEmbeddings[ci]));
    for (const [term, termEmb] of normalizedTerms) {
      const score = cosineSimilarity(chunkEmb, termEmb);
      if (score >= threshold) {
        matches.push({ term, chunk: cleanChunks[ci], score: Number(score.toFixed(4)) });
      }
    }
  }

  // Deduplicate: keep highest score per (term, chunk) pair
  const seen = new Set();
  return matches
    .filter((m) => {
      const key = `${m.term}\x00${m.chunk}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Find dictionary entries with semantic evidence in the given text.
 * Used as a supplement to exact substring matching in trainKeywordDictionary.
 *
 * @param {object} dictionary - the scoped dictionary (entries with evidence fields)
 * @param {string} text - the assembled comment text
 * @param {object} options
 * @returns {Promise<Array<object>>} entries with evidenceSamples/evidenceSources
 */
export async function findDictionaryEntriesWithSemanticEvidence(dictionary, text, options = {}) {
  const enabled = options.semanticMatchEnabled === true
    || String(options.env?.SEMANTIC_MATCH_ENABLED || process.env.SEMANTIC_MATCH_ENABLED || '0') === '1';
  if (!enabled) return [];

  const threshold = Number(options.semanticMatchThreshold
    || options.env?.SEMANTIC_MATCH_THRESHOLD
    || process.env.SEMANTIC_MATCH_THRESHOLD
    || DEFAULT_THRESHOLD);
  const maxChunks = Number(options.semanticMatchMaxChunks
    || options.env?.SEMANTIC_MATCH_MAX_CHUNKS
    || process.env.SEMANTIC_MATCH_MAX_CHUNKS
    || DEFAULT_MAX_CHUNKS);
  const targetEvidence = Number(options.targetEvidence || 3);

  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  if (entries.length === 0 || !text) return [];

  // Build term embeddings (cached)
  const termEmbeddings = await buildTermEmbeddings(dictionary, options);

  // Only consider terms below target evidence
  const weakTerms = new Set(
    entries
      .filter((e) => (e.evidenceCount || 0) < targetEvidence)
      .map((e) => String(e.term || '').trim())
      .filter(Boolean),
  );
  if (weakTerms.size === 0) return [];

  // Filter embeddings to weak terms only
  const weakEmbeddings = new Map();
  for (const [term, emb] of termEmbeddings) {
    if (weakTerms.has(term)) weakEmbeddings.set(term, emb);
  }
  if (weakEmbeddings.size === 0) return [];

  // Chunk and match
  const chunks = chunkCommentText(text).slice(0, maxChunks);
  const matches = await matchCommentToTerms(chunks, weakEmbeddings, threshold, options);

  // Build evidence entries from matches
  const source = options.source || 'Bilibili public comment semantic match';
  const uid = options.uid || '';
  const now = new Date().toISOString();
  const byTerm = new Map();

  for (const match of matches) {
    const term = match.term;
    if (!byTerm.has(term)) {
      byTerm.set(term, {
        term,
        evidenceSamples: [],
        evidenceSources: [],
        updatedAt: now,
      });
    }
    const entry = byTerm.get(term);
    if (entry.evidenceSamples.length < 5 && !entry.evidenceSamples.includes(match.chunk)) {
      entry.evidenceSamples.push(match.chunk);
    }
    if (entry.evidenceSources.length < 8) {
      entry.evidenceSources.push({
        source: `[Semantic match, score=${match.score}] ${source}`,
        uid,
        sample: match.chunk,
      });
    }
  }

  for (const entry of byTerm.values()) {
    entry.evidenceCount = entry.evidenceSamples.length;
  }

  return [...byTerm.values()];
}

/**
 * Read term embeddings from cache without rebuilding.
 */
export async function loadCachedEmbeddings(options = {}) {
  const cachePath = options.cachePath || CACHE_PATH_DEFAULT;
  try {
    const cached = JSON.parse(await readFile(cachePath, 'utf-8'));
    if (!cached || !cached.embeddings) return null;
    const map = new Map();
    for (const [term, arr] of Object.entries(cached.embeddings)) {
      map.set(term, new Float32Array(arr));
    }
    return map;
  } catch {
    return null;
  }
}
