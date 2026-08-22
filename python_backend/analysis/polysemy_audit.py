"""Automated polysemy audit for the Chinese keyword dictionary.

Detects terms that appear in multiple families (cross-family conflicts) and
terms that, despite being in a single family, have suppression functions in
commentCoverage.js indicating context-dependent meanings.

Outputs a prioritized list of candidates for multi-sense splitting (Phase 5
of the polysemy disambiguation plan).
"""

import json
import os
import re
from collections import defaultdict
from pathlib import Path

ENTRIES_DIR = Path("server/data/deepseekKeywordDictionary.entries")
COMMENT_COVERAGE_JS = Path("server/services/commentCoverage.js")

# Known polysemous terms that need manual sense definition.
# These are terms confirmed to have context-dependent meanings that the
# automated audit can flag but not fully resolve.
KNOWN_POLYSEMOUS = {
    "急了": [
        {"family": "attack", "meaning": "嘲讽对方情绪失控，攻击性用法",
         "risk": "medium", "scenario": "taunting",
         "contextHints": ["你", "哈哈哈", "破防", "急眼", "典"],
         "contextAntiHints": ["别", "慢慢", "马上", "市场", "不急"],
         "note": "最常见的攻击性用法，配合笑声或挑衅词"},
        {"family": "cooperation", "meaning": "中性或关心的催促/安抚",
         "risk": "positive", "scenario": "reassurance",
         "contextHints": ["别", "慢慢来", "不急", "马上到", "没事"],
         "note": "安抚或催促语境，不含攻击性"},
    ],
    "逆天": [
        {"family": "attack", "meaning": "贬义：形容事物超出常理到令人不满的地步",
         "risk": "medium", "scenario": "taunting",
         "contextHints": ["垃圾", "恶心", "无语", "离谱"],
         "contextAntiHints": ["操作", "强", "秀", "牛", "太强"],
         "note": "贬义用法，搭配负面评价词"},
        {"family": "cooperation", "meaning": "褒义：形容操作或表现极其出色",
         "risk": "positive", "scenario": "praise",
         "contextHints": ["操作", "强", "牛", "太强了", "秀"],
         "contextAntiHints": ["垃圾", "恶心"],
         "note": "游戏/竞技语境中的正面赞叹"},
    ],
    "典中典": [
        {"family": "attack", "meaning": "讽刺：形容言论过于经典以至于成为笑柄",
         "risk": "medium", "scenario": "taunting",
         "contextHints": ["笑", "哈哈哈", "绷不住", "经典"],
         "contextAntiHints": ["教科书", "案例", "教材"],
         "note": "讽刺用法，常用于反驳荒谬言论"},
        {"family": "evidence", "meaning": "中性：指教科书级别的典型案例",
         "risk": "low", "scenario": "neutral_info",
         "contextHints": ["教科书", "案例", "教材", "典型"],
         "contextAntiHints": ["笑", "哈哈哈"],
         "note": "教育/分析语境中的客观引用"},
    ],
}

