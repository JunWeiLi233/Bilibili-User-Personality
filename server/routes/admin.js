/**
 * Admin API routes — mounted at `/api/admin`.
 *
 * Provides endpoints for human-in-the-loop dictionary review: paginated term
 * browsing, single-term inspection with evidence, review submission (confirm /
 * dispute / flag), review listing, dashboard stats, and review export for
 * downstream training.
 *
 * All routes require Bearer-token authentication via the {@link adminAuth}
 * middleware. See `server/middleware/adminAuth.js` for the token check.
 *
 * Data contracts:
 * - Dictionary: `server/data/deepseekKeywordDictionary.json`
 * - Reviews:   `server/data/adminReviews.json`
 *
 * @module server/routes/admin
 */

import { Hono } from 'hono';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminAuth } from '../middleware/adminAuth.js';
import { readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DICT_PATH = join(__dirname, '..', 'data', 'deepseekKeywordDictionary.json');
const REVIEWS_PATH = join(__dirname, '..', 'data', 'adminReviews.json');

/**
 * BOM-safe JSON read. Strips UTF-8 BOM (0xEF 0xBB 0xBF) if present before
 * parsing — necessary because some editors/scripts emit BOM in project JSON.
 *
 * @param {string} filePath — absolute path to a JSON file
 * @returns {object} parsed JSON
 */
function readJsonSafe(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
}

const admin = new Hono();

// All admin routes require auth
admin.use('*', adminAuth);

/**
 * POST /api/admin/login
 *
 * Validates the admin token. The auth middleware already rejects invalid
 * tokens, so this endpoint simply confirms the caller is authenticated.
 *
 * Response: { ok: true }
 */
admin.post('/login', (c) => {
  return c.json({ ok: true });
});

/**
 * GET /api/admin/dictionary
 *
 * Returns a paginated, filterable, sortable view of the keyword dictionary.
 *
 * Query params:
 * - `family`   — filter by term family (e.g. "persona", "toxic")
 * - `reviewed` — filter by review status: "all" | "reviewed" | "unreviewed" | "disputed"
 * - `search`   — free-text search across term name and meaning
 * - `page`     — page number (1-based, default 1)
 * - `perPage`  — items per page (10–100, default 50)
 *
 * Sorting: unreviewed first, then disputed, then by confidence ascending.
 *
 * Response: { ok: true, entries: Array, page, perPage, total, totalPages, stats }
 */
admin.get('/dictionary', async (c) => {
  const family = c.req.query('family') || '';
  const reviewed = c.req.query('reviewed') || ''; // 'all', 'reviewed', 'unreviewed', 'disputed'
  const search = c.req.query('search') || '';
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const perPage = Math.min(100, Math.max(10, parseInt(c.req.query('perPage') || '50', 10)));

  const dict = await readKeywordDictionary();
  const entries = dict.entries || [];

  // Load reviews
  let reviews = [];
  if (existsSync(REVIEWS_PATH)) {
    reviews = readJsonSafe(REVIEWS_PATH).reviews || [];
  }
  const reviewMap = new Map();
  for (const r of reviews) {
    reviewMap.set(r.term, r);
  }

  // Filter
  let filtered = entries;
  if (family) {
    filtered = filtered.filter((e) => e.family === family);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((e) => e.term.toLowerCase().includes(q) || (e.meaning || '').toLowerCase().includes(q));
  }
  if (reviewed === 'reviewed') {
    filtered = filtered.filter((e) => reviewMap.has(e.term));
  } else if (reviewed === 'unreviewed') {
    filtered = filtered.filter((e) => !reviewMap.has(e.term));
  } else if (reviewed === 'disputed') {
    filtered = filtered.filter((e) => {
      const r = reviewMap.get(e.term);
      return r && r.action === 'dispute';
    });
  }

  // Sort by review priority: low confidence first, then disputed, then unreviewed
  filtered.sort((a, b) => {
    const aReviewed = reviewMap.has(a.term);
    const bReviewed = reviewMap.has(b.term);
    if (!aReviewed && bReviewed) return -1;
    if (aReviewed && !bReviewed) return 1;
    if (a.confidence < b.confidence) return -1;
    if (a.confidence > b.confidence) return 1;
    return 0;
  });

  const total = filtered.length;
  const totalPages = Math.ceil(total / perPage);
  const start = (page - 1) * perPage;
  const pageEntries = filtered.slice(start, start + perPage).map((e) => ({
    ...e,
    humanReviewed: reviewMap.has(e.term),
    adminOverride: reviewMap.has(e.term) ? {
      family: reviewMap.get(e.term).adminFamily,
      risk: reviewMap.get(e.term).adminRisk,
      note: reviewMap.get(e.term).adminNote,
      action: reviewMap.get(e.term).action,
    } : null,
  }));

  // Stats
  const reviewedCount = reviews.length;
  const disputedCount = reviews.filter((r) => r.action === 'dispute').length;
  const confirmedCount = reviews.filter((r) => r.action === 'confirm').length;

  return c.json({
    ok: true,
    entries: pageEntries,
    page,
    perPage,
    total,
    totalPages,
    stats: {
      totalEntries: entries.length,
      reviewed: reviewedCount,
      disputed: disputedCount,
      confirmed: confirmedCount,
    },
  });
});

/**
 * GET /api/admin/term/:term
 *
 * Returns a single dictionary term with its AI classification, any human
 * review override, and up to 20 evidence samples from the evidence shards.
 *
 * URL param: `:term` — the dictionary term (URL-encoded)
 *
 * Response: { ok: true, term: {...entry, humanReviewed, adminOverride?, evidence, evidenceCount} }
 *           { ok: false, error: "Term not found" } 404
 */
admin.get('/term/:term', async (c) => {
  const term = decodeURIComponent(c.req.param('term'));
  const dict = await readKeywordDictionary();
  const entry = (dict.entries || []).find((e) => e.term === term);
  if (!entry) {
    return c.json({ ok: false, error: 'Term not found' }, 404);
  }

  // Load reviews
  let review = null;
  if (existsSync(REVIEWS_PATH)) {
    const reviews = readJsonSafe(REVIEWS_PATH).reviews || [];
    review = reviews.find((r) => r.term === term) || null;
  }

  // Load evidence samples from evidence shards
  let evidence = [];
  const evidenceDir = join(__dirname, '..', 'data', 'deepseekKeywordDictionary.evidence');
  if (existsSync(evidenceDir)) {
    // Evidence files are named evidence-NNNN.json, we need to search them
    // For efficiency, just return the evidenceCount
    const familyDir = join(evidenceDir, entry.family);
    if (existsSync(familyDir)) {
      try {
        const files = readFileSync(join(familyDir, 'index.json'), 'utf-8');
        const index = JSON.parse(files);
        if (index[term]) {
          evidence = index[term].slice(0, 20); // Max 20 samples
        }
      } catch {
        evidence = [];
      }
    }
  }

  return c.json({
    ok: true,
    term: {
      ...entry,
      humanReviewed: !!review,
      adminOverride: review ? {
        family: review.adminFamily,
        risk: review.adminRisk,
        note: review.adminNote,
        action: review.action,
        reviewedAt: review.reviewedAt,
      } : null,
      evidence,
      evidenceCount: entry.evidenceCount || 0,
    },
  });
});

/**
 * POST /api/admin/review
 *
 * Submit a human review for a dictionary term. Supports three actions:
 * - `confirm` — accept the AI classification as-is
 * - `dispute` — override with admin-chosen family + risk (requires adminFamily, adminRisk)
 * - `flag`    — mark for later attention
 *
 * Request body: { term, aiFamily, aiRisk, aiConfidence, adminFamily?, adminRisk?, adminNote?, action }
 *   - action: "confirm" | "dispute" | "flag"
 *
 * Side effects: writes to both adminReviews.json and deepseekKeywordDictionary.json
 *
 * Response: { ok: true, review }
 */
admin.post('/review', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  const { term, aiFamily, aiRisk, aiConfidence, adminFamily, adminRisk, adminNote, action } = payload;

  if (!term || !action) {
    return c.json({ ok: false, error: 'term and action are required' }, 400);
  }
  if (!['confirm', 'dispute', 'flag'].includes(action)) {
    return c.json({ ok: false, error: 'action must be confirm, dispute, or flag' }, 400);
  }
  if (action === 'dispute' && (!adminFamily || !adminRisk)) {
    return c.json({ ok: false, error: 'dispute requires adminFamily and adminRisk' }, 400);
  }

  // Load or create reviews file
  let reviewsData;
  if (existsSync(REVIEWS_PATH)) {
    reviewsData = readJsonSafe(REVIEWS_PATH);
  } else {
    reviewsData = { version: 1, updatedAt: new Date().toISOString(), reviews: [] };
  }

  // Upsert review
  const existingIdx = reviewsData.reviews.findIndex((r) => r.term === term);
  const review = {
    term,
    family: aiFamily || '',
    aiClassification: { family: aiFamily || '', risk: aiRisk || '', confidence: aiConfidence || 0 },
    adminClassification: action === 'dispute' ? { family: adminFamily, risk: adminRisk } : null,
    adminNote: adminNote || '',
    action,
    reviewedBy: 'admin',
    reviewedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    reviewsData.reviews[existingIdx] = review;
  } else {
    reviewsData.reviews.push(review);
  }
  reviewsData.updatedAt = new Date().toISOString();

  // Write reviews
  writeFileSync(REVIEWS_PATH, JSON.stringify(reviewsData, null, 2), 'utf-8');

  // Update dictionary entry with adminOverride
  const dict = JSON.parse(readFileSync(DICT_PATH, 'utf-8'));
  const entry = (dict.entries || []).find((e) => e.term === term);
  if (entry) {
    entry.humanReviewed = true;
    if (action === 'dispute') {
      entry.adminOverride = {
        family: adminFamily,
        risk: adminRisk,
        note: adminNote || '',
        reviewedBy: 'admin',
        reviewedAt: new Date().toISOString(),
      };
    } else {
      entry.adminOverride = null;
    }
    writeFileSync(DICT_PATH, JSON.stringify(dict, null, 2), 'utf-8');
  }

  return c.json({ ok: true, review });
});

