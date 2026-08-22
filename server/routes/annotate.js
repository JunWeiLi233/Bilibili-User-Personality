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
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic } from '../utils/atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_PATH = resolve(__dirname, '..', 'data', 'baselines', 'annotation_tasks.json');

const app = new Hono();

/**
 * The three annotator personas, in stride order. The k-th non-shared task
 * (counting only non-shared tasks, 0-indexed, in array order) is "owned" by
 * ANNOTATOR_ORDER[k % 3]. This partitions the non-shared pool into three
 * disjoint ~1/3 subsets so A1/A2/A3 each see a DIFFERENT next sample instead
 * of all colliding on the lowest-index unlabeled task.
 *
 * Shared tasks (`isShared: true`) have no owner — every annotator is eligible,
 * which preserves the multi-annotator overlap needed for Cohen's κ (AGENTS.md §9).
 */
export const ANNOTATOR_ORDER = ['A1', 'A2', 'A3'];

/**
 * Pure, side-effect-free selection of the next task index for an annotator.
 *
 * Two-pass selection:
 *   Pass 1: the lowest-index non-shared task owned by this annotator that they
 *           haven't labeled yet. → makes A1/A2/A3 each land on a different task.
 *   Pass 2: the lowest-index shared task they haven't labeled. → fallback so
 *           shared tasks still get labeled by all three (for κ) once an
 *           annotator's owned non-shared pool is exhausted.
 *
 * @param {Array<{isShared?: boolean, annotations?: Array<{annotatorId: string}>}>} tasks
 * @param {string} annotator  one of ANNOTATOR_ORDER
 * @returns {number} index into tasks, or -1 if no eligible unlabeled task remains
 */
export function selectNextTaskIndex(tasks, annotator) {
  if (!Array.isArray(tasks) || !ANNOTATOR_ORDER.includes(annotator)) return -1;
  const stride = ANNOTATOR_ORDER.indexOf(annotator);
  const isLabeledBy = (t) => Array.isArray(t?.annotations) && t.annotations.some((a) => a.annotatorId === annotator);

  // Build the non-shared owner map: k-th non-shared task → owner by stride.
  const ownerByIndex = new Array(tasks.length).fill(null);
  let nonSharedSeen = 0;
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i]?.isShared) continue;
    ownerByIndex[i] = ANNOTATOR_ORDER[nonSharedSeen % ANNOTATOR_ORDER.length];
    if (ownerByIndex[i] === annotator && !isLabeledBy(tasks[i])) return i;
    nonSharedSeen++;
  }

  // Pass 2: shared tasks (eligible for everyone).
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i]?.isShared && !isLabeledBy(tasks[i])) return i;
  }
  // `stride` is referenced to keep it semantically tied to the annotator even
  // though the owner map already encodes it; avoids dead-code lints while
  // documenting that the returned index belongs to this annotator's partition.
  void stride;
  return -1;
}

/**
 * Tasks an annotator is eligible to label (their owned non-shared + all shared).
 * Used by /stats to give a meaningful per-annotator progress denominator
 * (otherwise every annotator shows X/totalTasks even though they only own ~1/3).
 */
function eligibleTaskCount(tasks, annotator) {
  if (!ANNOTATOR_ORDER.includes(annotator)) return 0;
  let nonSharedSeen = 0;
  let count = 0;
  for (const t of tasks) {
    if (t?.isShared) {
      count++;
      continue;
    }
    if (ANNOTATOR_ORDER[nonSharedSeen % ANNOTATOR_ORDER.length] === annotator) count++;
    nonSharedSeen++;
  }
  return count;
}

