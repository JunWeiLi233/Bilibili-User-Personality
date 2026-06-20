from __future__ import annotations

import argparse
import json

from python_backend.corpus.tieba import TiebaCorpusUpdateContractComparator, TiebaCorpusUpdateRunner


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a JS-compatible Tieba corpus update from JSON contracts.")
    parser.add_argument("--existing", default="server/data/tiebaKeywordCorpus.json")
    parser.add_argument("--run", required=True, help="Path to a Tieba scrape run JSON object.")
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Tieba corpus update report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
        result = TiebaCorpusUpdateContractComparator(
            args.existing,
            args.run,
            args.compare_js_report,
            generated_at=args.generated_at or None,
        ).compare()
    else:
        result = TiebaCorpusUpdateRunner(args.existing, args.run, generated_at=args.generated_at or None).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
