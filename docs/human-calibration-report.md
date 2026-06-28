# Human Calibration Report — Bilibili Gangjing Annotation

> 2026-06-28. Human inter-rater reliability calibration for the Ziegenbein 4-axis
> Bilibili comment annotation pipeline.

## Purpose

The 3-annotator DeepSeek consensus pipeline (A1 balanced, A2 calibrated, A3 consensus)
achieved κ ≥ 0.6 on all 4 axes on a 30-comment validation set. However, all 3 annotators
use the same underlying model (DeepSeek). This human calibration study establishes:

1. **True κ ceiling**: How well can humans agree on Bilibili comment annotation?
2. **Model calibration**: Does DeepSeek consensus correlate with human judgment?
3. **Systematic bias**: Does DeepSeek over-flag or under-flag any Ziegenbein axis?

## Method

### Annotation Guide
A 1-page Chinese annotation guide was created with:
- 4 Ziegenbein axes with 0/1/2 scoring criteria
- 3 fully worked examples
- Bilibili-specific notes (emotes, memes, @reply conventions)

See: `.claude/annotation_data/human_calibration_guide.md`

### Comment Selection
30 comments were selected from the 300-comment argumentative candidate pool,
stratified across all 4 Ziegenbein axes:
- toxicEmotions: 8
- missingCommitment: 10
- missingIntelligibility: 9
- otherReasons: 3

See: `.claude/annotation_data/human_calibration.json`

### Reviewers
≥2 Chinese-fluent reviewers familiar with Bilibili comment culture are needed.
Each reviewer independently rates all 30 comments on the 4 axes (0-2 scale).

## Results

### Human-Human Agreement

| Axis | Reviewer 1 vs 2 (κ) | Agreement Level |
|------|---------------------|-----------------|
| toxicEmotions | TBD | TBD |
| missingCommitment | TBD | TBD |
| missingIntelligibility | TBD | TBD |
| otherReasons | TBD | TBD |

### Human-Model Agreement

| Axis | Human Consensus vs DeepSeek A3 (κ) | Agreement Level |
|------|-------------------------------------|-----------------|
| toxicEmotions | TBD | TBD |
| missingCommitment | TBD | TBD |
| missingIntelligibility | TBD | TBD |
| otherReasons | TBD | TBD |

### Per-Axis Bias Analysis

| Axis | DeepSeek Mean | Human Mean | Bias Direction |
|------|---------------|------------|----------------|
| toxicEmotions | TBD | TBD | TBD |
| missingCommitment | TBD | TBD | TBD |
| missingIntelligibility | TBD | TBD | TBD |
| otherReasons | TBD | TBD | TBD |

## Interpretation

### κ Ceiling
If human-human κ ≥ 0.7, the model's 0.82 (DeepSeek-only consensus) is within range.
If human-human κ < 0.6, the task itself has inherent ambiguity and κ = 0.4-0.6 is the realistic ceiling.

### Model Calibration
If human-model κ ≥ 0.6 on ≥3 axes, the DeepSeek pipeline is calibrated to human judgment.
If systematic over-flagging is detected (e.g., DeepSeek rates higher than humans on toxicEmotions),
the annotation prompts may need threshold adjustment.

## Recommendations

1. TBD — after human data collection
2. TBD — after human data collection

## Next Steps

1. Recruit ≥2 Chinese-fluent Bilibili-familiar reviewers
2. Distribute annotation guide + 30 comments
3. Collect independent annotations
4. Compute: `python -m python_backend.analysis.validation_metrics --input human_calibration.json --annotators Human1,Human2`
5. Compare human κ vs model κ
6. Update this report with findings
