"""CLI entry point for context classifier parity comparison.

Usage:
  python -m python_backend.cli.context_classifier --text <comment>
  python -m python_backend.cli.context_classifier --payload <json-file>
  python -m python_backend.cli.context_classifier --compare-js-report <path>
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from python_backend.analysis.context_classifier import (
    classify_scenario,
    scenario_score,
    scenario_match_bonus,
    SCENARIOS,
)


def run_fixtures():
    """Run a standard set of test fixtures and return results."""
    fixtures = [
        "哈哈哈笑死我了",
        "你有证据吗？请提供数据来源",
        "太强了！牛逼！支持！",
        "别急，慢慢来，没关系的",
        "我太菜了，萌新一个",
        "https://www.bilibili.com/video/BV1xx411c7mD",
        "",
        "今天天气不错",
        "666，爱了爱了",
        "你说得对，但是我没有证据",
    ]

    results = []
    for text in fixtures:
        result = classify_scenario(text)
        results.append(
            {
                "text": text,
                "scenario": result["scenario"],
                "confidence": result["confidence"],
                "scores": result["scores"],
            }
        )
    return {"ok": True, "fixtures": results, "scenarios": SCENARIOS}


def main():
    parser = argparse.ArgumentParser(description="Context classifier CLI")
    parser.add_argument("--text", type=str, help="Single comment text to classify")
    parser.add_argument("--payload", type=str, help="JSON payload file path")
    parser.add_argument(
        "--compare-js-report", type=str, help="Compare with JS report"
    )
    parser.add_argument("--fixtures", action="store_true", help="Run fixture tests")
    args = parser.parse_args()

    if args.fixtures:
        print(json.dumps(run_fixtures(), ensure_ascii=False))
        return

    if args.text:
        result = classify_scenario(args.text)
        print(json.dumps(result, ensure_ascii=False))
        return

    if args.payload:
        with open(args.payload, "r", encoding="utf-8") as f:
            payload = json.load(f)
        text = payload.get("text", "")
        result = classify_scenario(text)
        print(json.dumps(result, ensure_ascii=False))
        return

    if args.compare_js_report:
        with open(args.compare_js_report, "r", encoding="utf-8") as f:
            js_report = json.load(f)

        my_results = run_fixtures()

        # Compare fixtures
        js_fixtures = js_report.get("fixtures", [])
        py_fixtures = my_results.get("fixtures", [])

        mismatches = []
        for i, (js, py) in enumerate(zip(js_fixtures, py_fixtures)):
            if js.get("scenario") != py.get("scenario"):
                mismatches.append(
                    {
                        "index": i,
                        "text": js.get("text"),
                        "js_scenario": js.get("scenario"),
                        "py_scenario": py.get("scenario"),
                    }
                )

        print(
            json.dumps(
                {
                    "ok": len(mismatches) == 0,
                    "jsScenarios": js_report.get("scenarios"),
                    "pyScenarios": my_results.get("scenarios"),
                    "fixtureCount": len(py_fixtures),
                    "mismatches": mismatches,
                },
                ensure_ascii=False,
            )
        )
        return

    # Default: run fixtures
    print(json.dumps(run_fixtures(), ensure_ascii=False))


if __name__ == "__main__":
    main()
