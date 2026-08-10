/**
 * Annotation API — Phase 0 baseline labeling routes.
 *
 * Serves annotation tasks from `server/data/baselines/annotation_tasks.json`
 * and persists annotations back. Supports 3-annotator protocol with
 * double-label IAA tracking and Cohen's κ computation.
 *
 * Routes:
 * - GET  /api/annotate/next?annotator=A1     — next unlabeled task
 * - POST /api/annotate/submit                 — save annotation
 * - GET  /api/annotate/stats                  — progress + κ
 *
 * @module server/routes/annotate
 */

import { Hono } from 'hono';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_PATH = resolve(__dirname, '..', 'data', 'baselines', 'annotation_tasks.json');

const app = new Hono();

/** Load tasks from disk (returns [] on missing/corrupt file). */
function loadTasks() {
  try {
    if (!existsSync(TASKS_PATH)) return [];
    const raw = readFileSync(TASKS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load annotation tasks:', err.message);
    return [];
  }
}

/** Persist tasks to disk — write to tmp first then copy (simple crash-safe pattern). */
function saveTasks(tasks) {
  const tmp = TASKS_PATH + '.tmp';
  const data = JSON.stringify(tasks, null, 2);
  writeFileSync(tmp, data, 'utf-8');
  writeFileSync(TASKS_PATH, data, 'utf-8');
  try { unlinkSync(tmp); } catch {}
}

// GET /api/annotate/next?annotator=A1
app.get('/next', (c) => {
  const annotator = c.req.query('annotator') || 'A1';
  const tasks = loadTasks();

  // Find first task where this annotator hasn't annotated yet
  const idx = tasks.findIndex((t) => {
    const anns = t.annotations || [];
    return !anns.some((a) => a.annotatorId === annotator);
  });

  if (idx === -1) {
    return c.json({ ok: true, done: true, message: 'All tasks completed for this annotator.' });
  }

  const task = { ...tasks[idx] };
  // Don't send other annotators' labels to the current annotator (except adjudicator A3)
  if (annotator !== 'A3') {
    task.annotations = (task.annotations || []).filter((a) => a.annotatorId === annotator);
  }

  // Count completed
  const doneCount = tasks.filter((t) =>
    (t.annotations || []).some((a) => a.annotatorId === annotator)
  ).length;

  return c.json({
    ok: true,
    done: false,
    task,
    progress: { done: doneCount, total: tasks.length, annotator },
  });
});

// POST /api/annotate/submit
app.post('/submit', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { taskId, annotator, labels } = body;
  if (!taskId || !annotator || !labels) {
    return c.json({ ok: false, error: 'Missing taskId, annotator, or labels' }, 400);
  }

  const tasks = loadTasks();
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) {
    return c.json({ ok: false, error: `Task ${taskId} not found` }, 404);
  }

  const task = tasks[idx];
  const annotations = task.annotations || [];

  // Remove previous annotation by this annotator if re-submitting
  const existingIdx = annotations.findIndex((a) => a.annotatorId === annotator);
  const annotation = {
    annotatorId: annotator,
    timestamp: new Date().toISOString(),
    labels: {
      isRisky: Boolean(labels.isRisky),
      riskAxis: labels.riskAxis || null,
      sentiment: labels.sentiment || null,
      isMemeOrQuote: Boolean(labels.isMemeOrQuote),
      difficult: Boolean(labels.difficult),
    },
  };

  if (existingIdx >= 0) {
    annotations[existingIdx] = annotation;
  } else {
    annotations.push(annotation);
  }

  // Update status
  task.annotations = annotations;
  // Mark complete if at least 2 annotators (or 3 for shared tasks)
  const requiredAnnotators = task.isShared ? 3 : 2;
  task.status = annotations.length >= requiredAnnotators ? 'completed' : 'in_progress';

  saveTasks(tasks);

  return c.json({ ok: true, taskId, annotator, status: task.status });
});

// GET /api/annotate/stats
app.get('/stats', (c) => {
  const tasks = loadTasks();
  const annotators = ['A1', 'A2', 'A3'];

  const perAnnotator = {};
  for (const a of annotators) {
    const done = tasks.filter((t) =>
      (t.annotations || []).some((ann) => ann.annotatorId === a)
    ).length;
    perAnnotator[a] = { done, total: tasks.length };
  }

  // Count shared tasks with annotations from both A1 and A2
  const shared = tasks.filter((t) => t.isShared);
  const sharedDone = shared.filter((t) => {
    const anns = t.annotations || [];
    return anns.some((a) => a.annotatorId === 'A1') && anns.some((a) => a.annotatorId === 'A2');
  }).length;

  // Compute Cohen's κ for isRisky if enough shared tasks are done
  let kappa = null;
  if (sharedDone >= 10) {
    const sharedWithBoth = shared.filter((t) => {
      const anns = t.annotations || [];
      const a1 = anns.find((a) => a.annotatorId === 'A1');
      const a2 = anns.find((a) => a.annotatorId === 'A2');
      return a1 && a2 && a1.labels && a2.labels;
    });

    if (sharedWithBoth.length >= 10) {
      kappa = computeCohensKappa(
        sharedWithBoth.map((t) => {
          const a1 = t.annotations.find((a) => a.annotatorId === 'A1');
          const a2 = t.annotations.find((a) => a.annotatorId === 'A2');
          return { a1: a1.labels.isRisky, a2: a2.labels.isRisky };
        })
      );
    }
  }

  const totalDone = tasks.filter((t) => t.status === 'completed').length;

  // Per-annotator category breakdown (riskAxis distribution)
  const RISK_AXES = ['attack', 'absolutes', 'evasion', 'cooperation', 'correction'];
  const categoryBreakdown = {};
  for (const a of annotators) {
    const cat = { total: 0, risky: 0, safe: 0 };
    for (const axis of RISK_AXES) cat[axis] = 0;
    for (const t of tasks) {
      const ann = (t.annotations || []).find((x) => x.annotatorId === a);
      if (!ann || !ann.labels) continue;
      cat.total++;
      if (ann.labels.isRisky) {
        cat.risky++;
        if (ann.labels.riskAxis && cat.hasOwnProperty(ann.labels.riskAxis)) {
          cat[ann.labels.riskAxis]++;
        }
      } else {
        cat.safe++;
      }
    }
    categoryBreakdown[a] = cat;
  }

  return c.json({
    ok: true,
    total: tasks.length,
    completed: totalDone,
    sharedDone,
    perAnnotator,
    categoryBreakdown,
    kappa,
    kappaTarget: 0.61,
    kappaStatus: kappa === null ? 'pending' : kappa < 0.5 ? 'halt' : kappa < 0.7 ? 'marginal' : 'acceptable',
  });
});

/**
 * Compute Cohen's κ for binary labels.
 * κ = (p_o - p_e) / (1 - p_e)
 */
function computeCohensKappa(pairs) {
  const n = pairs.length;
  if (n === 0) return null;

  // Observed agreement
  let agree = 0;
  for (const { a1, a2 } of pairs) {
    if (a1 === a2) agree++;
  }
  const p_o = agree / n;

  // Expected agreement
  const countA1True = pairs.filter((p) => p.a1).length;
  const countA2True = pairs.filter((p) => p.a2).length;
  const p_a1 = countA1True / n;
  const p_a2 = countA2True / n;
  const p_e = p_a1 * p_a2 + (1 - p_a1) * (1 - p_a2);

  if (p_e === 1) return 1;
  return (p_o - p_e) / (1 - p_e);
}

export default app;
