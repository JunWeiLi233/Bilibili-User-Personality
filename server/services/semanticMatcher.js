// Semantic matching — DISABLED (Phase 5, 2026-06-27).
//
// The semantic matching module was removed after A/B testing showed it contributes
// 0% unique hits beyond exact substring matching to the 100-user analysis pipeline.
// Both the multilingual-e5-small (English-biased) and bge-small-zh-v1.5 models
// failed to add value over keyword substring matching for Chinese Bilibili comments.
//
// The @xenova/transformers dependency (80MB ML runtime) has been dropped from
// package.json. This file is kept as a thin stub so existing imports in
// deepseekKeywordTrainer.js and routes/deepseek.js continue to resolve.
// All embedding functions return empty results.

// --- retained pure functions (no ML dependency) ---

/**
 * Cosine similarity between two vectors.
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
 * Split text into sentence-level chunks.
 */
export function chunkCommentText(text) {
  const MIN_CHUNK_LENGTH = 8;
  const raw = String(text || '').trim();
  if (!raw) return [];
  const sentences = raw
    .split(/[。！？\n!?;；]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_CHUNK_LENGTH);
  if (sentences.length === 0 && raw.length >= MIN_CHUNK_LENGTH) {
    return [raw];
  }
  return sentences;
}

// --- stubbed embedding functions (return empty/no-op) ---

export async function embedTexts(_texts, _options = {}) {
  return [];
}

export async function buildTermEmbeddings(_dictionary, _options = {}) {
  return new Map();
}

export async function matchCommentToTerms(_chunks, _termEmbeddings, _threshold, _options = {}) {
  return [];
}

export async function findDictionaryEntriesWithSemanticEvidence(_dictionary, _text, _options = {}) {
  return [];
}

export async function loadCachedEmbeddings(_options = {}) {
  return null;
}
