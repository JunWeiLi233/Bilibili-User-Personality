"""
Validation metrics for Ziegenbein-based annotation.

Computes Cohen's κ, Krippendorff's α, per-axis F1, and calibration curves
for the Bilibili gangjing detection system.

References:
  - Cohen, J. (1960). "A coefficient of agreement for nominal scales."
  - Krippendorff, K. (2011). "Computing Krippendorff's Alpha-Reliability."
  - Ziegenbein et al. (2023). ACL 2023.
"""

import json
import math
import sys
import io
from collections import Counter, defaultdict

# Fix Unicode output on Windows GBK terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
elif hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


_AXES = ["toxicEmotions", "missingCommitment", "missingIntelligibility", "otherReasons"]
_AXIS_LABELS = {
    "toxicEmotions": "毒性情绪",
    "missingCommitment": "缺少承诺",
    "missingIntelligibility": "缺少可理解性",
    "otherReasons": "其他原因",
}


def load_annotations(path):
    """Load annotation JSON file. Expected format:
    [
      {
        "comment_id": "...",
        "comment_text": "...",
        "annotations": [
          {"annotator_id": "A1", "toxicEmotions": 0, ...},
          {"annotator_id": "A2", "toxicEmotions": 1, ...},
          {"annotator_id": "A3", "toxicEmotions": 0, ...}
        ]
      },
      ...
    ]
    """
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_annotator_list(entries, annotator_id):
    """Extract a list of annotation dicts for a specific annotator across all entries."""
    result = []
    for item in entries:
        anns = item.get("annotations", [])
        match = next((a for a in anns if a.get("annotator_id") == annotator_id), None)
        if match:
            result.append(match)
        else:
            result.append({ax: 0 for ax in _AXES})
    return result


def compute_pairwise_kappas(entries, annotator_ids):
    """Compute Cohen's κ for all pairs of annotators.

    Returns {pair_key: {per_axis: {axis: kappa}, overall: kappa}}
    """
    pairwise = {}
    for i, id_a in enumerate(annotator_ids):
        for id_b in annotator_ids[i + 1:]:
            a_list = extract_annotator_list(entries, id_a)
            b_list = extract_annotator_list(entries, id_b)
            pair_key = f"{id_a}-{id_b}"
            result = cohens_kappa(a_list, b_list)
            pairwise[pair_key] = {
                "per_axis": {ax: round(result["per_axis"].get(ax, float("nan")), 4) for ax in _AXES},
                "overall": round(result["overall"], 4) if not (isinstance(result.get("overall"), float) and math.isnan(result["overall"])) else None,
            }
    return pairwise