/**
 * GET /api/admin/reviews
 *
 * List all human reviews, optionally filtered by status or family.
 *
 * Query params:
 * - `status` — filter by action: "confirm" | "dispute" | "flag"
 * - `family` — filter by AI-assigned term family
 *
 * Response: { ok: true, reviews: Array, total: number }
 */
admin.get('/reviews', (c) => {
  const status = c.req.query('status') || '';
  const family = c.req.query('family') || '';

  if (!existsSync(REVIEWS_PATH)) {
    return c.json({ ok: true, reviews: [], total: 0 });
  }

  const data = readJsonSafe(REVIEWS_PATH);
  let reviews = data.reviews || [];

  if (status) reviews = reviews.filter((r) => r.action === status);
  if (family) reviews = reviews.filter((r) => r.family === family);

  return c.json({ ok: true, reviews, total: reviews.length });
});

/**
 * GET /api/admin/stats
 *
 * Dashboard aggregate statistics: total entries, review coverage, dispute
 * rate, confidence distribution, and per-family term counts.
 *
 * Response: { ok: true, stats: { totalEntries, reviewed, disputed, confirmed,
 *            unreviewed, disputeRate, lowConfidence, zeroEvidence, highConfidence,
 *            familyCounts } }
 */
admin.get('/stats', async (c) => {
  const dict = await readKeywordDictionary();
  const entries = dict.entries || [];

  let reviewCount = 0;
  let disputeCount = 0;
  let confirmCount = 0;
  if (existsSync(REVIEWS_PATH)) {
    const data = readJsonSafe(REVIEWS_PATH);
    reviewCount = (data.reviews || []).length;
    disputeCount = data.reviews.filter((r) => r.action === 'dispute').length;
    confirmCount = data.reviews.filter((r) => r.action === 'confirm').length;
  }

  // Family distribution
  const familyCounts = {};
  for (const e of entries) {
    familyCounts[e.family] = (familyCounts[e.family] || 0) + 1;
  }

  // Priority counts
  const lowConfidence = entries.filter((e) => e.confidence < 0.6).length;
  const zeroEvidence = entries.filter((e) => e.evidenceCount === 0).length;
  const highConfidence = entries.filter((e) => e.confidence >= 0.8).length;

  return c.json({
    ok: true,
    stats: {
      totalEntries: entries.length,
      reviewed: reviewCount,
      disputed: disputeCount,
      confirmed: confirmCount,
      unreviewed: entries.length - reviewCount,
      disputeRate: reviewCount > 0 ? Math.round((disputeCount / reviewCount) * 100) : 0,
      lowConfidence,
      zeroEvidence,
      highConfidence,
      familyCounts,
    },
  });
});

/**
 * GET /api/admin/export-reviews
 *
 * Exports all reviews in a flattened format suitable for downstream training
 * pipelines (e.g., calibration or model retraining).
 *
 * Response: { ok: true, exports: Array<{term, aiFamily, aiRisk, adminFamily, adminRisk, action, note}>, total }
 */
admin.get('/export-reviews', (c) => {
  if (!existsSync(REVIEWS_PATH)) {
    return c.json({ ok: true, exports: [] });
  }
  const data = readJsonSafe(REVIEWS_PATH);
  const exports = (data.reviews || []).map((r) => ({
    term: r.term,
    aiFamily: r.aiClassification?.family || '',
    aiRisk: r.aiClassification?.risk || '',
    adminFamily: r.adminClassification?.family || '',
    adminRisk: r.adminClassification?.risk || '',
    action: r.action,
    note: r.adminNote || '',
  }));
  return c.json({ ok: true, exports, total: exports.length });
});

export default admin;
