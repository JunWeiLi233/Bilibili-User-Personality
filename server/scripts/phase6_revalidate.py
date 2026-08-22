"""Phase 6: Re-validate — Before/After comparison of calibrated pipeline."""
import json, math
import numpy as np
from pathlib import Path
from scipy.stats import spearmanr

ROOT = Path(__file__).parent.parent.parent  # server/scripts/ → repo root
scored_dir = ROOT / ".claude" / "random_sampling_eval" / "scored"
annotated_dir = ROOT / ".claude" / "random_sampling_eval" / "annotated"

# Load configs
with open(ROOT / "server" / "data" / "scoring_config.json", encoding="utf-8") as f:
    config = json.load(f)
with open(ROOT / "server" / "data" / "term_precision_audit.json", encoding="utf-8") as f:
    audit = json.load(f)

cal = config["calibration"]
downweight = audit.get("downweightFactors", {})
opt_threshold = config["optimalThreshold"]["value"]
axes = ["toxicEmotions", "missingCommitment", "missingIntelligibility", "otherReasons"]
troll_weights = config["trollWeights"]


def interp(points, raw):
    if raw <= points[0][0]:
        return points[0][1]
    if raw >= points[-1][0]:
        return points[-1][1]
    for i in range(len(points) - 1):
        if raw >= points[i][0] and raw <= points[i + 1][0]:
            frac = (raw - points[i][0]) / (points[i + 1][0] - points[i][0])
            return points[i][1] + frac * (points[i + 1][1] - points[i][1])
    return raw / 100.0


results = []
for sf in sorted(scored_dir.glob("*.json")):
    uid = sf.stem
    af = annotated_dir / f"{uid}.json"
    if not af.exists():
        continue

    s = json.loads(sf.read_text("utf-8"))
    a = json.loads(af.read_text("utf-8"))

    scores_raw = {x["category"]: x["value"] for x in (s.get("scores") or [])}
    consensus = a.get("perAxisConsensus", {})
    binary = a.get("binaryLabels", {})
    troll_original = s.get("trollIndex", 0)

    # Compute calibrated troll_index
    cal_scores = {}
    calibrated_troll = 0
    for ax in axes:
        raw = scores_raw.get(ax, 0)
        cal_prob = interp(cal[ax]["calibration_points"], raw)
        cal_val = cal_prob * 100
        cal_scores[ax] = cal_val
        calibrated_troll += cal_val * troll_weights[ax]

    actual = 1 if any(binary.values()) else 0

    results.append({
        "uid": uid,
        "troll_original": troll_original,
        "troll_calibrated": round(calibrated_troll, 1),
        "scores_raw": scores_raw,
        "scores_calibrated": cal_scores,
        "actual": actual,
        "consensus": consensus,
    })


def compute_auc(pairs, key):
    sorted_pairs = sorted(pairs, key=lambda x: x[key], reverse=True)
    n_pos = sum(p["actual"] for p in sorted_pairs)
    n_neg = len(sorted_pairs) - n_pos
    if n_pos == 0 or n_neg == 0:
        return 0.5
    tp = fp = 0
    auc = prev_fpr = prev_tpr = 0
    for p in sorted_pairs:
        if p["actual"]:
            tp += 1
        else:
            fp += 1
        tpr = tp / n_pos
        fpr = fp / n_neg
        auc += (fpr - prev_fpr) * (tpr + prev_tpr) / 2
        prev_fpr, prev_tpr = fpr, tpr
    return auc


def find_best_f1(pairs, key, thresholds):
    best = None
    for t in thresholds:
        pred = [1 if p[key] >= t else 0 for p in pairs]
        tp = sum(1 for pr, a in zip(pred, [p["actual"] for p in pairs]) if pr == 1 and a == 1)
        fp = sum(1 for pr, a in zip(pred, [p["actual"] for p in pairs]) if pr == 1 and a == 0)
        fn = sum(1 for pr, a in zip(pred, [p["actual"] for p in pairs]) if pr == 0 and a == 1)
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0
        if best is None or f1 > best["f1"]:
            best = {"threshold": t, "precision": prec, "recall": rec, "f1": f1, "tp": tp, "fp": fp, "fn": fn}
    return best


print("=== Phase 6: Re-validation ===")
print(f"N = {len(results)} paired users")
print()

auc_before = compute_auc(results, "troll_original")
auc_after = compute_auc(results, "troll_calibrated")

f1_before = find_best_f1(results, "troll_original", range(0, 55))
f1_after = find_best_f1(results, "troll_calibrated", range(0, 30))

