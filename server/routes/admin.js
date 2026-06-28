import { Hono } from 'hono';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminAuth } from '../middleware/adminAuth.js';
import { readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DICT_PATH = join(__dirname, '..', 'data', 'deepseekKeywordDictionary.json');
const REVIEWS_PATH = join(__dirname, '..', 'data', 'adminReviews.json');

// BOM-safe JSON parse — strips UTF-8 BOM if present (0xEF 0xBB 0xBF)
function readJsonSafe(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
}

const admin = new Hono();

// All admin routes require auth
admin.use('*', adminAuth);

// POST /api/admin/login — validate token
admin.post('/login', (c) => {
  return c.json({ ok: true });
});

// GET /api/admin/dictionary — paginated term list with filters
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

// GET /api/admin/term/:term — single term with evidence
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

// POST /api/admin/review — submit a review/dispute
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

// GET /api/admin/reviews — list reviews
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

// GET /api/admin/stats — dashboard stats
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

// POST /api/admin/export-reviews — export reviews for training
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
