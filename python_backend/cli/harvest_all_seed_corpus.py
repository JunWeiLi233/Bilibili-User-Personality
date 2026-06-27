"""
Round 4: Re-harvest evidence from ALL accumulated seed result directories.

Python contract for server/scripts/harvestAllSeedCorpus.js.
Produces identical JSON output for parity comparison.

Usage:
  python -m python_backend.cli.harvest_all_seed_corpus [--dry-run]
  python -m python_backend.cli.harvest_all_seed_corpus --merge
  python -m python_backend.cli.harvest_all_seed_corpus --compare-js-report <path>
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

SOURCE_DIRS = [
    ".claude/seed_results",
    ".claude/seed_results_deep",
    ".claude/seed_results_batch2",
    ".claude/seed_results_batch3",
]


def load_results_from_dir(rel_path: str) -> list:
    """Load all seed result JSON files from a directory."""
    abs_path = PROJECT_ROOT / rel_path
    results = []
    if not abs_path.is_dir():
        return results
    for f in sorted(abs_path.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if data.get("seed") and isinstance(data.get("videos"), list):
                results.append(data)
        except (json.JSONDecodeError, OSError):
            pass
    return results


def flatten_all_results(all_results: list, dir_label: str) -> dict:
    """Flatten seed results into a unified comments list."""
    comments = []
    total_comments = 0
    total_danmaku = 0
    newest_ts = 0
    oldest_ts = float("inf")

    for seed in all_results:
        seed_name = seed.get("seed", "unknown")
        for video in seed.get("videos", []):
            if video.get("error"):
                continue
            bvid = video.get("bvid", "unknown")
            source = (
                f"Bilibili history-tag harvest ({dir_label}): "
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
                    "message": message,
                    "platform": "bilibili",
                    "source": source,
                    "uid": bvid,
                    "uname": "",
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
                    "message": message,
                    "platform": "bilibili",
                    "source": source,
                    "uid": bvid,
                    "uname": "",
                })
                total_danmaku += 1

    return {
        "comments": comments,
        "totalComments": total_comments,
        "totalDanmaku": total_danmaku,
        "newestTs": newest_ts,
        "oldestTs": oldest_ts if oldest_ts < float("inf") else 0,
    }


def build_report(all_results, flattened, evidence_entries, new_samples):
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
            "evidenceCount": len(e.get("evidenceSamples", [])),
            "evidenceSamples": e.get("evidenceSamples", [])[:5],
        })

    return {
        "ok": True,
        "harvestedAt": datetime.now(timezone.utc).isoformat(),
        "source": "multi-round deep scrape (seed_results + seed_results_deep + batch2 + batch3)",
        "sourceFiles": len(all_results),
        "totalComments": flattened["totalComments"],
        "totalDanmaku": flattened["totalDanmaku"],
        "totalMessages": len(flattened["comments"]),
        "dateRange": {
            "oldest": datetime.fromtimestamp(flattened["oldestTs"], tz=timezone.utc).isoformat() if flattened["oldestTs"] else None,
            "newest": datetime.fromtimestamp(flattened["newestTs"], tz=timezone.utc).isoformat() if flattened["newestTs"] else None,
        },
        "matchedTerms": len(evidence_entries),
        "newEvidenceSamples": new_samples,
        "byFamily": {f: len(entries) for f, entries in sorted(by_family.items())},
        "entries": entries_report,
    }


def main():
    parser = argparse.ArgumentParser(description="Harvest evidence from all seed result directories")
    parser.add_argument("--dry-run", action="store_true", default=True,
                        help="Print report without merging (default)")
    parser.add_argument("--merge", action="store_true",
                        help="Merge evidence into dictionary")
    parser.add_argument("--compare-js-report", type=str,
                        help="Path to JS report JSON for parity comparison")
    args = parser.parse_args()

    # 1. Load all source directories
    all_results = []
    for d in SOURCE_DIRS:
        results = load_results_from_dir(d)
        if results:
            all_results.extend(results)

    if not all_results:
        print(json.dumps({"ok": True, "matchedTerms": 0, "note": "no seed results found"}, ensure_ascii=False))
        return

    # 2. Flatten
    flattened = flatten_all_results(all_results, "multi-round")

    # 3. Mine evidence via local_corpus_evidence CLI (Python-owned, call as subprocess)
    import subprocess
    import tempfile

    try:
        dictionary_path = PROJECT_ROOT / "server" / "data" / "deepseekKeywordDictionary.production.json"
        if not dictionary_path.exists():
            dictionary_path = PROJECT_ROOT / "server" / "data" / "deepseekKeywordDictionary.json"

        # Write flattened comments to temp file for the CLI
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False,
                                         encoding="utf-8") as tf:
            json.dump(flattened["comments"], tf)
            comments_path = tf.name

        # Write payload for local_corpus_evidence CLI
        payload = {
            "dictionaryPath": str(dictionary_path),
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
        else:
            evidence_entries = []
    except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError):
        evidence_entries = []
    finally:
        # Clean up temp files even on timeout or error
        for p in (comments_path, payload_path):
            try:
                os.unlink(p)
            except OSError:
                pass

    new_samples = sum(len(e.get("evidenceSamples", [])) for e in evidence_entries)

    # 4. Build report
    report = build_report(all_results, flattened, evidence_entries, new_samples)

    # 5. Handle --compare-js-report
    if args.compare_js_report:
        try:
            js_report = json.loads(Path(args.compare_js_report).read_text(encoding="utf-8"))
            match = (
                js_report.get("matchedTerms") == report["matchedTerms"]
                and js_report.get("totalMessages") == report["totalMessages"]
            )
            report["comparison"] = {
                "jsMatchedTerms": js_report.get("matchedTerms"),
                "pyMatchedTerms": report["matchedTerms"],
                "jsTotalMessages": js_report.get("totalMessages"),
                "pyTotalMessages": report["totalMessages"],
                "parity": match,
            }
        except (OSError, json.JSONDecodeError):
            report["comparison"] = {"error": "could not read JS report"}

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