print("--- Before/After Comparison ---")
print(f"| Metric | Before | After | Target |")
print(f"|---|---|---|---|")
print(f"| AUC-ROC | {auc_before:.4f} | {auc_after:.4f} | >= 0.65 |")
print(f"| Best F1 | {f1_before['f1']:.4f} (T={f1_before['threshold']}) | {f1_after['f1']:.4f} (T={f1_after['threshold']}) | >= 0.40 |")
print(f"| Precision | {f1_before['precision']:.4f} | {f1_after['precision']:.4f} | - |")
print(f"| Recall | {f1_before['recall']:.4f} | {f1_after['recall']:.4f} | - |")
print()

print("--- Per-Axis Calibration (After) ---")
for ax in axes:
    y_true = np.array([(p["consensus"].get(ax, 0) / 2.0) for p in results])
    y_prob = np.array([p["scores_calibrated"][ax] / 100.0 for p in results])
    brier = np.mean((y_prob - y_true) ** 2)

    n = len(y_true)
    n_bins = 10
    bin_size = 1.0 / n_bins
    ece = 0
    for b in range(n_bins):
        lower = b * bin_size
        upper = (b + 1) * bin_size
        mask = (y_prob >= lower) & (y_prob < upper)
        if b == n_bins - 1:
            mask = y_prob >= lower
        if mask.sum() == 0:
            continue
        acc = y_true[mask].mean()
        conf = y_prob[mask].mean()
        ece += (mask.sum() / n) * abs(acc - conf)

    rho_res = spearmanr(
        [p["scores_calibrated"][ax] for p in results],
        [p["consensus"].get(ax, 0) for p in results],
    )
    rho_val = float(rho_res.statistic) if hasattr(rho_res, "statistic") else float(rho_res[0])

    print(f"  {ax}: Brier={brier:.4f}, ECE={ece:.4f}, rho={rho_val:.4f}")

print()
print("--- Troll Index Distribution ---")
troll_vals = np.array([p["troll_calibrated"] for p in results])
troll_orig_vals = [p["troll_original"] for p in results]
print(f"  Original: range=[{min(troll_orig_vals)}, {max(troll_orig_vals)}], median={np.median(troll_orig_vals):.1f}")
print(f"  Calibrated: range=[{troll_vals.min():.1f}, {troll_vals.max():.1f}], median={np.median(troll_vals):.1f}")
print(f"  Spread: {troll_vals.max() - troll_vals.min():.1f} points")
print(f"  % >= 50 (original threshold): {sum(1 for p in results if p['troll_original'] >= 50) / len(results) * 100:.1f}%")
print(f"  % >= {opt_threshold} (optimal threshold): {sum(1 for p in results if p['troll_calibrated'] >= opt_threshold) / len(results) * 100:.1f}%")
print(f"  Users flagged: {sum(1 for p in results if p['troll_calibrated'] >= opt_threshold)}/{len(results)}")

print()
print("--- Baseline Reduction ---")
benign = [p for p in results if p["actual"] == 0]
arg_users = [p for p in results if p["actual"] == 1]
te_benign_orig = np.mean([p["scores_raw"]["toxicEmotions"] for p in benign])
te_benign_cal = np.mean([p["scores_calibrated"]["toxicEmotions"] for p in benign])
print(f"  Benign users (n={len(benign)}): toxicEmotions original={te_benign_orig:.1f}, calibrated={te_benign_cal:.1f}")
print(f"  Arg users (n={len(arg_users)}): toxicEmotions original={np.mean([p['scores_raw']['toxicEmotions'] for p in arg_users]):.1f}, calibrated={np.mean([p['scores_calibrated']['toxicEmotions'] for p in arg_users]):.1f}")

# Save comparison data
comparison = {
    "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "n": len(results),
    "before": {
        "auc_roc": round(auc_before, 4),
        "best_f1": round(f1_before["f1"], 4),
        "best_threshold": f1_before["threshold"],
        "precision": round(f1_before["precision"], 4),
        "recall": round(f1_before["recall"], 4),
    },
    "after": {
        "auc_roc": round(auc_after, 4),
        "best_f1": round(f1_after["f1"], 4),
        "best_threshold": f1_after["threshold"],
        "precision": round(f1_after["precision"], 4),
        "recall": round(f1_after["recall"], 4),
        "calibrated_threshold": opt_threshold,
    },
    "troll_index": {
        "original_range": [min(troll_orig_vals), max(troll_orig_vals)],
        "calibrated_range": [float(troll_vals.min()), float(troll_vals.max())],
        "spread_points": float(troll_vals.max() - troll_vals.min()),
        "pct_flagged_at_optimal": round(sum(1 for p in results if p["troll_calibrated"] >= opt_threshold) / len(results) * 100, 1),
    },
    "targets": {
        "auc_roc": 0.65,
        "f1": 0.40,
        "brier": 0.15,
        "ece": 0.15,
    },
}

out_path = ROOT / ".claude" / "random_sampling_eval" / "phase6_comparison.json"
out_path.write_text(json.dumps(comparison, indent=2, ensure_ascii=False), "utf-8")
print(f"\nSaved to {out_path}")
