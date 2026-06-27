"""
Coverage Audit Honesty Probe — Python contract for server/scripts/probeCoverageHonesty.js.

Audit dictionary evidence integrity: detect inflated evidenceCount, missing samples,
context-only evidence, weak term matches, and other data quality issues.

Usage:
  python -m python_backend.cli.coverage_honesty_probe
  python -m python_backend.cli.coverage_honesty_probe --json  # JSON output
"""

import argparse
import json
from collections import Counter
from pathlib import Path

from python_backend.analyzers.keyword_evidence import KeywordEvidenceMatcher
from python_backend.corpus.dictionary import DictionaryLoader

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DICT_PATH = PROJECT_ROOT / "server" / "data" / "deepseekKeywordDictionary.json"


def clean_text(value: str) -> str:
    import unicodedata
    return unicodedata.normalize("NFKC", str(value or "")).lower().strip()


def evidence_count(entry: dict) -> int:
    return max(0, int(entry.get("evidenceCount") or 0))


def count_unique_samples(entry: dict) -> int:
    samples = set()
    for s in (entry.get("evidenceSamples") or []):
        clean = str(s or "").strip()
        if clean:
            samples.add(clean)
    for s in (entry.get("evidenceSources") or []):
        sample = str((s or {}).get("sample", "")).strip()
        if sample:
            samples.add(sample)
    return len(samples)


def count_unique_sources(entry: dict) -> int:
    sources = set()
    for s in (entry.get("evidenceSources") or []):
        source_text = str((s or {}).get("source", "")).strip()
        if source_text:
            sources.add(source_text)
    return len(sources)


def sample_contains_term(sample: str, entry: dict) -> bool:
    text = clean_text(sample)
    if not text:
        return False
    analyzer = KeywordEvidenceMatcher()
    needles = analyzer.evidence_needles_for_term(entry.get("term", ""))
    terms = [clean_text(entry.get("term", ""))] + [clean_text(n) for n in needles]
    terms = [t for t in terms if len(t) >= 2]
    return any(t in text for t in terms)


def is_context_only_sample(sample: str) -> bool:
    s = str(sample or "").strip()
    return s.startswith("Bilibili video context:") or s.startswith("Bilibili public video title:")


