import json, os, time
from pathlib import Path

ENTRIES_DIR = Path(r"D:\Bilibili_User_Personality\server\data\deepseekKeywordDictionary.entries")
INPUT_FILE = Path(r"D:\Bilibili_User_Personality\.claude\expanded_sparse_terms.json")

data = json.loads(INPUT_FILE.read_text(encoding="utf-8"))

for family in ["evasion", "correction", "evidence"]:
    shard_path = ENTRIES_DIR / f"{family}-001.json"
    if not shard_path.exists():
        print(f"SKIP {family}: no shard file")
        continue
    
    shard = json.loads(shard_path.read_text(encoding="utf-8"))
    existing_terms = {e["term"] for e in shard["entries"]}
    
    new_terms = data.get(family, {}).get("new_terms", [])
    added = 0
    for term in new_terms:
        if term in existing_terms:
            continue
        shard["entries"].append({
            "term": term,
            "family": family,
            "meaning": "",
            "risk": "low",
            "confidence": 0.7,
            "evidenceCount": 0,
            "updatedAt": "2026-06-27T00:00:00.000Z"
        })
        existing_terms.add(term)
        added += 1
    
    shard["updatedAt"] = "2026-06-27T00:00:00.000Z"
    shard_path.write_text(json.dumps(shard, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{family}: added {added} terms, now {len(shard['entries'])} total (was {len(shard['entries'])-added})")

# Regenerate the combined dictionary by merging all shards
all_entries = []
for shard_file in sorted(ENTRIES_DIR.glob("*-*.json")):
    if not shard_file.name.startswith(("attack","absolutes","cooperation","correction","evasion","evidence")):
        continue
    shard = json.loads(shard_file.read_text(encoding="utf-8"))
    all_entries.extend(shard["entries"])

combined_path = Path(r"D:\Bilibili_User_Personality\server\data\deepseekKeywordDictionary.json")
combined = {
    "version": 1,
    "updatedAt": "2026-06-27T00:00:00.000Z",
    "totalEntries": len(all_entries),
    "entries": all_entries
}
combined_path.write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\nCombined dictionary: {len(all_entries)} entries (was 1576, now +{len(all_entries)-1576})")

# Per-family counts
from collections import Counter
counts = Counter(e["family"] for e in all_entries)
for f in sorted(counts):
    print(f"  {f}: {counts[f]}")
