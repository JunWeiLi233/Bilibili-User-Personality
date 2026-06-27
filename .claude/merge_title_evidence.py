"""Merge video title evidence into dictionary monolith."""
import json
import time
import os

ROOT = r"D:\Bilibili_User_Personality"
RESULTS_PATH = os.path.join(ROOT, ".claude", "title_evidence_results.json")
DICT_PATH = os.path.join(ROOT, "server", "data", "deepseekKeywordDictionary.json")


def main():
    # Load results
    with open(RESULTS_PATH, "r", encoding="utf-8") as f:
        results = json.load(f)

    # Load dictionary
    with open(DICT_PATH, "r", encoding="utf-8") as f:
        dict_data = json.load(f)

    entries = dict_data.get("entries", [])
    merged = 0

    for ev_entry in results.get("entries", []):
        term = ev_entry["term"]
        title_matches = ev_entry.get("titleMatches", [])

        # Find entry in dictionary
        for entry in entries:
            if entry.get("term") != term:
                continue

            # Build evidence samples from titles
            new_samples = []
            new_sources = []
            for tm in title_matches[:5]:
                title = tm["title"].strip()
                if title and title not in new_samples:
                    new_samples.append(title)
                new_sources.append({
                    "source": "Bilibili search-discovered video title: " + tm.get("url", ""),
                    "uid": tm.get("bvid", ""),
                    "sample": title[:100],
                })

            # Merge with existing
            existing_samples = entry.get("evidenceSamples", []) or []
            existing_sources = entry.get("evidenceSources", []) or []

            for s in new_samples:
                if s not in existing_samples:
                    existing_samples.append(s)
            for s in new_sources:
                if not any(
                    (e.get("source", "") + e.get("uid", "")) == (s["source"] + s["uid"])
                    for e in existing_sources
                ):
                    existing_sources.append(s)

            entry["evidenceSamples"] = existing_samples[:5]
            entry["evidenceSources"] = existing_sources[:8]
            entry["evidenceCount"] = max(
                entry.get("evidenceCount", 0) or 0,
                min(len(entry["evidenceSamples"]), len(entry["evidenceSources"])),
            )
            entry["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            merged += 1
            break

    # Write back
    with open(DICT_PATH, "w", encoding="utf-8") as f:
        json.dump(dict_data, f, ensure_ascii=False, indent=2)

    print("Merged " + str(merged) + " terms with title evidence")
    print("Total entries: " + str(len(entries)))


if __name__ == "__main__":
    main()
