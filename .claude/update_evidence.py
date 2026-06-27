"""Update evidence files with newly found corpus matches."""
import json
import os
import sys
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding='utf-8')

# Load the matches we found
with open('.claude/weak_keyword_matches.json', 'r', encoding='utf-8') as f:
    matches = json.load(f)

# Map terms to their evidence file locations (from previous search)
TERM_LOCATIONS = {}
evidence_dir = 'server/data/deepseekKeywordDictionary.evidence'

# First, build term -> file mapping
for fname in sorted(os.listdir(evidence_dir)):
    if not fname.endswith('.json'):
        continue
    fpath = os.path.join(evidence_dir, fname)
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    for ev in data.get('evidence', []):
        term = ev.get('term', '')
        if term:
            TERM_LOCATIONS[term] = fname

# Group matches by file for efficient updates
file_updates = {}  # fname -> list of (term, message, source)
for term, match in matches.items():
    fname = TERM_LOCATIONS.get(term)
    if not fname:
        print(f"  WARNING: No evidence file found for '{term}'")
        continue
    if fname not in file_updates:
        file_updates[fname] = []
    file_updates[fname].append((term, match['message'], match['source']))

print(f"Updating {len(file_updates)} evidence files with {len(matches)} term matches...")

updated_terms = 0
for fname, term_updates in sorted(file_updates.items()):
    fpath = os.path.join(evidence_dir, fname)
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    for term, message, source in term_updates:
        # Find the term entry
        found = False
        for ev in data.get('evidence', []):
            if ev.get('term', '') == term:
                # Add new evidence sample
                if message not in ev.setdefault('evidenceSamples', []):
                    ev['evidenceSamples'].append(message)
                # Add new evidence source
                new_source = f"Bilibili direct probe corpus match: {source}"
                existing_sources = [s.get('source', '') if isinstance(s, dict) else str(s)
                                   for s in ev.get('evidenceSources', [])]
                source_exists = any(new_source in s for s in existing_sources)
                if not source_exists:
                    ev.setdefault('evidenceSources', []).append({'source': new_source})
                found = True
                updated_terms += 1
                break

        if not found:
            print(f"  WARNING: Term '{term}' not found in {fname}")

    data['updatedAt'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

    with open(fpath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  Updated {fname}: {len(term_updates)} terms")

print(f"\nUpdated {updated_terms} terms across {len(file_updates)} evidence files")

# Re-run coverage audit to check progress
print("\nRe-running coverage audit...")