# Cross-family terms detected by automated scan (2026-06-27, 11 terms).
# Each entry here defines the senses that resolve the cross-family conflict.
CROSS_FAMILY_SENSES = {
    "啊对对对": [
        {"family": "attack", "meaning": "敷衍式嘲讽回应，表示不屑争辩",
         "risk": "medium", "scenario": "taunting",
         "contextHints": ["你", "懒得", "对对对"],
         "contextAntiHints": ["赞同", "同意", "确实"]},
        {"family": "evasion", "meaning": "回避争论，用敷衍态度退出讨论",
         "risk": "low", "scenario": "argument",
         "contextHints": ["懒得", "不想", "行了吧"],
         "contextAntiHints": []},
    ],
    "插眼": [
        {"family": "cooperation", "meaning": "标记帖子以便后续查看",
         "risk": "positive", "scenario": "neutral_info",
         "contextHints": ["收藏", "回头看", "mark"],
         "contextAntiHints": []},
        {"family": "evasion", "meaning": "用'插眼'回避直接回应问题",
         "risk": "low", "scenario": "argument",
         "contextHints": [],
         "contextAntiHints": ["回头看", "收藏"]},
    ],
    "对对对": [
        {"family": "attack", "meaning": "敷衍式嘲讽：用重复对对对表达不耐烦",
         "risk": "medium", "scenario": "taunting",
         "contextHints": ["你", "行了吧"],
         "contextAntiHints": ["赞同", "同意", "支持"]},
        {"family": "evasion", "meaning": "用敷衍态度回避深入讨论",
         "risk": "low", "scenario": "argument",
         "contextHints": [],
         "contextAntiHints": []},
    ],
    "反转了": [
        {"family": "correction", "meaning": "指出事件出现了新变化/反转",
         "risk": "positive", "scenario": "neutral_info",
         "contextHints": ["真相", "实际", "后续"],
         "contextAntiHints": []},
        {"family": "evidence", "meaning": "用'反转'主张原信息不实，需新证据",
         "risk": "medium", "scenario": "argument",
         "contextHints": ["证据", "打脸", "错了"],
         "contextAntiHints": []},
    ],
    "谜语人": [
        {"family": "attack", "meaning": "讽刺说话含糊不清、故弄玄虚",
         "risk": "medium", "scenario": "taunting",
         "contextHints": ["装", "懂", "秀"],
         "contextAntiHints": []},
        {"family": "evasion", "meaning": "指责对方不直接回答问题",
         "risk": "low", "scenario": "argument",
         "contextHints": ["说清楚", "直接"],
         "contextAntiHints": ["装"]},
    ],
    "受教了": [
        {"family": "cooperation", "meaning": "真诚感谢对方的教导",
         "risk": "positive", "scenario": "praise",
         "contextHints": ["谢谢", "感谢", "学到了"],
         "contextAntiHints": ["呵呵", "行吧"]},
        {"family": "correction", "meaning": "承认错误并接受纠正",
         "risk": "positive", "scenario": "neutral_info",
         "contextHints": ["原来", "确实", "我的错"],
         "contextAntiHints": ["呵呵"]},
    ],
    "下次一定": [
        {"family": "attack", "meaning": "讽刺：永远不会兑现的承诺",
         "risk": "medium", "scenario": "taunting",
         "contextHints": ["鸽", "骗", "信你"],
         "contextAntiHints": ["真的", "保证"]},
        {"family": "evasion", "meaning": "用模糊承诺回避当前要求",
         "risk": "low", "scenario": "argument",
         "contextHints": [],
         "contextAntiHints": []},
    ],
    "学习了": [
        {"family": "cooperation", "meaning": "真诚表示学到了新知识",
         "risk": "positive", "scenario": "praise",
         "contextHints": ["谢谢", "厉害", "有用"],
         "contextAntiHints": ["呵呵", "哦"]},
        {"family": "correction", "meaning": "接受纠正并表示学到了正确信息",
         "risk": "positive", "scenario": "neutral_info",
         "contextHints": ["原来", "确实"],
         "contextAntiHints": ["呵呵"]},
    ],
    "一言难尽": [
        {"family": "attack", "meaning": "用含糊表达暗示对方问题严重",
         "risk": "low", "scenario": "taunting",
         "contextHints": ["你", "你们", "这"],
         "contextAntiHints": ["我", "自己"]},
        {"family": "evasion", "meaning": "回避详细解释，用模糊表达搪塞",
         "risk": "low", "scenario": "argument",
         "contextHints": ["不好说", "不方便"],
         "contextAntiHints": []},
    ],
    "张口就来": [
        {"family": "attack", "meaning": "指责对方不经思考就发言",
         "risk": "medium", "scenario": "argument",
         "contextHints": ["胡", "瞎", "乱"],
         "contextAntiHints": []},
        {"family": "evidence", "meaning": "质疑对方缺乏证据的断言",
         "risk": "medium", "scenario": "argument",
         "contextHints": ["证据", "数据", "来源"],
         "contextAntiHints": ["胡", "瞎"]},
    ],
    "指路": [
        {"family": "cooperation", "meaning": "友善地提供链接或方向指引",
         "risk": "positive", "scenario": "praise",
         "contextHints": ["这里", "链接", "看", "https"],
         "contextAntiHints": []},
        {"family": "evidence", "meaning": "提供信息源作为证据支持",
         "risk": "low", "scenario": "neutral_info",
         "contextHints": ["证据", "来源", "数据"],
         "contextAntiHints": []},
    ],
}


