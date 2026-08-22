"""Apply polysemy multi-sense migration to dictionary entry files.

Reads the current dictionary, replaces single-sense entries for polysemous
terms with their multi-sense equivalents defined in polysemy_audit.py, and
writes back the updated shard files.

Usage:
    python -m python_backend.cli.polysemy_migrate --dry-run
    python -m python_backend.cli.polysemy_migrate          # apply
"""

import argparse
import json
import sys
from pathlib import Path

# Add parent to path for import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from python_backend.analysis.polysemy_audit import (
    ENTRIES_DIR,
    KNOWN_POLYSEMOUS,
    CROSS_FAMILY_SENSES,
    build_multi_sense_entry,
)


def migrate_entries(entries_dir: Path, dry_run: bool = True) -> dict:
    """Apply multi-sense migration to dictionary entry files.

    For each polysemous term:
    1. Build the multi-sense entry
    2. Find which shard file(s) contain the old single-sense entry
    3. Replace (or remove duplicates) with the multi-sense entry

    The multi-sense entry goes into the family of its DEFAULT sense.
    Old entries in OTHER families get removed (the sense subsumes them).
    """
    # Build all multi-sense entries
    all_terms = set(KNOWN_POLYSEMOUS) | set(CROSS_FAMILY_SENSES)
    multi_sense_entries: dict[str, dict] = {}
    for term in sorted(all_terms):
        entry = build_multi_sense_entry(term)
        if entry:
            multi_sense_entries[term] = entry

    print(f"Terms to migrate: {len(multi_sense_entries)}")
    for term, entry in multi_sense_entries.items():
        print(f"  {term}: {len(entry['senses'])} senses, "
              f"default={entry['defaultSense']}")

    if dry_run:
        print("\n[Dry run — no files modified]")
        return {"migrated_terms": len(multi_sense_entries), "dry_run": True}

    # Apply migration to each shard file
    modified_files = 0
    terms_migrated = 0
    duplicate_terms_removed = 0

    for filepath in sorted(entries_dir.glob("*.json")):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"  [warn] Could not read {filepath}: {exc}")
            continue

        entries = data.get("entries", [])
        if not entries:
            continue

        file_family = data.get("family", "")
        new_entries = []
        seen_terms = set()
        file_modified = False

        for entry in entries:
            term = entry.get("term", "")
            if not term:
                new_entries.append(entry)
                continue

            if term in multi_sense_entries:
                multi = multi_sense_entries[term]
                default_family = multi["senses"][0]["family"]
                if file_family == default_family:
                    # This file gets the multi-sense entry
                    if term not in seen_terms:
                        new_entries.append(multi)
                        seen_terms.add(term)
                        terms_migrated += 1
                        file_modified = True
                else:
                    # This file had a duplicate — skip it (subsumed by multi-sense)
                    duplicate_terms_removed += 1
                    file_modified = True
            else:
                if term not in seen_terms:
                    new_entries.append(entry)
                    seen_terms.add(term)

        if file_modified:
            data["entries"] = new_entries
            data["updatedAt"] = None  # Will be set by merge pipeline
            try:
                with open(filepath, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                    f.write("\n")
                modified_files += 1
                print(f"  Updated {filepath.name}: "
                      f"{len(new_entries)} entries (was {len(entries)})")
            except OSError as exc:
                print(f"  [error] Could not write {filepath}: {exc}")

    return {
        "migrated_terms": terms_migrated,
        "duplicate_terms_removed": duplicate_terms_removed,
        "modified_files": modified_files,
        "dry_run": False,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Apply polysemy multi-sense migration to dictionary entries"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Preview migration without modifying files (default)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        dest="apply",
        help="Actually apply the migration",
    )
    parser.add_argument(
        "--entries-dir",
        default=str(ENTRIES_DIR),
        help="Path to dictionary entries directory",
    )
    args = parser.parse_args()

    dry_run = not args.apply
    entries_dir = Path(args.entries_dir)

    if not entries_dir.exists():
        print(f"Error: entries directory not found: {entries_dir}")
        sys.exit(1)

    result = migrate_entries(entries_dir, dry_run=dry_run)
    print(f"\nDone. {result}")


if __name__ == "__main__":
    main()