def probe(dict_path: str | Path = DEFAULT_DICT_PATH) -> dict:
    """Run the full honesty probe and return structured results."""
    loader = DictionaryLoader(dict_path)
    dictionary = loader.load()
    entries = dictionary.entries

    TARGET = 3

    issues = {
        "evidenceCountGtSamples": [],
        "evidenceCountZeroSamples": [],
        "noSourceBacked": [],
        "contextOnly": [],
        "termNotInSamples": [],
        "weakEvidenceCount": [],
        "zeroEvidence": [],
        "samplesVsCountGap": [],
    }

    stats = {
        "totalEvidenceCount": 0,
        "totalUniqueSamples": 0,
        "totalUniqueSources": 0,
        "entriesWithSourceBacked": 0,
        "entriesWithCommentSamples": 0,
    }

    for entry in entries:
        ec = evidence_count(entry)
        sample_count = count_unique_samples(entry)
        source_count = count_unique_sources(entry)

        stats["totalEvidenceCount"] += ec
        stats["totalUniqueSamples"] += sample_count
        stats["totalUniqueSources"] += source_count

        if source_count > 0:
            stats["entriesWithSourceBacked"] += 1

        has_comment_sample = any(
            not is_context_only_sample(s) for s in (entry.get("evidenceSamples") or [])
        ) or any(
            not is_context_only_sample((s or {}).get("sample", ""))
            for s in (entry.get("evidenceSources") or [])
        )
        if has_comment_sample:
            stats["entriesWithCommentSamples"] += 1

        # ISSUE 1
        if ec > sample_count and sample_count > 0:
            issues["evidenceCountGtSamples"].append({
                "term": entry.get("term"), "family": entry.get("family"),
                "evidenceCount": ec, "actualSamples": sample_count, "gap": ec - sample_count,
            })

        # ISSUE 2
        if ec > 0 and sample_count == 0:
            issues["evidenceCountZeroSamples"].append({
                "term": entry.get("term"), "family": entry.get("family"),
                "evidenceCount": ec,
            })

        # ISSUE 3
        if ec > 0 and source_count == 0:
            issues["noSourceBacked"].append({
                "term": entry.get("term"), "family": entry.get("family"),
                "evidenceCount": ec,
            })

        # ISSUE 4
        if ec > 0 and not has_comment_sample:
            issues["contextOnly"].append({
                "term": entry.get("term"), "family": entry.get("family"),
                "evidenceCount": ec, "sampleCount": sample_count,
                "samplePreview": (entry.get("evidenceSamples") or [])[:2],
            })

        # ISSUE 5
        if sample_count > 0:
            all_samples = list(entry.get("evidenceSamples") or [])
            all_samples += [(s or {}).get("sample") for s in (entry.get("evidenceSources") or []) if (s or {}).get("sample")]
            mismatches = [s for s in all_samples if not is_context_only_sample(s) and not sample_contains_term(s, entry)]
            if mismatches:
                issues["termNotInSamples"].append({
                    "term": entry.get("term"), "family": entry.get("family"),
                    "mismatchCount": len(mismatches), "totalSamples": len(all_samples),
                    "examples": mismatches[:3],
                })

        # ISSUE 6
        if ec < TARGET:
            issues["weakEvidenceCount"].append({
                "term": entry.get("term"), "family": entry.get("family"),
                "evidenceCount": ec, "sampleCount": sample_count,
            })

        # ISSUE 7
        if ec == 0:
            issues["zeroEvidence"].append({"term": entry.get("term"), "family": entry.get("family")})

        # ISSUE 8
        if ec != sample_count:
            issues["samplesVsCountGap"].append({
                "term": entry.get("term"), "family": entry.get("family"),
                "evidenceCount": ec, "sampleCount": sample_count, "gap": ec - sample_count,
            })

    # Honesty assessment
    severity_scores = {
        "evidenceCountZeroSamples": 5,
        "contextOnly": 4,
        "noSourceBacked": 3,
        "evidenceCountGtSamples": 2,
        "termNotInSamples": 2,
        "samplesVsCountGap": 1,
    }

    total_severity = sum(len(issues.get(k, [])) * w for k, w in severity_scores.items())
    critical = len(issues["evidenceCountZeroSamples"]) + len(issues["contextOnly"])
    moderate = len(issues["noSourceBacked"]) + len(issues["evidenceCountGtSamples"]) + len(issues["termNotInSamples"])
    minor = len(issues["samplesVsCountGap"])

    if critical == 0 and moderate == 0:
        verdict = "HONEST"
    elif critical == 0 and moderate <= 5:
        verdict = "MOSTLY_HONEST"
    elif critical > 0:
        verdict = "HAS_ISSUES"
    else:
        verdict = "NEEDS_REVIEW"

    # Evidence distribution
    dist = Counter()
    for entry in entries:
        ec = evidence_count(entry)
        bucket = "10+" if ec >= 10 else str(ec)
        dist[bucket] += 1

    return {
        "ok": True,
        "totalEntries": len(entries),
        "stats": stats,
        "targetEvidence": TARGET,
        "issues": {k: len(v) for k, v in issues.items()},
        "issueDetails": {k: v[:20] for k, v in issues.items() if v},  # first 20 per issue
        "verdict": verdict,
        "criticalIssues": critical,
        "moderateIssues": moderate,
        "minorIssues": minor,
        "totalSeverity": total_severity,
        "evidenceDistribution": dict(sorted(dist.items(), key=lambda x: (
            10 if x[0] == "10+" else int(x[0])
        ))),
    }


