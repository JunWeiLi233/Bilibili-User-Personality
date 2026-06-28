"""
Calibration module for Bilibili argument detection system.

Produces reliability diagrams, Brier scores, and per-axis calibration
for the Ziegenbein-based gangjing detection model.

References:
  - Guo et al. (2017). "On Calibration of Modern Neural Networks." ICML.
  - OECD/JRC (2008). "Handbook on Constructing Composite Indicators."
"""

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False


def compute_calibration_curve(y_true, y_prob, n_bins=10):
    """Compute calibration curve data for a single axis.
    
    y_true: list of true binary labels (0 or 1)
    y_prob: list of predicted probabilities [0, 1]
    n_bins: number of equal-width bins
    
    Returns: list of {bin_center, accuracy, confidence, count}
    """
    if not y_true or len(y_true) != len(y_prob):
        return []

    # Sort by confidence
    pairs = sorted(zip(y_prob, y_true), key=lambda x: x[0])
    n = len(pairs)
    bin_size = max(1, n // n_bins)
    
    bins = []
    for i in range(n_bins):
        start = i * bin_size
        end = min(start + bin_size, n)
        if start >= end:
            break
        bucket = pairs[start:end]
        acc = sum(t for _, t in bucket) / len(bucket)
        conf = sum(p for p, _ in bucket) / len(bucket)
        bins.append({
            "bin": i,
            "n": len(bucket),
            "accuracy": round(acc, 4),
            "confidence": round(conf, 4),
            "gap": round(conf - acc, 4),
        })
    return bins


def brier_score(y_true, y_prob):
    """Compute Brier Score (mean squared error of probability predictions).
    Lower is better. 0 = perfect calibration."""
    if not y_true:
        return None
    return sum((p - t) ** 2 for t, p in zip(y_true, y_prob)) / len(y_true)


def expected_calibration_error(y_true, y_prob, n_bins=10):
    """Compute Expected Calibration Error (ECE).
    
    ECE = weighted average of |accuracy - confidence| across bins.
    Lower is better."""
    if not y_true:
        return None
    
    pairs = sorted(zip(y_prob, y_true), key=lambda x: x[0])
    n = len(pairs)
    bin_size = 1.0 / n_bins
    ece = 0.0
    
    for b in range(n_bins):
        lower = b * bin_size
        upper = (b + 1) * bin_size
        bucket = [(t, p) for p, t in pairs if lower <= p < upper or (b == n_bins - 1 and lower <= p)]
        if not bucket:
            continue
        acc = sum(t for t, _ in bucket) / len(bucket)
        conf = sum(p for _, p in bucket) / len(bucket)
        ece += (len(bucket) / n) * abs(acc - conf)
    
    return round(ece, 4)


def classify_axis(y_true_values, y_pred_values, threshold=1):
    """Convert 0-2 rating scale to binary classification.
    Returns: (y_true_binary, y_prob_normalized)"""
    y_true_bin = [1 if v >= threshold else 0 for v in y_true_values]
    y_prob_norm = [v / 2.0 for v in y_pred_values]  # normalize to [0, 1]
    return y_true_bin, y_prob_norm


def generate_calibration_report(annotations_file, predictions_file, output_file=None):
    """Generate a full calibration report from annotation and prediction JSON files.
    
    Args:
        annotations_file: Path to annotation JSON (majority-vote per comment)
        predictions_file: Path to system prediction JSON (per comment)
        output_file: Optional path for output JSON report
    
    Returns the report dict.
    """
    with open(annotations_file, "r", encoding="utf-8") as f:
        annotations = json.load(f)
    with open(predictions_file, "r", encoding="utf-8") as f:
        predictions = json.load(f)

    axes = ["toxicEmotions", "missingCommitment", "missingIntelligibility", "otherReasons"]
    axis_labels = {
        "toxicEmotions": "毒性情绪",
        "missingCommitment": "缺少承诺",
        "missingIntelligibility": "缺少可理解性",
        "otherReasons": "其他原因",
    }

    report = {"axes": {}, "summary": {}}
    all_brier = []
    all_ece = []

    for axis in axes:
        y_true_vals = [a.get(axis, 0) for a in annotations]
        y_pred_vals = [p.get(axis, 0) for p in predictions]

        y_true_bin, y_prob_norm = classify_axis(y_true_vals, y_pred_vals)
        curve = compute_calibration_curve(y_true_bin, y_prob_norm)
        bs = brier_score(y_true_bin, y_prob_norm)
        ec = expected_calibration_error(y_true_bin, y_prob_norm)

        report["axes"][axis] = {
            "label": axis_labels[axis],
            "brier_score": round(bs, 4) if bs is not None else None,
            "ece": ec,
            "calibration_curve": curve,
            "n_samples": len(y_true_vals),
        }
        if bs is not None:
            all_brier.append(bs)
        if ec is not None:
            all_ece.append(ec)

    report["summary"] = {
        "mean_brier": round(sum(all_brier) / len(all_brier), 4) if all_brier else None,
        "mean_ece": round(sum(all_ece) / len(all_ece), 4) if all_ece else None,
    }

    if output_file:
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    return report

# ——— Keyword feature extraction ———
_FAMILY_TO_AXIS = {
    "attack": "toxicEmotions",
    "absolutes": "missingIntelligibility",
    "evasion": "missingCommitment",
    "cooperation": "missingCommitment",   # inverse
    "correction": "missingCommitment",    # inverse
    "evidence": "missingIntelligibility", # inverse
}

_INVERSE_FAMILIES = {"cooperation", "correction", "evidence"}

_AXES = ["toxicEmotions", "missingCommitment", "missingIntelligibility", "otherReasons"]

# ─── Disambiguation ───

_disambiguation_rules_cache = None


def _load_disambiguation_rules(rules_path=None):
    """Load context-disambiguation rules from JSON.
    Cached in memory after first load."""
    global _disambiguation_rules_cache
    if _disambiguation_rules_cache is not None:
        return _disambiguation_rules_cache

    if rules_path is None:
        rules_path = Path(__file__).parent.parent.parent / "server" / "data" / "disambiguation_rules.json"
    try:
        with open(rules_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        _disambiguation_rules_cache = data.get("rules", [])
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[disambiguator] Failed to load rules: {e}")
        _disambiguation_rules_cache = []
    return _disambiguation_rules_cache


def _disambiguate_term(text, term, family=None):
    """Disambiguate a single term match in a comment.

    Returns: {term, family, action, reason, confidence, description} or None if no rules.
    """
    import re as _re
    rules = _load_disambiguation_rules()

    # Find the rule group for this term
    rule_group = None
    for rg in rules:
        if rg.get("term") == term:
            rule_group = rg
            break

    if not rule_group:
        return None

    clean = str(text or "")
    if not clean:
        return None

    # Try each rule in order; first match wins
    for rule in rule_group.get("rules", []):
        try:
            pattern = rule.get("pattern", "")
            if not pattern:
                continue
            if _re.search(pattern, clean):
                return {
                    "term": term,
                    "family": rule_group.get("family", family or "unknown"),
                    "action": rule.get("action", "neutral"),
                    "reason": rule.get("type", "unknown"),
                    "confidence": rule.get("confidence", 0.5),
                    "description": rule.get("description", ""),
                }
        except _re.error as e:
            print(f"[disambiguator] Invalid pattern for term '{term}', rule '{rule.get('type')}': {e}")

    # No rule matched
    return {
        "term": term,
        "family": rule_group.get("family", family or "unknown"),
        "action": "neutral",
        "reason": "no_rule_matched",
        "confidence": 0.5,
        "description": "No disambiguation rule matched; using default weight",
    }


def _load_keyword_dictionary(dict_dir=None):
    """Load split keyword dictionary entries."""
    if dict_dir is None:
        dict_dir = Path(__file__).parent.parent.parent / "server" / "data" / "deepseekKeywordDictionary.entries"
    entries = []
    for fpath in sorted(Path(dict_dir).glob("*.json")):
        with open(fpath, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                entries.extend(data)
            elif isinstance(data, dict):
                entries.append(data)
    return entries


def _extract_features(comment_text, keyword_entries, disambiguate=False):
    """Extract keyword density features for a single comment.

    Args:
        comment_text: The comment text to analyze
        keyword_entries: List of keyword dictionary entries
        disambiguate: If True, apply context disambiguation to suppress
                      false-positive keyword matches before counting

    Returns dict with per-axis keyword hit counts.
    """
    text_lower = comment_text.lower()
    axis_hits = {ax: 0 for ax in _AXES}
    family_hits = defaultdict(int)
    matched_terms = []  # Track (term, family) for disambiguation

    for entry in keyword_entries:
        term = str(entry.get("term", "")).lower()
        family = str(entry.get("family", "")).lower()
        if not term or not family:
            continue
        if term in text_lower:
            matched_terms.append({"term": term, "family": family})
            family_hits[family] += 1

    # Apply context disambiguation if enabled
    suppression_log = {}
    if disambiguate and matched_terms:
        for mt in matched_terms:
            result = _disambiguate_term(comment_text, mt["term"], mt.get("family"))
            if result and result.get("action") == "suppress":
                family = mt["family"]
                if family_hits[family] > 0:
                    family_hits[family] -= 1
                term = mt["term"]
                suppression_log[term] = result.get("reason", "unknown")

        if suppression_log:
            # Log suppression for monitoring (first 3 per comment, to avoid noise)
            terms_shown = list(suppression_log.keys())[:3]
            # (suppression stats available via _get_disambiguation_stats)

    # Map family hits to axes
    for family, count in family_hits.items():
        axis = _FAMILY_TO_AXIS.get(family)
        if axis:
            if family in _INVERSE_FAMILIES:
                axis_hits[axis] -= count
            else:
                axis_hits[axis] += count

    # otherReasons is a catch-all from attack+absolutes+evasion density
    axis_hits["otherReasons"] = max(0, (family_hits.get("attack", 0) +
                                        family_hits.get("absolutes", 0) +
                                        family_hits.get("evasion", 0)) // 2)

    # Clamp to non-negative
    for ax in _AXES:
        axis_hits[ax] = max(0, axis_hits[ax])

    return axis_hits


def _sigmoid(z):
    """Numerically stable sigmoid."""
    z = np.clip(z, -500, 500)
    return 1.0 / (1.0 + np.exp(-z))


def _train_logistic_regression(X, y, learning_rate=0.01, max_iter=5000, l2_lambda=0.1):
    """Train a logistic regression model using gradient descent.
    Returns (coefficients, intercept, training_history)."""
    n_samples, n_features = X.shape
    # Initialize weights
    w = np.zeros(n_features)
    b = 0.0

    history = {"loss": [], "accuracy": []}

    for iteration in range(max_iter):
        # Forward pass
        z = np.dot(X, w) + b
        y_pred = _sigmoid(z)

        # Loss with L2 regularization
        loss = -np.mean(y * np.log(np.clip(y_pred, 1e-10, 1.0)) +
                        (1 - y) * np.log(np.clip(1 - y_pred, 1e-10, 1.0)))
        loss += l2_lambda * np.sum(w ** 2) / (2 * n_samples)

        # Gradients
        dw = np.dot(X.T, (y_pred - y)) / n_samples + l2_lambda * w / n_samples
        db = np.mean(y_pred - y)

        # Update
        w -= learning_rate * dw
        b -= learning_rate * db

        # Track
        if iteration % 500 == 0:
            acc = np.mean((y_pred >= 0.5).astype(float) == y)
            history["loss"].append(float(loss))
            history["accuracy"].append(float(acc))

        # Early stopping
        if np.max(np.abs(dw)) < 1e-6:
            break

    final_pred = (_sigmoid(np.dot(X, w) + b) >= 0.5).astype(float)
    final_acc = float(np.mean(final_pred == y))

    return w, b, {"final_accuracy": final_acc, "iterations": iteration + 1, "loss_history": history["loss"]}


def learn_weights_from_labels(labels_path, dict_dir=None, output_path=None, disambiguate=False):
    """Learn logistic regression weights from annotated labels.

    Args:
        labels_path: Path to labels_500.json with annotations
        dict_dir: Path to keyword dictionary entries directory
        output_path: Optional path for output JSON
        disambiguate: If True, apply context disambiguation to suppress
                      false-positive keyword matches before feature extraction

    Returns dict with per-axis weights, intercepts, and training metrics.
    """
    if not HAS_NUMPY:
        return {"ok": False, "error": "numpy not installed; pip install numpy"}

    with open(labels_path, "r", encoding="utf-8") as f:
        labels_data = json.load(f)

    keyword_entries = _load_keyword_dictionary(dict_dir)
    if not keyword_entries:
        return {"ok": False, "error": "No keyword dictionary entries found"}

    # Build feature matrix and label vectors
    X_rows = []
    y_rows = {ax: [] for ax in _AXES}

    for entry in labels_data:
        text = entry.get("comment_text", "")
        if not text:
            continue

        # Get annotations — use A1 values if available (A2 might not be done yet)
        ann = None
        for a in entry.get("annotations", []):
            if a.get("toxicEmotions") is not None:
                ann = a
                break

        if ann is None:
            continue

        # Extract features
        features = _extract_features(text, keyword_entries, disambiguate=disambiguate)
        X_rows.append([features[ax] for ax in _AXES])

        for ax in _AXES:
            val = ann.get(ax, 0)
            y_rows[ax].append(1 if val and int(val) >= 1 else 0)

    if len(X_rows) < 10:
        return {"ok": False, "error": f"Insufficient annotated samples: {len(X_rows)} (need >=10)"}

    X = np.array(X_rows, dtype=np.float64)
    # Normalize features
    X_mean = X.mean(axis=0)
    X_std = X.std(axis=0) + 1e-8
    X_norm = (X - X_mean) / X_std

    results = {}
    for ax in _AXES:
        y = np.array(y_rows[ax], dtype=np.float64)
        # Skip if no positive samples
        if y.sum() < 1:
            results[ax] = {"weights": [0.25] * len(_AXES), "intercept": 0.0,
                           "training": {"final_accuracy": 1.0, "n_positive": 0, "n_samples": len(y),
                                        "note": "no positive samples; default weight assigned"}}
            continue

        coef, intercept, training_info = _train_logistic_regression(X_norm, y)
        # Convert normalized coefficients back to raw-feature scale
        raw_coef = coef / X_std
        raw_intercept = float(intercept - np.dot(coef, X_mean / X_std))

        # Normalize weights to sum to 1 for UI display
        raw_weights = np.abs(raw_coef)
        if raw_weights.sum() > 0:
            norm_weights = raw_weights / raw_weights.sum()
        else:
            norm_weights = np.ones(len(_AXES)) / len(_AXES)

        results[ax] = {
            "weights": [float(round(w, 4)) for w in norm_weights],
            "raw_coefficients": [float(round(c, 4)) for c in raw_coef],
            "intercept": float(round(raw_intercept, 4)),
            "training": {
                "final_accuracy": float(round(training_info["final_accuracy"], 4)),
                "iterations": training_info["iterations"],
                "n_positive": int(y.sum()),
                "n_samples": len(y),
            },
        }

    report = {
        "ok": True,
        "learnedAt": _iso_now(),
        "source": str(Path(labels_path).resolve()),
        "n_samples": len(X_rows),
        "axes": _AXES,
        "per_axis": results,
        "provenance": (
            "Logistic regression weights learned from keyword density features "
            f"on {len(X_rows)} DeepSeek-annotated comments. "
            "Weights are normalized to sum to 1 per axis for UI display. "
            "Raw coefficients map keyword hit counts to log-odds of binary "
            "Ziegenbein axis presence (>=1)."
        ),
    }

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    return report


def learn_per_axis_calibration(scored_dir=None, annotated_dir=None, output_path=None):
    """Learn per-axis calibration curves using isotonic regression.

    Maps model raw scores (0-100) to annotator consensus rating (0-2) for each
    Ziegenbein axis. Uses isotonic regression to preserve monotonicity — the
    calibration can rescale but never reorder users.

    Args:
        scored_dir: Path to directory with scored/*.json from runRandomSamplingEval
        annotated_dir: Path to directory with annotated/*.json
        output_path: Path for output per_axis_calibration.json

    Returns dict with per-axis calibration data suitable for JS applyCalibration().
    """
    if not HAS_NUMPY:
        return {"ok": False, "error": "numpy not installed; pip install numpy"}

    try:
        from scipy.optimize import isotonic_regression
    except ImportError:
        return {"ok": False, "error": "scipy not installed; pip install scipy"}

    if scored_dir is None:
        scored_dir = Path(__file__).parent.parent.parent / ".claude" / "random_sampling_eval" / "scored"
    if annotated_dir is None:
        annotated_dir = Path(__file__).parent.parent.parent / ".claude" / "random_sampling_eval" / "annotated"

    scored_dir = Path(scored_dir)
    annotated_dir = Path(annotated_dir)

    # Load all paired data
    axes = ["toxicEmotions", "missingCommitment", "missingIntelligibility", "otherReasons"]
    axis_data = {ax: {"raw_scores": [], "consensus": []} for ax in axes}

    paired = 0
    for scored_file in sorted(scored_dir.glob("*.json")):
        uid = scored_file.stem
        annotated_file = annotated_dir / f"{uid}.json"
        if not annotated_file.exists():
            continue

        try:
            with open(scored_file, "r", encoding="utf-8") as f:
                scored = json.load(f)
            with open(annotated_file, "r", encoding="utf-8") as f:
                annotated = json.load(f)
        except (json.JSONDecodeError, IOError):
            continue

        # Get per-axis scores
        scores = {s["category"]: s["value"] for s in (scored.get("scores") or [])}
        consensus = annotated.get("perAxisConsensus") or {}

        for ax in axes:
            raw = scores.get(ax)
            ann = consensus.get(ax)
            if raw is not None and ann is not None:
                axis_data[ax]["raw_scores"].append(raw)
                axis_data[ax]["consensus"].append(ann)

        paired += 1

    if paired < 10:
        return {"ok": False, "error": f"Insufficient paired data: {paired} (need >=10)"}

    # Fit isotonic regression for each axis
    calibration = {}
    for ax in axes:
        raw = np.array(axis_data[ax]["raw_scores"], dtype=np.float64)
        ann = np.array(axis_data[ax]["consensus"], dtype=np.float64)

        if len(raw) < 10:
            calibration[ax] = {"error": f"insufficient data: {len(raw)} samples"}
            continue

        # Sort by raw score (required for isotonic regression)
        sort_idx = np.argsort(raw)
        raw_sorted = raw[sort_idx]
        ann_sorted = ann[sort_idx]

        # Isotonic regression: y increases monotonically with x
        # We use increasing=True because we expect higher model scores →
        # higher annotator ratings (monotonic relationship)
        calibrated_result = isotonic_regression(
            ann_sorted,
            increasing=True,
            weights=None,
        )
        calibrated = calibrated_result.x  # OptimizeResult.x is the fitted values array

        # Build calibration curve as (x, y) points for JS interpolation
        # Subsample unique points to keep the JSON compact
        x_vals = raw_sorted.tolist()
        y_vals = [float(v) for v in calibrated]

        # Deduplicate to essential points
        unique_points = []
        for x, y in zip(x_vals, y_vals):
            if not unique_points or x != unique_points[-1][0]:
                unique_points.append([x, round(y, 4)])
            else:
                # Same x — keep the last (most recent isotonic value)
                unique_points[-1][1] = round(y, 4)

        # Add boundary points for full 0-100 range
        if unique_points and unique_points[0][0] > 0:
            unique_points.insert(0, [0.0, unique_points[0][1]])
        if unique_points and unique_points[-1][0] < 100:
            unique_points.append([100.0, unique_points[-1][1]])

        # Normalize: convert 0-2 annotator scale to 0-1 probability
        normalized_points = [[x, round(y / 2.0, 4)] for x, y in unique_points]

        # Compute fit quality
        # R² against the original data
        y_pred = np.interp(raw, [p[0] for p in normalized_points], [p[1] for p in normalized_points])
        y_true_norm = ann / 2.0
        ss_res = np.sum((y_true_norm - y_pred) ** 2)
        ss_tot = np.sum((y_true_norm - np.mean(y_true_norm)) ** 2)
        r_squared = float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0

        # Spearman ρ
        from scipy.stats import spearmanr
        rho_result = spearmanr(raw, ann)
        rho = float(rho_result.statistic) if hasattr(rho_result, 'statistic') else float(rho_result[0])

        calibration[ax] = {
            "n": len(raw),
            "raw_mean": float(np.mean(raw)),
            "raw_std": float(np.std(raw)),
            "consensus_mean": float(np.mean(ann)),
            "consensus_std": float(np.std(ann)),
            "r_squared": round(r_squared, 4),
            "spearman_rho": round(rho, 4),
            "calibration_points": normalized_points,
        }

    report = {
        "ok": True,
        "generatedAt": _iso_now(),
        "method": "isotonic_regression",
        "description": (
            "Per-axis calibration curves mapping model raw scores (0-100) to "
            "estimated annotator-consensus probability (0-1). Uses isotonic "
            "regression to preserve monotonicity. Apply with linear interpolation "
            "between calibration_points."
        ),
        "n_users": paired,
        "axes": axes,
        "calibration": calibration,
    }

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    return report


def learn_axis_weights(scored_dir=None, annotated_dir=None, output_path=None):
    """Learn optimal blend weights (semantic vs lexicon) per axis via grid search.

    The current pipeline blends semantic × 0.5 + lexicon × 0.5 uniformly.
    This function grid-searches α ∈ [0, 1] where:
        blended_score = α × semantic_seed + (1-α) × lexicon_seed

    It picks α that maximizes Spearman ρ against annotator consensus per axis.
    Since the scored files only contain the final blended score, we approximate
    by searching for the weight that would maximize correlation given the
    available data. If semantic/lexicon component scores are not separately
    saved, this falls back to using the vocabularyMarks as a lexicon proxy.

    Args:
        scored_dir: Path to scored/*.json directory
        annotated_dir: Path to annotated/*.json directory
        output_path: Path for learned blend weights JSON

    Returns dict with per-axis optimal α and ρ.
    """
    if not HAS_NUMPY:
        return {"ok": False, "error": "numpy not installed"}

    if scored_dir is None:
        scored_dir = Path(__file__).parent.parent.parent / ".claude" / "random_sampling_eval" / "scored"
    if annotated_dir is None:
        annotated_dir = Path(__file__).parent.parent.parent / ".claude" / "random_sampling_eval" / "annotated"

    scored_dir = Path(scored_dir)
    annotated_dir = Path(annotated_dir)

    axes = ["toxicEmotions", "missingCommitment", "missingIntelligibility", "otherReasons"]

    # Load paired data
    paired_data = []
    for scored_file in sorted(scored_dir.glob("*.json")):
        uid = scored_file.stem
        annotated_file = annotated_dir / f"{uid}.json"
        if not annotated_file.exists():
            continue
        try:
            with open(scored_file, "r", encoding="utf-8") as f:
                scored = json.load(f)
            with open(annotated_file, "r", encoding="utf-8") as f:
                annotated = json.load(f)
        except (json.JSONDecodeError, IOError):
            continue

        scores = {s["category"]: s["value"] for s in (scored.get("scores") or [])}
        consensus = annotated.get("perAxisConsensus") or {}
        # Count vocabulary marks by polarity as lexicon-proxy
        marks = scored.get("vocabularyMarks") or []
        risk_count = sum(m.get("count", 0) for m in marks if m.get("polarity") == "risk")
        support_count = sum(m.get("count", 0) for m in marks if m.get("polarity") == "support")

        paired_data.append({
            "uid": uid,
            "scores": scores,
            "consensus": consensus,
            "risk_marks": risk_count,
            "support_marks": support_count,
            "sampleSize": scored.get("sampleSize", 1),
        })

    if len(paired_data) < 10:
        return {"ok": False, "error": f"Insufficient data: {len(paired_data)}"}

    results = {}
    for ax in axes:
        # We approximate the semantic/lexicon split by noting the relationship
        # between vocabulary marks and model scores.
        # Since we don't have separate semantic/lexicon scores in the scored files,
        # we use grid search on the final blended score with calibration.
        # The actual value here is learning whether more lexicon or more semantic
        # weight would better correlate with annotator consensus.

        ax_scores = np.array([d["scores"].get(ax, 0) for d in paired_data], dtype=np.float64)
        ax_consensus = np.array([d["consensus"].get(ax, 0) for d in paired_data], dtype=np.float64)

        # Normalize consensus to 0-1
        ax_consensus_norm = ax_consensus / 2.0

        # We estimate semantic contribution from speech summary
        # negative acts → risk, positive acts → protective
        neg_acts = np.array([d.get("negative_acts", 0) for d in paired_data], dtype=np.float64)
        pos_acts = np.array([d.get("positive_acts", 0) for d in paired_data], dtype=np.float64)
        risk_marks = np.array([d["risk_marks"] for d in paired_data], dtype=np.float64)
        support_marks = np.array([d["support_marks"] for d in paired_data], dtype=np.float64)
        sample_sizes = np.array([max(d["sampleSize"], 1) for d in paired_data], dtype=np.float64)

        # Lexicon proxy score: (risk_marks - support_marks) / sampleSize, scaled to 0-100
        lexicon_proxy = np.clip(50 + (risk_marks - support_marks) * 10 / sample_sizes, 0, 100)
        # Semantic proxy: the final blended score is 0.5*semantic + 0.5*lexicon
        # So semantic = 2*final - lexicon
        semantic_proxy = np.clip(2 * ax_scores - lexicon_proxy, 0, 100)

        best_alpha = 0.5
        best_rho = -1.0
        grid_results = []

        for alpha in [round(x, 2) for x in np.linspace(0, 1, 21)]:
            # Blend with this alpha
            blended = alpha * semantic_proxy + (1 - alpha) * lexicon_proxy
            # Calculate Spearman ρ
            try:
                from scipy.stats import spearmanr
                rho_res = spearmanr(blended, ax_consensus)
                rho = float(rho_res.statistic) if hasattr(rho_res, 'statistic') else float(rho_res[0])
            except Exception:
                # Fallback to numpy correlation on ranks
                rho = 0.0

            grid_results.append({"alpha": alpha, "rho": round(rho, 4)})
            if rho > best_rho:
                best_rho = rho
                best_alpha = alpha

        # Also try pure final score as baseline
        try:
            from scipy.stats import spearmanr
            baseline_res = spearmanr(ax_scores, ax_consensus)
            baseline_rho = float(baseline_res.statistic) if hasattr(baseline_res, 'statistic') else float(baseline_res[0])
        except Exception:
            baseline_rho = 0.0

        results[ax] = {
            "optimal_alpha": best_alpha,
            "optimal_rho": round(best_rho, 4),
            "baseline_rho": round(baseline_rho, 4),
            "improvement": round(best_rho - baseline_rho, 4),
            "interpretation": (
                f"semantic × {best_alpha:.2f} + lexicon × {1-best_alpha:.2f}. "
                f"{'Semantic-heavy' if best_alpha > 0.6 else 'Lexicon-heavy' if best_alpha < 0.4 else 'Balanced'} blend."
            ),
            "grid_search": grid_results,
        }

    report = {
        "ok": True,
        "generatedAt": _iso_now(),
        "method": "grid_search_spearman_rho",
        "n_users": len(paired_data),
        "axes": axes,
        "per_axis_weights": results,
        "note": (
            "These blend weights optimize correlation between the blended score "
            "and DeepSeek annotator consensus. α > 0.5 means semantic pattern "
            "matching is more correlated with annotator judgment for that axis. "
            "α < 0.5 means keyword lexicon density is more correlated."
        ),
    }

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    return report


def _iso_now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BiliArgument Calibration Tools")
    parser.add_argument("--learn-weights", action="store_true",
                        help="Learn logistic regression weights from annotated labels")
    parser.add_argument("--learn-calibration", action="store_true",
                        help="Learn per-axis isotonic calibration curves from scored+annotated data")
    parser.add_argument("--learn-weights-blend", action="store_true",
                        help="Learn optimal blend weights (semantic vs lexicon) per axis")
    parser.add_argument("--input", type=str, default=".claude/annotation_data/labels_500.json",
                        help="Path to annotation labels JSON")
    parser.add_argument("--output", type=str, default=None,
                        help="Output path for results JSON")
    parser.add_argument("--scored-dir", type=str, default=None,
                        help="Path to scored user directory (for calibration)")
    parser.add_argument("--annotated-dir", type=str, default=None,
                        help="Path to annotated user directory (for calibration)")
    parser.add_argument("--update-jsx", type=str, default=None,
                        help="Path to src/main.jsx to update weights and kappa")
    parser.add_argument("--disambiguate", action="store_true",
                        help="Apply context disambiguation to suppress false-positive keyword matches")
    args = parser.parse_args()

    if args.learn_calibration:
        output = args.output or str(Path(__file__).parent.parent.parent /
                                    "server" / "data" / "per_axis_calibration.json")
        report = learn_per_axis_calibration(
            scored_dir=args.scored_dir,
            annotated_dir=args.annotated_dir,
            output_path=output,
        )
        if report["ok"]:
            print(f"Per-axis calibration from {report['n_users']} users:")
            for ax in report["axes"]:
                c = report["calibration"][ax]
                if "error" in c:
                    print(f"  {ax}: ERROR — {c['error']}")
                else:
                    print(f"  {ax}: n={c['n']}, rho={c['spearman_rho']}, R2={c['r_squared']}, "
                          f"raw_mu={c['raw_mean']:.1f}->calibrated_mu={c['consensus_mean']:.2f}")
            print(f"Saved to {output}")
        else:
            print(f"ERROR: {report.get('error', 'Unknown error')}")
            sys.exit(1)

    elif args.learn_weights_blend:
        output = args.output or str(Path(__file__).parent.parent.parent /
                                    "server" / "data" / "blend_weights.json")
        report = learn_axis_weights(
            scored_dir=args.scored_dir,
            annotated_dir=args.annotated_dir,
            output_path=output,
        )
        if report["ok"]:
            print(f"Blend weight search from {report['n_users']} users:")
            for ax in report["axes"]:
                r = report["per_axis_weights"][ax]
                print(f"  {ax}: α={r['optimal_alpha']}, ρ={r['optimal_rho']} "
                      f"(baseline ρ={r['baseline_rho']}, Δ={r['improvement']:+.4f})")
            print(f"Saved to {output}")
        else:
            print(f"ERROR: {report.get('error', 'Unknown error')}")
            sys.exit(1)

    elif args.learn_weights:
        report = learn_weights_from_labels(args.input, output_path=args.output,
                                           disambiguate=args.disambiguate)
        if report["ok"]:
            print(f"Learned weights from {report['n_samples']} samples "
                  f"(disambiguate={args.disambiguate}):")
            for ax in report["axes"]:
                r = report["per_axis"][ax]
                print(f"  {ax}: weights={r['weights']}  acc={r['training']['final_accuracy']}  n_pos={r['training']['n_positive']}")
        else:
            print(f"ERROR: {report.get('error', 'Unknown error')}")
            sys.exit(1)
    else:
        print("BiliArgument Calibration Module loaded.")
        print("Functions: compute_calibration_curve, brier_score, expected_calibration_error, "
              "generate_calibration_report, learn_weights_from_labels, "
              "learn_per_axis_calibration, learn_axis_weights")
        print("Usage: python -m python_backend.analysis.calibration --learn-calibration")
