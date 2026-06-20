from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.local import LocalCorpusEvidenceJsonPayloadContractComparator, LocalCorpusEvidenceJsonPayloadRunner, LocalCorpusEvidencePayloadContractComparator as LocalCorpusEvidenceContractComparator, LocalCorpusEvidenceRunner


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Find merge-ready dictionary evidence from a local corpus JSON contract.")
    parser.add_argument("--payload", default="", help="Single JSON payload containing dictionary, comments/corpus, and options.")
    parser.add_argument("--dictionary", default="server/data/keywordDictionary.json")
    parser.add_argument("--comments", default="", help="Flattened comments JSON or a raw local corpus shape.")
    parser.add_argument("--target-evidence", type=int, default=3)
    parser.add_argument("--max-samples-per-term", type=int, default=3)
    parser.add_argument("--require-comment-backed-evidence", action="store_true")
    parser.add_argument("--target-term", action="append", default=[])
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible local corpus evidence report to compare.")
    args = parser.parse_args(argv)
    if args.payload:
        if args.compare_js_report:
            result = LocalCorpusEvidenceJsonPayloadContractComparator(args.payload, args.compare_js_report).compare()
        else:
            result = LocalCorpusEvidenceJsonPayloadRunner(args.payload).run()
    elif args.compare_js_report:
        if not args.comments:
            parser.error("--comments is required unless --payload is provided")
        result = LocalCorpusEvidenceContractComparator(
            args.dictionary,
            args.comments,
            args.compare_js_report,
            target_evidence=args.target_evidence,
            max_samples_per_term=args.max_samples_per_term,
            require_comment_backed_evidence=args.require_comment_backed_evidence,
            target_terms=args.target_term,
        ).compare()
    else:
        if not args.comments:
            parser.error("--comments is required unless --payload is provided")
        result = LocalCorpusEvidenceRunner(
            args.dictionary,
            args.comments,
            target_evidence=args.target_evidence,
            max_samples_per_term=args.max_samples_per_term,
            require_comment_backed_evidence=args.require_comment_backed_evidence,
            target_terms=args.target_term,
        ).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
