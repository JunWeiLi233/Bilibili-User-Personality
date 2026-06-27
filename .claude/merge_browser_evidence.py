"""Merge browser-harvested evidence into dictionary entries and evidence shards."""
import json
import os
import time
import shutil
from pathlib import Path

ROOT = Path(r"D:\Bilibili_User_Personality")
RESULTS_PATH = ROOT / ".claude" / "browser_harvest_results.json"
ENTRIES_DIR = ROOT / "server" / "data" / "deepseekKeywordDictionary.entries"
EVIDENCE_DIR = ROOT / "server" / "data" / "deepseekKeywordDictionary.evidence"


def load_results():
    if not RESULTS_PATH.exists():
        print(f"ERROR: {RESULTS_PATH} not found")
        return {}
    with open(RESULTS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    by_term = {}
    for entry in data.get("entries", []):
        term = entry["term"]
        by_term.setdefault(term, []).append(entry)
    return by_term


def find_entry_file_and_index(term):
    """Find which entry file and index contains this term."""
    if not ENTRIES_DIR.exists():
        return None, None, None
    for fname in sorted(os.listdir(ENTRIES_DIR)):
        if not fname.endswith(".json"):
            continue
        fpath = ENTRIES_DIR / fname
        with open(fpath, "r", encoding="utf-8") as f:
            data = json.load(f)
        for idx, entry in enumerate(data.get("entries", [])):
            if entry.get("term") == term:
                return fpath, idx, data
    return None, None, None


def find_evidence_shard(term, family):
    """Find which evidence shard file should hold this term, or create a new one."""
    if not EVIDENCE_DIR.exists():
        return None

    # Look for an existing evidence entry for this term
    for fname in sorted(os.listdir(EVIDENCE_DIR)):
        if not fname.endswith(".json") or not fname.startswith(family + "-"):
            continue
        fpath = EVIDENCE_DIR / fname
        with open(fpath, "r", encoding="utf-8") as f:
            data = json.load(f)
        for ev in data.get("evidence", []):
            if ev.get("term") == term:
                return fpath, data

    # Not found — find the last shard for this family
    shards = sorted(
        [f for f in os.listdir(EVIDENCE_DIR) if f.startswith(family + "-") and f.endswith(".json")]
    )
    if not shards:
        return None, None

    last_shard = shards[-1]
    fpath = EVIDENCE_DIR / last_shard
    with open(fpath, "r", encoding="utf-8") as f:
        data = json.load(f)

    return fpath, data


def merge_term(term, browser_entries):
    """Merge browser evidence into one term's dictionary data."""
    fpath, idx, entry_data = find_entry_file_and_index(term)
    if not fpath:
        print(f"    ERROR: Entry file not found for '{term}'")
        return False

    entry = entry_data["entries"][idx]
    family = entry.get("family", "unknown")
    print(f"    Entry: {os.path.basename(fpath)} idx={idx} family={family}")

    # Find or create evidence shard
    ev_path, ev_data = find_evidence_shard(term, family)
    if not ev_path:
        print(f"    ERROR: No evidence shard for family '{family}'")
        return False

    # Build evidence entry
    all_samples = []
    all_sources = []
    for be in browser_entries:
        for s in be.get("samples", []):
            s_clean = s.strip()
            if s_clean and s_clean not in all_samples:
                all_samples.append(s_clean)
        source = {
            "source": be.get("source", ""),
            "uid": be.get("uid", ""),
            "sample": (be.get("samples", [""])[0] or "").strip(),
        }
        source_key = f"{source['source']}{source['uid']}"
        if not any((s.get("source", "") + s.get("uid", "")) == source_key for s in all_sources):
            all_sources.append(source)

    # Cap samples at 5, sources at 8
    samples = all_samples[:5]
    sources = all_sources[:8]

    # Look if term already has evidence in this shard
    existing_ev = None
    for ev in ev_data.get("evidence", []):
        if ev.get("term") == term:
            existing_ev = ev
            break

    if existing_ev:
        # Merge
        existing_samples = existing_ev.get("evidenceSamples", [])
        existing_sources = existing_ev.get("evidenceSources", [])
        for s in samples:
            if s not in existing_samples:
                existing_samples.append(s)
        for s in sources:
            existing_sources.append(s)
        existing_ev["evidenceSamples"] = existing_samples[:5]
        existing_ev["evidenceSources"] = existing_sources[:8]
    else:
        # Add new
        ev_data.setdefault("evidence", []).append({
            "term": term,
            "evidenceSamples": samples,
            "evidenceSources": sources,
        })

    # Update entry evidenceCount
    new_count = min(len(samples), len(sources))
    if new_count > 0:
        old_count = entry.get("evidenceCount", 0) or 0
        entry["evidenceCount"] = max(old_count, new_count)
        entry["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    # Backup and write evidence shard
    bak = str(ev_path) + ".bak"
    shutil.copy2(str(ev_path), bak)
    with open(ev_path, "w", encoding="utf-8") as f:
        json.dump(ev_data, f, ensure_ascii=False, indent=2)

    # Backup and write entry file
    bak2 = str(fpath) + ".bak"
    shutil.copy2(str(fpath), bak2)
    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(entry_data, f, ensure_ascii=False, indent=2)

    print(f"    Merged: {new_count} samples, {len(sources)} sources")
    return True


def main():
    by_term = load_results()
    if not by_term:
        print("No results to merge.")
        return

    print(f"Terms to merge: {len(by_term)}")
    merged = 0
    for term, entries in sorted(by_term.items()):
        print(f"\n  {term} ({len(entries)} entries, {sum(len(e.get('samples',[])) for e in entries)} samples)")
        try:
            if merge_term(term, entries):
                merged += 1
        except Exception as e:
            print(f"    ERROR: {e}")

    print(f"\n{'='*60}")
    print(f"Merged {merged}/{len(by_term)} terms")
    print("Next: 'npm run dictionary:coverage' to re-audit")


if __name__ == "__main__":
    main()
