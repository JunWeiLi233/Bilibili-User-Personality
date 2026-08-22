"""
Seed Corpus Evidence Harvest — Python contract for server/scripts/harvestSeedCorpusEvidence.js.

Harvests evidence from seed result JSON files in .claude/seed_results/,
flattens comments+danmaku into a unified corpus, mines against the keyword
dictionary, and produces a harvest report.

Usage:
  python -m python_backend.cli.harvest_seed_corpus_evidence [--dry-run]
  python -m python_backend.cli.harvest_seed_corpus_evidence --merge
  python -m python_backend.cli.harvest_seed_corpus_evidence --json  # JSON output
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SEED_RESULTS_DIR = PROJECT_ROOT / ".claude" / "seed_results"
DEFAULT_DICT_PATH = PROJECT_ROOT / "server" / "data" / "deepseekKeywordDictionary.json"


def load_all_seed_results(directory: Path = SEED_RESULTS_DIR) -> list:
    """Load all seed result JSON files from a directory."""
    results = []
    if not directory.is_dir():
        return results
    for f in sorted(directory.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            results.append(data)
        except (json.JSONDecodeError, OSError):
            pass
    return results


def flatten_seed_results(seed_results: list) -> dict:
    """Flatten seed results into a unified comment list."""
    comments = []
    total_comments = 0
    total_danmaku = 0
    newest_ts = 0
    oldest_ts = float("inf")

    for seed in seed_results:
        seed_name = seed.get("seed", "unknown")
        for video in seed.get("videos", []):
            bvid = video.get("bvid", "unknown")
            source = (
                f"Bilibili history-tag harvest: "
                f"https://www.bilibili.com/video/{bvid}/ (seed: {seed_name})"
            )

            for c in video.get("commentMessages", []):
                message = str(c.get("message", "")).strip()
                if not message or len(message) < 2:
                    continue
                ts = int(c.get("time", 0) or 0)
                if ts > 0:
                    newest_ts = max(newest_ts, ts)
                    oldest_ts = min(oldest_ts, ts)
                comments.append({
                    "message": message, "platform": "bilibili",
                    "source": source, "uid": bvid, "uname": "",
                })
                total_comments += 1

            for d in video.get("danmakuMessages", []):
                message = str(d.get("message", "")).strip()
                if not message or len(message) < 2:
                    continue
                ts = int(d.get("time", 0) or 0)
                if ts > 0:
                    newest_ts = max(newest_ts, ts)
                    oldest_ts = min(oldest_ts, ts)
                comments.append({
                    "message": message, "platform": "bilibili",
                    "source": source, "uid": bvid, "uname": "",
                })
                total_danmaku += 1

    return {
        "comments": comments,
        "totalComments": total_comments,
        "totalDanmaku": total_danmaku,
        "newestTs": newest_ts,
        "oldestTs": oldest_ts if oldest_ts < float("inf") else 0,
    }


def build_report(seed_results, flattened, evidence_entries, new_samples):
    """Build the standard JSON report matching JS output shape."""
    by_family = {}
    for entry in evidence_entries:
        f = entry.get("family", "unknown")
        by_family.setdefault(f, []).append(entry)

    entries_report = []
    for e in evidence_entries:
        entries_report.append({
            "term": e.get("term", ""),
            "family": e.get("family", "unknown"),
            "newSamples": len(e.get("evidenceSamples", [])),
            "samples": e.get("evidenceSamples", [])[:5],
        })

    return {
        "ok": True,
        "harvestedAt": datetime.now(timezone.utc).isoformat(),
        "source": "history-tag seed corpus (.claude/seed_results/)",
        "seeds": len(seed_results),
        "totalComments": flattened["totalComments"],
        "totalDanmaku": flattened["totalDanmaku"],
        "totalMessages": len(flattened["comments"]),
        "dateRange": (
            {
                "oldest": datetime.fromtimestamp(flattened["oldestTs"], tz=timezone.utc).isoformat(),
                "newest": datetime.fromtimestamp(flattened["newestTs"], tz=timezone.utc).isoformat(),
            }
            if flattened["oldestTs"] and flattened["newestTs"]
            else None
        ),
        "matchedTerms": len(evidence_entries),
        "newEvidenceSamples": new_samples,
        "byFamily": {f: len(entries) for f, entries in sorted(by_family.items())},
        "entries": entries_report,
    }


def main():
    parser = argparse.ArgumentParser(description="Harvest evidence from seed corpus")
    parser.add_argument("--dry-run", action="store_true", default=True,
                        help="Print report without merging (default)")
    parser.add_argument("--merge", action="store_true", help="Merge evidence into dictionary")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of text")
    parser.add_argument("--seed-dir", type=str, default=str(SEED_RESULTS_DIR),
                        help="Path to seed results directory")
    args = parser.parse_args()

    seed_dir = Path(args.seed_dir)

    # 1. Load seed results
    seed_results = load_all_seed_results(seed_dir)

    if not seed_results:
        result = {"ok": True, "matchedTerms": 0, "note": f"no seed results found in {seed_dir}"}
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print("No seed results found.")
        return

    # 2. Flatten
    flattened = flatten_seed_results(seed_results)

    if not args.json:
        print("=== Seed Corpus Evidence Harvest ===\n")
        print(f"Loading seed results...\n  {len(seed_results)} seed result files loaded")
        print(f"\nFlattening comments + danmaku...")
        print(f"  {flattened['totalComments']:,} comments")
        print(f"  {flattened['totalDanmaku']:,} danmaku")
        print(f"  {len(flattened['comments']):,} total messages")

    # 3. Mine evidence (via local_corpus_evidence CLI)
    comments_path = None
    payload_path = None
    evidence_entries = []
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False,
                                         encoding="utf-8") as tf:
            json.dump(flattened["comments"], tf)
            comments_path = tf.name

        payload = {
            "dictionaryPath": str(DEFAULT_DICT_PATH),
            "commentsPath": comments_path,
            "targetEvidence": 5,
            "maxSamplesPerTerm": 5,
            "requireCommentBackedEvidence": True,
        }
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False,
                                         encoding="utf-8") as pf:
            json.dump(payload, pf)
            payload_path = pf.name

        result = subprocess.run(
            [sys.executable, "-m", "python_backend.cli.local_corpus_evidence",
             "--payload", payload_path],
            capture_output=True, text=True, timeout=60, cwd=str(PROJECT_ROOT),
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )

        if result.returncode == 0 and result.stdout.strip():
            evidence_data = json.loads(result.stdout)
            evidence_entries = evidence_data.get("entries", [])
    except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError):
        evidence_entries = []
    finally:
        for p in (comments_path, payload_path):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass

    new_samples = sum(len(e.get("evidenceSamples", [])) for e in evidence_entries)

    # 4. Build report
    report = build_report(seed_results, flattened, evidence_entries, new_samples)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"\nMining evidence matches...")
        print(f"  {len(evidence_entries)} terms matched with new evidence")
        print(f"  {new_samples} new evidence samples total")

        by_family = {}
        for e in evidence_entries:
            f = e.get("family", "unknown")
            by_family.setdefault(f, []).append(e)
        print("\nNew evidence by family:")
        for family, entries in sorted(by_family.items(), key=lambda x: -len(x[1])):
            print(f"  {family}: {len(entries)} terms")

        if evidence_entries:
            print("\nSample new evidence (first 10):")
            for entry in evidence_entries[:10]:
                samples = entry.get("evidenceSamples", [])
                print(f"  [{entry.get('family')}] {entry.get('term')}: +{len(samples)} samples")
                for sample in samples[:2]:
                    print(f'    → "{sample[:80]}{"..." if len(sample) > 80 else ""}"')

        if args.merge:
            print("\nMerging evidence into dictionary...")
            print("  (merge via merge_agent_dictionaries_plan or dictionary:prune)")
        else:
            print("\nDry run — use --merge to merge into dictionary.")


if __name__ == "__main__":
    main()