def main():
    parser = argparse.ArgumentParser(description="Coverage audit honesty probe")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of text")
    parser.add_argument("--dict-path", type=str, default=str(DEFAULT_DICT_PATH),
                        help="Path to keyword dictionary JSON")
    args = parser.parse_args()

    result = probe(args.dict_path)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # Text output (matching JS format)
    stats = result["stats"]
    print("=== Coverage Audit Honesty Probe ===\n")
    print("=== Summary Statistics ===")
    print(f"Total evidenceCount sum:  {stats['totalEvidenceCount']:,}")
    print(f"Total unique samples:     {stats['totalUniqueSamples']:,}")
    print(f"Total unique sources:     {stats['totalUniqueSources']:,}")
    avg_ec = stats["totalEvidenceCount"] / max(result["totalEntries"], 1)
    avg_samples = stats["totalUniqueSamples"] / max(result["totalEntries"], 1)
    print(f"Avg evidenceCount/entry:  {avg_ec:.2f}")
    print(f"Avg samples/entry:        {avg_samples:.2f}")
    src_pct = stats["entriesWithSourceBacked"] / max(result["totalEntries"], 1) * 100
    comment_pct = stats["entriesWithCommentSamples"] / max(result["totalEntries"], 1) * 100
    print(f"Source-backed entries:    {stats['entriesWithSourceBacked']}/{result['totalEntries']} ({src_pct:.1f}%)")
    print(f"Comment-sample entries:   {stats['entriesWithCommentSamples']}/{result['totalEntries']} ({comment_pct:.1f}%)")

    print("\n=== Issues Found ===")
    labels = {
        "evidenceCountGtSamples": "evidenceCount > actual unique samples",
        "evidenceCountZeroSamples": "evidenceCount > 0 but zero samples",
        "noSourceBacked": "Has evidence but no source URLs",
        "contextOnly": "All evidence is context-only (titles)",
        "termNotInSamples": "Samples not containing the term",
        "samplesVsCountGap": "evidenceCount differs from sample count",
        "weakEvidenceCount": f"Weak evidence (< {result['targetEvidence']})",
        "zeroEvidence": "Zero evidence",
    }
    for key, label in labels.items():
        count = result["issues"].get(key, 0)
        details = result["issueDetails"].get(key, [])
        print(f"\n{label}: {count} entries")
        if count == 0:
            print("  ✓ None")
            continue
        for item in details[:15]:
            ec = item.get("evidenceCount", "?")
            sc = item.get("sampleCount", item.get("actualSamples", "?"))
            gap = f" (gap: {item['gap']})" if "gap" in item else ""
            ex = f' e.g. "{str(item.get("examples", [""])[0])[:60]}"' if item.get("examples") else ""
            print(f"  - [{item['family']}] {item['term']}: evidenceCount={ec}, samples={sc}{gap}{ex}")

    print(f"\n=== Honesty Assessment ===")
    print(f"Critical issues (zero samples / context-only): {result['criticalIssues']}")
    print(f"Moderate issues (no source / inflated / weak match): {result['moderateIssues']}")
    print(f"Minor issues (count mismatch): {result['minorIssues']}")

    verdict_msgs = {
        "HONEST": "\n✓ VERDICT: Coverage ratio is HONEST.\n  All evidenceCount values are backed by real evidence samples.\n  The coverage is legitimate.",
        "MOSTLY_HONEST": f"\n⚠ VERDICT: Coverage ratio is MOSTLY HONEST ({result['moderateIssues']} minor concerns).",
        "HAS_ISSUES": f"\n✗ VERDICT: Coverage ratio has HONESTY ISSUES ({result['criticalIssues']} critical problems).",
        "NEEDS_REVIEW": f"\n⚠ VERDICT: Coverage ratio needs review ({result['moderateIssues']} moderate issues).",
    }
    print(verdict_msgs.get(result["verdict"], ""))

    print("\n=== Evidence Count Distribution ===")
    total = result["totalEntries"]
    for bucket, count in result["evidenceDistribution"].items():
        bar = "█" * round(count / max(total, 1) * 100)
        print(f"  evidenceCount={bucket:>3}: {count:>4} entries {bar}")


if __name__ == "__main__":
    main()