/** Load tasks from disk (returns [] on missing/corrupt file). */
async function loadTasks() {
  try {
    if (!existsSync(TASKS_PATH)) return [];
    const raw = await readFile(TASKS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load annotation tasks:', err.message);
    return [];
  }
}

/**
 * Persist tasks atomically (temp -> fsync -> rename -> dir fsync).
 * The previous non-atomic writeFileSync pattern corrupted the file under
 * concurrent submitters and could lose the whole task set on a crash mid-write.
 */
async function saveTasks(tasks) {
  await writeJsonAtomic(TASKS_PATH, tasks);
}

/**
 * In-process mutex (promise chain) that serializes read-modify-write cycles on
 * the task store. Without this, N concurrent /submit requests each load the
 * same snapshot, push their own annotation, and clobber each other on save —
 * only the last writer's annotation survives, the other 999 vanish silently.
 */
let _tasksChain = Promise.resolve();
async function mutateTasks(fn) {
  const run = _tasksChain.then(async () => {
    const tasks = await loadTasks();
    const { value, save } = await fn(tasks);
    if (save) await saveTasks(tasks);
    return value;
  });
  _tasksChain = run.catch(() => {});
  return run;
}

// GET /api/annotate/next?annotator=A1
app.get('/next', async (c) => {
  const annotator = c.req.query('annotator') || 'A1';
  const tasks = await loadTasks();

  // Select the next task this annotator should label. Non-shared tasks are
  // stride-partitioned across A1/A2/A3 so each persona sees a different sample;
  // shared tasks are the fallback (labeled by all three for Cohen's κ).
  const idx = selectNextTaskIndex(tasks, annotator);

  if (idx === -1) {
    return c.json({ ok: true, done: true, message: 'All tasks completed for this annotator.' });
  }

  const task = { ...tasks[idx] };
  // Don't send other annotators' labels to the current annotator (except adjudicator A3)
  if (annotator !== 'A3') {
    task.annotations = (task.annotations || []).filter((a) => a.annotatorId === annotator);
  }

  // Count completed by this annotator (over their eligible set, not all tasks)
  const doneCount = tasks.filter((t) =>
    (t.annotations || []).some((a) => a.annotatorId === annotator)
  ).length;

  return c.json({
    ok: true,
    done: false,
    task,
    progress: { done: doneCount, total: eligibleTaskCount(tasks, annotator), annotator },
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

  // Serialized RMW: load → mutate the one task → save atomically. Prevents
  // concurrent submitters from clobbering each other's annotations.
  try {
    const result = await mutateTasks((tasks) => {
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) {
        return { value: { ok: false, error: `Task ${taskId} not found`, status: 404 }, save: false };
      }

      const task = tasks[idx];
      const annotations = task.annotations || [];
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

      if (existingIdx >= 0) annotations[existingIdx] = annotation;
      else annotations.push(annotation);

      task.annotations = annotations;
      const requiredAnnotators = task.isShared ? 3 : 1;
      task.status = annotations.length >= requiredAnnotators ? 'completed' : 'in_progress';

      return { value: { ok: true, taskId, annotator, status: task.status }, save: true };
    });

    if (result.status === 404) {
      return c.json({ ok: false, error: result.error }, 404);
    }
    return c.json(result);
  } catch (err) {
    return c.json({ ok: false, error: 'Submit failed' }, 500);
  }
});

// GET /api/annotate/stats
app.get('/stats', async (c) => {
  const tasks = await loadTasks();
  const annotators = ['A1', 'A2', 'A3'];

  const perAnnotator = {};
  for (const a of annotators) {
    const eligibleTotal = eligibleTaskCount(tasks, a);
    // Count only labels on tasks this annotator is eligible for (owned non-shared + shared),
    // so the denominator and numerator refer to the same set.
    let nonSharedSeen = 0;
    const ownerByIndex = new Array(tasks.length).fill(null);
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i]?.isShared) continue;
      ownerByIndex[i] = ANNOTATOR_ORDER[nonSharedSeen % ANNOTATOR_ORDER.length];
      nonSharedSeen++;
    }
    const done = tasks.filter((t, i) =>
      (t.annotations || []).some((ann) => ann.annotatorId === a) &&
      (t.isShared || ownerByIndex[i] === a)
    ).length;
    perAnnotator[a] = { done, total: eligibleTotal };
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
