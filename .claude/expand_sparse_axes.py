#!/usr/bin/env python3
"""Generate 30 fresh terms per sparse axis (evasion, correction, evidence) via DeepSeek."""

import json, os, re, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from python_backend.analyzers.deepseek_router import MODELS, resolve_model

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
MODEL = resolve_model("generate")

ENTRIES_DIR = Path("server/data/deepseekKeywordDictionary.entries")
OUTPUT_FILE = Path(".claude/expanded_sparse_terms.json")

FAMILY_PROMPTS = {
    "evasion": """You are a Chinese internet language expert. Generate 30 Chinese short phrases commonly used by Bilibili users for the "evasion" behavioral category.

Requirements:
- These phrases detect users "avoiding direct answers, deflecting, stonewalling" in Bilibili comments.
- Must be authentic expressions used by real Bilibili viewers, including internet slang, memes, and danmaku phrases.
- Each phrase max 20 characters, one per line.
- Include varying intensity: mild (hinting not to answer), moderate (direct topic change), severe (explicit refusal).
- Do NOT repeat these existing terms: 一家之言 你赢了 你猜 乐子 不针对谁 不置可否 不用我教
- No numbering, one term per line, exactly 30 terms.

Output exactly 30 new terms, one per line:""",

    "correction": """You are a Chinese internet language expert. Generate 30 Chinese short phrases commonly used by Bilibili users for the "correction" behavioral category.

Requirements:
- These phrases detect users "correcting themselves, admitting mistakes, revising viewpoints, retracting statements" in Bilibili comments.
- Must be authentic expressions used by real Bilibili viewers, including internet slang, memes, and danmaku phrases.
- Each phrase max 20 characters, one per line.
- Include varying intensity: mild (adjusting opinion), moderate (admitting error), severe (face-slapping / flip-flopping).
- Do NOT repeat these existing terms: 一时口误 上条作废 从良 修正射击 前面说重了 准确说 其实不是
- No numbering, one term per line, exactly 30 terms.

Output exactly 30 new terms, one per line:""",

    "evidence": """You are a Chinese internet language expert. Generate 30 Chinese short phrases commonly used by Bilibili users for the "evidence" behavioral category.

Requirements:
- These phrases detect users "demanding evidence, citing data, providing sources, fact-checking" in Bilibili comments.
- Must be authentic expressions used by real Bilibili viewers, including internet slang, memes, and danmaku phrases.
- Each phrase max 20 characters, one per line.
- Include varying intensity: mild (asking for source), moderate (demanding proof), severe (aggressive fact-checking).
- Do NOT repeat these existing terms: 10万 10年老粉 上截图 上链接 事实呢 出处 几分几秒 一手数据 为什么
- No numbering, one term per line, exactly 30 terms.

Output exactly 30 new terms, one per line:"""
}


def call_deepseek(prompt: str, max_tokens: int = 2000, temperature: float = 0.8) -> str:
    import urllib.request
    url = f"{BASE_URL}/chat/completions"
    body = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def parse_terms(text: str) -> list[str]:
    terms = []
    for line in text.strip().split("\n"):
        line = line.strip()
        line = re.sub(r'^[\d一二三四五六七八九十]+[\.\、\)\s]+', '', line).strip()
        line = line.strip('"\'""''「」『』')
        if not line or len(line) < 2 or len(line) > 20:
            continue
        if any(kw in line for kw in ["生成", "以下是", "新词", "输出", "分类", "---", "==="]):
            continue
        terms.append(line)
    return terms


def load_existing_terms(family: str) -> set[str]:
    entries_file = ENTRIES_DIR / f"{family}-001.json"
    if not entries_file.exists():
        return set()
    data = json.loads(entries_file.read_text(encoding="utf-8"))
    return {e["term"] for e in data.get("entries", [])}


def main():
    os.environ["PYTHONUTF8"] = "1"
    existing = {f: load_existing_terms(f) for f in FAMILY_PROMPTS}

    results = {}
    for family, prompt in FAMILY_PROMPTS.items():
        print(f"\n{'='*60}")
        print(f"Generating terms for: {family}")
        print(f"Existing terms: {len(existing[family])}")

        try:
            raw = call_deepseek(prompt)
            terms = parse_terms(raw)
            new_terms = [t for t in terms if t not in existing[family]]
            print(f"Generated: {len(terms)} raw, {len(new_terms)} new (after dedup)")
            for t in new_terms[:8]:
                print(f"  - {t}")
            if len(new_terms) > 8:
                print(f"  ... and {len(new_terms)-8} more")
            results[family] = {
                "new_terms": new_terms,
                "generated_count": len(terms),
                "new_count": len(new_terms),
                "existing_count": len(existing[family]),
            }
        except Exception as e:
            print(f"ERROR for {family}: {e}")
            results[family] = {"error": str(e)}

        time.sleep(2)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nResults saved to {OUTPUT_FILE}")

    print("\n=== Summary ===")
    for family, r in results.items():
        if "error" in r:
            print(f"  {family}: ERROR - {r['error']}")
        else:
            print(f"  {family}: {r['new_count']} new terms (was {r['existing_count']})")


if __name__ == "__main__":
    main()