def compute_consensus(entries, annotator_ids, method="majority"):
    """Compute consensus labels across annotators.

    method="majority": ≥2 of N annotators agree → consensus value.
    For rating scale 0-2, the consensus is the median value when N=3.

    Returns list of dicts (one per entry) with consensus {axis: value}.
    """
    consensus_list = []
    for item in entries:
        anns = item.get("annotations", [])
        consensus = {}
        for axis in _AXES:
            vals = []
            for a_id in annotator_ids:
                match = next((a for a in anns if a.get("annotator_id") == a_id), None)
                v = match.get(axis, 0) if match else 0
                if v is None:
                    v = 0
                vals.append(v)

            if method == "majority":
                # For 0-2 scale with 3 annotators: median = majority
                vals_sorted = sorted(vals)
                consensus[axis] = vals_sorted[len(vals_sorted) // 2]
            else:
                # Default: median
                vals_sorted = sorted(vals)
                consensus[axis] = vals_sorted[len(vals_sorted) // 2]

        consensus_list.append(consensus)
    return consensus_list


def consensus_kappa(entries, annotator_ids, consensus_list):
    """Compute κ between each annotator and the consensus labels.

    Returns {annotator_id: {per_axis: {axis: kappa}, overall: kappa}}
    """
    result = {}
    for a_id in annotator_ids:
        a_list = extract_annotator_list(entries, a_id)
        k = cohens_kappa(a_list, consensus_list)
        result[a_id] = {
            "per_axis": {ax: round(k["per_axis"].get(ax, float("nan")), 4) for ax in _AXES},
            "overall": round(k["overall"], 4) if not (isinstance(k.get("overall"), float) and math.isnan(k["overall"])) else None,
        }
    return result


def annotator_calibration(entries, annotator_ids, consensus_list):
    """Compute per-annotator calibration: agreement rate with majority consensus.

    For each annotator: what fraction of their ratings match the consensus?
    Returns {annotator_id: {per_axis: agreement_rate, overall: agreement_rate, flagged: bool}}
    """
    calibration = {}
    for a_id in annotator_ids:
        a_list = extract_annotator_list(entries, a_id)
        per_axis = {}
        total_matches = 0
        total_pairs = 0

        for axis in _AXES:
            matches = 0
            n = len(a_list)
            for a_val, c_val in zip(a_list, consensus_list):
                if a_val.get(axis, 0) == c_val.get(axis, 0):
                    matches += 1
            rate = matches / n if n > 0 else 0.0
            per_axis[axis] = round(rate, 4)
            total_matches += matches
            total_pairs += n

        overall = total_matches / total_pairs if total_pairs > 0 else 0.0
        flagged = overall < 0.70

        calibration[a_id] = {
            "per_axis": per_axis,
            "overall": round(overall, 4),
            "flagged": flagged,
            "recommendation": (
                "Prompt adjustment recommended — agreement with consensus below 70%"
                if flagged else "Calibration acceptable"
            ),
        }

    return calibration


def cohens_kappa(annotator_a, annotator_b):
    """Compute Cohen's κ between two annotators across all axes.

    Each should be a list of dicts with axis values {axis: value}.
    Treats each axis-rating as a separate observation.
    Returns per-axis κ dict and overall κ.
    """
    per_axis = {}
    all_pairs = []

    for axis in _AXES:
        pairs = []
        for i in range(len(annotator_a)):
            a_val = annotator_a[i].get(axis, 0)
            b_val = annotator_b[i].get(axis, 0)
            # Treat None as 0
            if a_val is None:
                a_val = 0
            if b_val is None:
                b_val = 0
            pairs.append((a_val, b_val))
            all_pairs.append((a_val, b_val))

        if len(pairs) < 2:
            per_axis[axis] = float("nan")
            continue

        per_axis[axis] = _compute_kappa(pairs)

    overall = _compute_kappa(all_pairs) if all_pairs else float("nan")
    return {"per_axis": per_axis, "overall": overall}


def _compute_kappa(pairs):
    """Compute Cohen's κ for a list of (rater1, rater2) pairs."""
    n = len(pairs)
    if n == 0:
        return float("nan")

    # Observed agreement
    po = sum(1 for a, b in pairs if a == b) / n

    # Expected agreement
    rater1_counts = Counter(a for a, _ in pairs)
    rater2_counts = Counter(b for _, b in pairs)
    all_cats = set(rater1_counts.keys()) | set(rater2_counts.keys())
    pe = sum(
        (rater1_counts.get(c, 0) / n) * (rater2_counts.get(c, 0) / n)
        for c in all_cats
    )

    if pe == 1:
        return 1.0 if po == 1 else 0.0

    return (po - pe) / (1 - pe)


def per_axis_f1(annotations, system_predictions):
    """Compute per-axis Precision, Recall, F1 for system predictions vs annotator consensus.

    annotations: list of dicts with per-comment majority-vote annotations
    system_predictions: list of dicts with system predictions per comment

    Returns per-axis dict with precision, recall, f1.
    """
    results = {}
    for axis in _AXES:
        tp = fp = fn = 0
        for ann, pred in zip(annotations, system_predictions):
            a_val = ann.get(axis, 0)
            if a_val is None:
                a_val = 0
            p_val = pred.get(axis, 0)
            if p_val is None:
                p_val = 0
            # Binary detection: value >= 1 means "present"
            a_pos = 1 if a_val >= 1 else 0
            p_pos = 1 if p_val >= 1 else 0

            if a_pos and p_pos:
                tp += 1
            elif not a_pos and p_pos:
                fp += 1
            elif a_pos and not p_pos:
                fn += 1

        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
        results[axis] = {"precision": prec, "recall": rec, "f1": f1, "tp": tp, "fp": fp, "fn": fn}
    return results


def majority_vote(annotations):
    """Compute majority vote (median rounded) across annotators for each comment."""
    results = []
    for item in annotations:
        anns = item["annotations"]
        majority = {}
        for axis in _AXES:
            vals = [a.get(axis, 0) for a in anns]
            # Filter out None values
            vals = [v if v is not None else 0 for v in vals]
            vals.sort()
            median = vals[len(vals) // 2]
            majority[axis] = round(median)
        results.append(majority)
    return results


def calibration_report(annotations, system_predictions, n_bins=5):
    """Compute calibration statistics (Brier score, ECE) for system predictions.

    Returns dict with brier_score, ece, per-bin accuracy vs confidence.
    """
    all_y_true = []
    all_y_prob = []
    all_axis_vals = []

    for ann, pred in zip(annotations, system_predictions):
        for axis in _AXES:
            a_val = ann.get(axis, 0)
            if a_val is None:
                a_val = 0
            p_val = pred.get(axis, 0)
            if p_val is None:
                p_val = 0
            # Treat 0-2 rating as: true label = a_val/2, prediction = p_val/2
            all_y_true.append(a_val / 2.0)
            all_y_prob.append(min(p_val / 2.0, 1.0))
            all_axis_vals.append((axis, a_val / 2.0, min(p_val / 2.0, 1.0)))

    n = len(all_y_true)
    if n == 0:
        return {"brier_score": None, "ece": None}

    # Brier Score (lower = better, 0 = perfect)
    brier = sum((p - t) ** 2 for t, p in zip(all_y_true, all_y_prob)) / n

    # ECE (Expected Calibration Error)
    # Sort by confidence, bin, compute accuracy vs confidence difference
    bin_size = 1.0 / n_bins
    pairs = sorted(zip(all_y_prob, all_y_true), key=lambda x: x[0])
    ece = 0.0
    bucket_vals = []

    for b in range(n_bins):
        lower = b * bin_size
        upper = (b + 1) * bin_size
        bucket = [(t, p) for p, t in pairs if lower <= p < upper]
        if not bucket:
            continue
        acc = sum(1 for t, p in bucket if abs(p - t) < 0.25) / len(bucket)
        conf = sum(p for _, p in bucket) / len(bucket)
        bucket_vals.append({"bin": b, "n": len(bucket), "accuracy": acc, "confidence": conf})
        ece += (len(bucket) / n) * abs(acc - conf)

    return {
        "brier_score": round(brier, 4),
        "ece": round(ece, 4),
        "bins": bucket_vals,
    }


def print_report(annotations, system_preds, kappa_a_b):
    """Generate a human-readable validation report."""
    print("=" * 60)
    print("BiliArgument Validation Report")
    print("  Annotation framework: Ziegenbein et al. (2023) 4-category")
    print("  Gangjing subtypes: Chen Yansen (2020) 5-type")
    print("=" * 60)

    # Inter-rater reliability
    print(f"\nInter-Rater Reliability (Cohen's κ):")
    print(f"  Overall κ = {kappa_a_b.get('overall', float('nan')):.3f}")
    for axis in _AXES:
        k = kappa_a_b.get("per_axis", {}).get(axis, float("nan"))
        level = ""
        if k >= 0.8:
            level = "(almost perfect)"
        elif k >= 0.6:
            level = "(substantial)"
        elif k >= 0.4:
            level = "(moderate)"
        else:
            level = "(low)"
        print(f"  {_AXIS_LABELS[axis]:12s}: κ = {k:.3f} {level}")

    # Per-axis F1
    if system_preds:
        mv = majority_vote(annotations)
        f1_results = per_axis_f1(mv, system_preds)
        print(f"\nPer-Axis Classification Performance:")
        for axis in _AXES:
            r = f1_results[axis]
            print(f"  {_AXIS_LABELS[axis]:12s}: P={r['precision']:.3f}  R={r['recall']:.3f}  F1={r['f1']:.3f}  (TP={r['tp']} FP={r['fp']} FN={r['fn']})")

    # Calibration
    if system_preds:
        mv = majority_vote(annotations)
        cal = calibration_report(mv, system_preds)
        print(f"\nCalibration:")
        print(f"  Brier Score: {cal['brier_score']}")
        print(f"  ECE: {cal['ece']}")
        if cal.get("bins"):
            print(f"  Reliability Bins:")
            for b in cal["bins"]:
                print(f"    Bin {b['bin']}: n={b['n']}  acc={b['accuracy']:.3f}  conf={b['confidence']:.3f}")

    print("=" * 60)


if __name__ == "__main__":
    import argparse
    import sys
    from pathlib import Path
    from datetime import datetime, timezone

    parser = argparse.ArgumentParser(description="Ziegenbein Annotation Validation Metrics")
    parser.add_argument("--input", type=str, required=True,
                        help="Path to annotation labels JSON (multi-annotator per comment)")
    parser.add_argument("--output-kappa", type=str, default=None,
                        help="Output path for kappa report JSON")
    parser.add_argument("--full-report", action="store_true",
                        help="Print full report with F1 and calibration")
    parser.add_argument("--annotators", type=str, default="A1,A2",
                        help="Comma-separated annotator IDs to include (default: A1,A2)")
    parser.add_argument("--consensus", type=str, default=None,
                        choices=["majority"],
                        help="Consensus method for combining annotator ratings (default: majority with 3+ annotators)")
    args = parser.parse_args()

    annotator_ids = [x.strip() for x in args.annotators.split(",") if x.strip()]
    if len(annotator_ids) < 2:
        print("ERROR: need at least 2 annotators")
        sys.exit(1)

    # Auto-enable majority consensus for 3+ annotators
    consensus_method = args.consensus
    if consensus_method is None and len(annotator_ids) >= 3:
        consensus_method = "majority"
        print(f"Auto-enabled consensus: {consensus_method} (3+ annotators)")

    entries = load_annotations(args.input)
    print(f"Loaded {len(entries)} annotated comments")
    print(f"Annotators: {', '.join(annotator_ids)}")
    print()

    # Count how many entries have all annotators
    paired_count = 0
    for item in entries:
        anns = item.get("annotations", [])
        ann_ids_in_entry = {a.get("annotator_id") for a in anns}
        if all(aid in ann_ids_in_entry for aid in annotator_ids):
            paired_count += 1
    print(f"Entries with all {len(annotator_ids)} annotators: {paired_count}/{len(entries)}")

    # ——— Pairwise κ ———
    print()
    print("Pairwise Cohen's κ:")
    print("-" * 70)
    pairwise = compute_pairwise_kappas(entries, annotator_ids)
    for pair_key, pk in pairwise.items():
        print(f"  {pair_key}:")
        for axis in _AXES:
            k = pk["per_axis"].get(axis, float("nan"))
            print(f"    {_AXIS_LABELS.get(axis, axis):12s}: κ = {k:.3f}")
        print(f"    {'overall':12s}: κ = {pk['overall']:.3f}" if pk["overall"] is not None else "    overall: N/A")

    # Average pairwise κ
    avg_pairwise = {}
    for axis in _AXES:
        vals = [pk["per_axis"].get(axis, float("nan")) for pk in pairwise.values()]
        vals = [v for v in vals if not (isinstance(v, float) and math.isnan(v))]
        avg_pairwise[axis] = sum(vals) / len(vals) if vals else float("nan")
    avg_overall = sum(pk["overall"] for pk in pairwise.values() if pk["overall"] is not None) / max(len([pk for pk in pairwise.values() if pk["overall"] is not None]), 1)

    print()
    print(f"  Average pairwise κ:")
    for axis in _AXES:
        print(f"    {_AXIS_LABELS.get(axis, axis):12s}: κ = {avg_pairwise[axis]:.3f}")
    print(f"    {'overall':12s}: κ = {avg_overall:.3f}")

    # ——— Consensus κ (when 3+ annotators) ———
    consensus = None
    consensus_ks = None
    if consensus_method and len(annotator_ids) >= 3:
        print()
        print(f"Consensus ({consensus_method}) κ:")
        print("-" * 70)
        consensus = compute_consensus(entries, annotator_ids, method=consensus_method)
        consensus_ks = consensus_kappa(entries, annotator_ids, consensus)

        for a_id in annotator_ids:
            ck = consensus_ks[a_id]
            print(f"  {a_id} vs consensus:")
            for axis in _AXES:
                k = ck["per_axis"].get(axis, float("nan"))
                print(f"    {_AXIS_LABELS.get(axis, axis):12s}: κ = {k:.3f}")
            print(f"    {'overall':12s}: κ = {ck['overall']:.3f}" if ck["overall"] is not None else "    overall: N/A")

        # Average consensus κ
        avg_consensus = {}
        for axis in _AXES:
            vals = [ck["per_axis"].get(axis, float("nan")) for ck in consensus_ks.values()]
            vals = [v for v in vals if not (isinstance(v, float) and math.isnan(v))]
            avg_consensus[axis] = sum(vals) / len(vals) if vals else float("nan")
        avg_consensus_overall = sum(ck["overall"] for ck in consensus_ks.values() if ck["overall"] is not None) / max(len([ck for ck in consensus_ks.values() if ck["overall"] is not None]), 1)

        print()
        print(f"  Average consensus κ:")
        for axis in _AXES:
            print(f"    {_AXIS_LABELS.get(axis, axis):12s}: κ = {avg_consensus[axis]:.3f}")
        print(f"    {'overall':12s}: κ = {avg_consensus_overall:.3f}")

        # Count levels
        n_above_06_consensus = sum(1 for ax in _AXES if not (isinstance(avg_consensus.get(ax), float) and math.isnan(avg_consensus.get(ax))) and avg_consensus.get(ax, 0) >= 0.6)
        print(f"\n  Axes with consensus κ ≥ 0.6: {n_above_06_consensus}/4")

        # ——— Calibration check (Step 4) ———
        print()
        print("Per-Annotator Calibration (agreement with consensus):")
        print("-" * 70)
        cal = annotator_calibration(entries, annotator_ids, consensus)
        for a_id in annotator_ids:
            cal_data = cal[a_id]
            flag = "⚠ FLAGGED" if cal_data["flagged"] else "✓ OK"
            print(f"  {a_id}: overall={cal_data['overall']:.1%} {flag}")
            for axis in _AXES:
                print(f"    {_AXIS_LABELS.get(axis, axis):12s}: {cal_data['per_axis'][axis]:.1%}")
            if cal_data["flagged"]:
                print(f"    → {cal_data['recommendation']}")

    # ——— Count positives ———
    print()
    print("Positive annotations per axis (score ≥ 1):")
    print("-" * 70)
    positives = {}
    for a_id in annotator_ids:
        a_list = extract_annotator_list(entries, a_id)
        a_pos = {}
        for axis in _AXES:
            a_pos[axis] = sum(1 for a in a_list if (a.get(axis) or 0) >= 1)
        positives[a_id] = a_pos
        pos_str = ", ".join(f"{ax}={a_pos[ax]}" for ax in _AXES)
        print(f"  {a_id}: {pos_str}")

    # ——— Gate check ———
    print()
    print("=" * 60)
    if consensus_method and consensus_ks:
        n_above_06 = sum(1 for ax in _AXES if not (isinstance(avg_consensus.get(ax), float) and math.isnan(avg_consensus.get(ax))) and avg_consensus.get(ax, 0) >= 0.6)
        if n_above_06 >= 3:
            print(f"[PASS] Gate: {n_above_06}/4 axes with consensus κ ≥ 0.6")
        else:
            print(f"[GATE NOT MET] Only {n_above_06}/4 axes with consensus κ ≥ 0.6")
            if n_above_06 < 2:
                print(f"  Fallback: κ threshold lowered to ≥ 0.4 (Landis & Koch 'moderate')")
                n_moderate = sum(1 for ax in _AXES if not (isinstance(avg_consensus.get(ax), float) and math.isnan(avg_consensus.get(ax))) and avg_consensus.get(ax, 0) >= 0.4)
                print(f"  Axes with κ ≥ 0.4: {n_moderate}/4")
                print(f"  Documenting honest ceiling — see .claude/KAPPA_GATE_FIX_PLAN.md Alternative section")
    else:
        n_above_06 = sum(1 for ax in _AXES if not (isinstance(avg_pairwise.get(ax), float) and math.isnan(avg_pairwise.get(ax))) and avg_pairwise.get(ax, 0) >= 0.6)
        if n_above_06 >= 3:
            print(f"[PASS] Gate: {n_above_06}/4 axes with κ > 0.6")
        else:
            print(f"WARNING: Gate NOT MET: only {n_above_06}/4 axes have κ > 0.6")
    print("=" * 60)

    # ——— Write output ———
    if args.output_kappa:
        report = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "source": str(Path(args.input).resolve()),
            "n_comments": len(entries),
            "n_paired": paired_count,
            "annotators": annotator_ids,
            "kappa": {
                "pairwise": pairwise,
                "average_pairwise": {
                    "per_axis": {ax: round(avg_pairwise.get(ax, float("nan")), 4) for ax in _AXES},
                    "overall": round(avg_overall, 4) if not (isinstance(avg_overall, float) and math.isnan(avg_overall)) else None,
                },
            },
            "positives": positives,
        }

        if consensus_ks:
            report["kappa"]["consensus"] = {
                annotator_id: {
                    "per_axis": {ax: round(ck["per_axis"].get(ax, float("nan")), 4) for ax in _AXES},
                    "overall": round(ck["overall"], 4) if ck["overall"] is not None else None,
                }
                for annotator_id, ck in consensus_ks.items()
            }
            report["kappa"]["average_consensus"] = {
                "per_axis": {ax: round(avg_consensus.get(ax, float("nan")), 4) for ax in _AXES},
                "overall": round(avg_consensus_overall, 4) if not (isinstance(avg_consensus_overall, float) and math.isnan(avg_consensus_overall)) else None,
            }

            n_above_06_consensus = sum(1 for ax in _AXES if not (isinstance(avg_consensus.get(ax), float) and math.isnan(avg_consensus.get(ax))) and avg_consensus.get(ax, 0) >= 0.6)
            report["gate"] = {
                "n_above_06": n_above_06_consensus,
                "threshold": 3,
                "passed": n_above_06_consensus >= 3,
                "consensus_method": consensus_method,
                "fallback_to_moderate": n_above_06_consensus < 2,
            }

            # Calibration report (Step 4)
            cal = annotator_calibration(entries, annotator_ids, consensus)
            report["calibration"] = cal
            flagged_annotators = [a_id for a_id, c in cal.items() if c["flagged"]]
            report["calibration_summary"] = {
                "flagged_annotators": flagged_annotators,
                "all_passed": len(flagged_annotators) == 0,
                "threshold": 0.70,
            }
        else:
            n_above_06 = sum(1 for ax in _AXES if not (isinstance(avg_pairwise.get(ax), float) and math.isnan(avg_pairwise.get(ax))) and avg_pairwise.get(ax, 0) >= 0.6)
            report["gate"] = {
                "n_above_06": n_above_06,
                "threshold": 3,
                "passed": n_above_06 >= 3,
            }

        with open(args.output_kappa, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\nKappa report written to: {args.output_kappa}")

    # Full report with F1 using consensus as pseudo-ground-truth
    if args.full_report and consensus:
        a1_list = extract_annotator_list(entries, annotator_ids[0])
        a1_safe = [{ax: (a.get(ax) or 0) for ax in _AXES} for a in a1_list]
        f1_results = per_axis_f1(consensus, a1_safe)
        print("\nPer-Axis F1 (A1 vs consensus):")
        for axis in _AXES:
            r = f1_results[axis]
            print(f"  {_AXIS_LABELS.get(axis, axis):12s}: P={r['precision']:.3f}  R={r['recall']:.3f}  F1={r['f1']:.3f}  (TP={r['tp']} FP={r['fp']} FN={r['fn']})")

        cal = calibration_report(consensus, a1_safe)
        print(f"\nCalibration (A1 vs consensus):")
        print(f"  Brier Score: {cal['brier_score']}")
        print(f"  ECE: {cal['ece']}")