def load_all_entries(entries_dir: Path = ENTRIES_DIR) -> list[dict]:
    """Load all dictionary entries from split shard files."""
    all_entries = []
    for filepath in sorted(entries_dir.glob("*.json")):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            for entry in data.get("entries", []):
                if entry.get("term"):
                    all_entries.append({
                        "term": entry["term"],
                        "family": entry.get("family", data.get("family", "?")),
                        "meaning": entry.get("meaning", ""),
                        "risk": entry.get("risk", ""),
                        "file": filepath.name,
                    })
        except (json.JSONDecodeError, OSError) as exc:
            print(f"  [warn] Could not read {filepath}: {exc}")
    return all_entries


def detect_cross_family_terms(entries: list[dict]) -> dict[str, set[str]]:
    """Group entries by term and find those appearing in multiple families."""
    by_term: dict[str, set[str]] = defaultdict(set)
    for entry in entries:
        by_term[entry["term"]].add(entry["family"])
    return {term: families for term, families in by_term.items()
            if len(families) >= 2}


def detect_suppressed_terms() -> dict[str, list[str]]:
    """Scan commentCoverage.js for FP suppression functions and extract
    which terms they target."""
    if not COMMENT_COVERAGE_JS.exists():
        print(f"  [warn] {COMMENT_COVERAGE_JS} not found, skipping suppression scan")
        return {}

    suppressed: dict[str, list[str]] = defaultdict(list)
    try:
        with open(COMMENT_COVERAGE_JS, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError:
        return {}

    # Find function definitions and extract the terms they target
    func_pattern = re.compile(
        r"function (is\w+Context)\(entry,\s*message\)\s*\{.*?(?=\nfunction |\n$)",
        re.DOTALL,
    )
    for match in func_pattern.finditer(content):
        func_name = match.group(1)
        body = match.group(0)
        # Extract terms referenced in the function (entry.term or term ===)
        terms_in_func = set()
        for m in re.finditer(r"(?:entry\??\.term|term)\s*[=!]==?\s*['\"](.+?)['\"]", body):
            terms_in_func.add(m.group(1))
        for term in terms_in_func:
            suppressed[term].append(func_name)

    return dict(suppressed)


def audit(entries_dir: Path = ENTRIES_DIR) -> dict:
    """Run the full polysemy audit.

    Returns a report dict with:
      - cross_family: {term: [families]}
      - suppressed_terms: {term: [suppression functions]}
      - candidates: prioritized list of terms to split
      - known_polysemous: terms with predefined senses
      - cross_family_senses: terms with cross-family sense definitions
    """
    print("=== Polysemy Audit ===")
    print()

    # 1. Load entries
    print("Loading entries...")
    entries = load_all_entries(entries_dir)
    print(f"  Total entries: {len(entries)}")
    print(f"  Unique terms: {len({e['term'] for e in entries})}")

    # 2. Cross-family detection
    print()
    print("--- Cross-family terms ---")
    cross_family = detect_cross_family_terms(entries)
    if cross_family:
        for term, families in sorted(cross_family.items(),
                                     key=lambda x: len(x[1]), reverse=True):
            print(f"  {term}: {', '.join(sorted(families))}")
    else:
        print("  None found")
    print(f"  Total: {len(cross_family)}")

    # 3. Suppression function scan
    print()
    print("--- Terms with FP suppression functions ---")
    suppressed = detect_suppressed_terms()
    if suppressed:
        for term, funcs in sorted(suppressed.items(),
                                  key=lambda x: len(x[1]), reverse=True):
            print(f"  {term}: {', '.join(funcs)}")
    else:
        print("  None found")
    print(f"  Total terms with suppression: {len(suppressed)}")

    # 4. Build candidate list
    print()
    print("--- Prioritized candidates for multi-sense splitting ---")
    candidates = []

    # Priority 1: Known polysemous (manual review already done)
    for term in sorted(KNOWN_POLYSEMOUS):
        families = cross_family.get(term, set())
        sup_funcs = suppressed.get(term, [])
        priority = "P0 (known polysemous)"
        candidates.append({
            "term": term,
            "priority": priority,
            "cross_family": sorted(families),
            "suppression_functions": sup_funcs,
            "has_senses_defined": term in KNOWN_POLYSEMOUS,
            "has_cross_family_senses": term in CROSS_FAMILY_SENSES,
        })
        print(f"  P0  {term} — known polysemous"
              + (f", cross-family: {', '.join(sorted(families))}" if families else ""))

    # Priority 2: Cross-family with senses defined
    for term in sorted(CROSS_FAMILY_SENSES):
        if term in KNOWN_POLYSEMOUS:
            continue
        families = cross_family.get(term, set())
        sup_funcs = suppressed.get(term, [])
        candidates.append({
            "term": term,
            "priority": "P1 (cross-family, senses defined)",
            "cross_family": sorted(families),
            "suppression_functions": sup_funcs,
            "has_senses_defined": False,
            "has_cross_family_senses": True,
        })
        print(f"  P1  {term} — cross-family: {', '.join(sorted(families))}")

    # Priority 3: Has suppression functions but not yet split
    for term, funcs in sorted(suppressed.items()):
        already_listed = any(c["term"] == term for c in candidates)
        if already_listed:
            continue
        candidates.append({
            "term": term,
            "priority": "P2 (has suppression functions)",
            "cross_family": [],
            "suppression_functions": funcs,
            "has_senses_defined": False,
            "has_cross_family_senses": False,
        })
        print(f"  P2  {term} — suppression: {', '.join(funcs[:3])}"
              + (f" +{len(funcs)-3} more" if len(funcs) > 3 else ""))

    print(f"  Total candidates: {len(candidates)}")

    return {
        "cross_family": {k: sorted(v) for k, v in cross_family.items()},
        "suppressed_terms": {k: sorted(v) for k, v in suppressed.items()},
        "candidates": candidates,
        "known_polysemous_count": len(KNOWN_POLYSEMOUS),
        "cross_family_senses_count": len(CROSS_FAMILY_SENSES),
        "total_entries": len(entries),
        "unique_terms": len({e["term"] for e in entries}),
    }


def build_multi_sense_entry(term: str) -> dict | None:
    """Build a multi-sense entry for a term, combining KNOWN_POLYSEMOUS
    and CROSS_FAMILY_SENSES definitions."""
    senses = None
    if term in KNOWN_POLYSEMOUS:
        senses = KNOWN_POLYSEMOUS[term]
    elif term in CROSS_FAMILY_SENSES:
        senses = CROSS_FAMILY_SENSES[term]

    if not senses:
        return None

    return {
        "term": term,
        "senses": [
            {
                "id": f"{term}-{i + 1}",
                "family": s["family"],
                "meaning": s["meaning"],
                "risk": s["risk"],
                "contextHints": s.get("contextHints", []),
                "contextAntiHints": s.get("contextAntiHints", []),
                "scenario": s.get("scenario"),
            }
            for i, s in enumerate(senses)
        ],
        "defaultSense": f"{term}-1",
    }


if __name__ == "__main__":
    import sys
    import io
    # Force UTF-8 output on Windows to avoid GBK encoding errors with CJK/emoji
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    else:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    report = audit()
    print()
    print("=== Summary ===")
    print(f"  Total entries: {report['total_entries']}")
    print(f"  Unique terms: {report['unique_terms']}")
    print(f"  Cross-family terms: {len(report['cross_family'])}")
    print(f"  Suppressed terms: {len(report['suppressed_terms'])}")
    print(f"  Known polysemous: {report['known_polysemous_count']}")
    print(f"  Cross-family senses defined: {report['cross_family_senses_count']}")
    print(f"  Total candidates for splitting: {len(report['candidates'])}")

    # Print a sample multi-sense entry
    print()
    print("--- Sample multi-sense entry (急了) ---")
    entry = build_multi_sense_entry("急了")
    if entry:
        print(json.dumps(entry, ensure_ascii=False, indent=2))
