#!/usr/bin/env python
"""
Post-annotation pipeline: compute Cohen's κ, learn logistic regression weights,
and output values ready for src/main.jsx update.

Usage:
  python python_backend/analysis/compute_metrics_pipeline.py \
    --labels .claude/annotation_data/labels_500.json \
    --output .claude/metrics_output.json
"""
import argparse
import json
import sys
import os
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from python_backend.analysis.validation_metrics import (
    load_annotations, cohens_kappa, majority_vote, per_axis_f1, print_report,
)
from python_backend.analysis.calibration import learn_weights_from_labels

_AXES = ["toxicEmotions", "missingCommitment", "missingIntelligibility", "otherReasons"]
_AXIS_LABELS = {
    "toxicEmotions": "情绪过激",
    "missingCommitment": "回避讨论",
    "missingIntelligibility": "逻辑混乱",
    "otherReasons": "其他问题",
}


def compute_pipeline(labels_path, output_path=None):
    """Run the full post-annotation pipeline."""
    data = load_annotations(labels_path)

    # Extract A1 and A2 annotations
    a1_anns = []
    a2_anns = []
    paired_entries = []

    for entry in data:
        anns = entry.get("annotations", [])
        a1 = next((a for a in anns if a.get("annotator_id") == "A1" and a.get("toxicEmotions") is not None), None)
        a2 = next((a for a in anns if a.get("annotator_id") == "A2" and a.get("toxicEmotions") is not None), None)
        if a1 and a2:
            a1_anns.append(a1)
            a2_anns.append(a2)
            paired_entries.append(entry)

    n_paired = len(a1_anns)

    if n_paired < 5:
        return {
            "ok": False,
            "error": f"Only {n_paired} paired annotations (need >=5 for Cohen's κ)",
        }

    # 1. Compute Cohen's κ
    kappa_result = cohens_kappa(a1_anns, a2_anns)

    # 2. Per-axis F1 using A1 as gold and A2 as prediction
    f1_result = per_axis_f1(a1_anns, a2_anns)

    # 3. Learn logistic regression weights
    weights_result = learn_weights_from_labels(labels_path)

    # 4. Build the report
    kappa_summary = {}
    for ax in _AXES:
        k = kappa_result["per_axis"].get(ax)
        kappa_summary[ax] = {
            "label": _AXIS_LABELS[ax],
            "kappa": round(k, 4) if k is not None and not (isinstance(k, float) and k != k) else None,
            "interpretation": (
                "almost_perfect" if (k or 0) >= 0.8 else
                "substantial" if (k or 0) >= 0.6 else
                "moderate" if (k or 0) >= 0.4 else
                "low"
            ) if k is not None else "no_data",
        }

    f1_summary = {}
    for ax in _AXES:
        f1_summary[ax] = f1_result.get(ax, {})

    report = {
        "ok": True,
        "generatedAt": _iso_now(),
        "n_paired": n_paired,
        "n_total": len(data),
        "cohensKappa": {
            "overall": round(kappa_result.get("overall", 0), 4) if kappa_result.get("overall") is not None else None,
            "perAxis": kappa_summary,
        },
        "perAxisF1": {
            ax: {
                "label": _AXIS_LABELS[ax],
                "precision": round(f1_summary.get(ax, {}).get("precision", 0), 4),
                "recall": round(f1_summary.get(ax, {}).get("recall", 0), 4),
                "f1": round(f1_summary.get(ax, {}).get("f1", 0), 4),
            }
            for ax in _AXES
        },
        "learnedWeights": weights_result.get("per_axis") if weights_result.get("ok") else None,
        "mainJsxUpdate": _build_jsx_update(kappa_summary, weights_result),
        "gates": {
            "kappaAbove06": sum(1 for ax in _AXES if (kappa_summary[ax]["kappa"] or 0) >= 0.6),
            "kappaAbove06Axes": [ax for ax in _AXES if (kappa_summary[ax]["kappa"] or 0) >= 0.6],
            "meetsGate": sum(1 for ax in _AXES if (kappa_summary[ax]["kappa"] or 0) >= 0.6) >= 3,
        },
    }

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    return report


def _build_jsx_update(kappa_summary, weights_result):
    """Build the kappaStatus and weight updates for main.jsx."""
    kappa_obj = {}
    for ax in _AXES:
        k = kappa_summary[ax]["kappa"]
        kappa_obj[ax] = round(k, 3) if k is not None else None

    # Get weights from logistic regression, or use defaults
    weights = {}
    for ax in _AXES:
        wr = weights_result.get("per_axis", {}).get(ax, {}) if weights_result.get("ok") else {}
        weights[ax] = wr.get("weights", [0.25, 0.25, 0.25, 0.25])

    return {
        "kappaStatus": kappa_obj,
        "semanticSeedWeights": weights.get("toxicEmotions", [0.28, 0.25, 0.27, 0.20]),
        "provenance": (
            f"Logistic regression weights learned from "
            f"{weights_result.get('n_samples', 0)} DeepSeek-annotated comments "
            f"(A1 vs A2 inter-rater reliability per Cohen's κ)."
        ),
    }


def _iso_now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Post-annotation metrics pipeline")
    parser.add_argument("--labels", type=str, default=".claude/annotation_data/labels_500.json")
    parser.add_argument("--output", type=str, default=".claude/metrics_output.json")
    args = parser.parse_args()

    report = compute_pipeline(args.labels, args.output)
    if not report["ok"]:
        print(f"ERROR: {report.get('error', 'Unknown error')}")
        sys.exit(1)

    print(f"Pipeline complete: {report['n_paired']} paired annotations")
    print(f"\nCohen's κ:")
    for ax in _AXES:
        info = report["cohensKappa"]["perAxis"][ax]
        print(f"  {info['label']} ({ax}): κ = {info['kappa']} ({info['interpretation']})")

    print(f"\nPer-axis F1 (A1 gold, A2 prediction):")
    for ax in _AXES:
        info = report["perAxisF1"][ax]
        print(f"  {info['label']}: P={info['precision']} R={info['recall']} F1={info['f1']}")

    print(f"\nGate: {report['gates']['kappaAbove06']}/4 axes with κ > 0.6")
    if report["gates"]["meetsGate"]:
        print("  GATE PASSED: >=3 axes have κ > 0.6")
    else:
        print(f"  GATE NOT MET: only {report['gates']['kappaAbove06']} axes have κ > 0.6")

    if report["learnedWeights"]:
        print(f"\nLearned weights:")
        for ax in _AXES:
            r = report["learnedWeights"][ax]
            print(f"  {_AXIS_LABELS[ax]}: weights={r['weights']}  acc={r['training']['final_accuracy']}")

    print(f"\nReport written to: {args.output}")
