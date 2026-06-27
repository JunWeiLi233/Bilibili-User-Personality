import json, time, re

# Load deduplicated BV IDs
with open('D:/Bilibili_User_Personality/_trending_bvids.json', 'r') as f:
    bv_ids_raw = json.load(f)
bv_ids = list(dict.fromkeys(bv_ids_raw))
print(f"Unique BV IDs: {len(bv_ids)}")

# Load flat terms
with open('D:/Bilibili_User_Personality/server/data/_flat_terms.json', 'r', encoding='utf-8') as f:
    all_terms = json.load(f)

print(f"Total terms: {len(all_terms)}")
need_evidence = [t for t in all_terms if t['evidence_count'] < 3]
print(f"Terms needing <3 evidence: {len(need_evidence)}")
low_evidence = [t for t in all_terms if t['evidence_count'] < 5]
print(f"Terms with <5 evidence: {len(low_evidence)}")

# Build term set for fast matching
term_map = {t['term'].lower(): t for t in all_terms}
print(f"Term map size: {len(term_map)}")

# Use browser fetch to get danmaku (handles gzip automatically)
# First, get CID for a BV via browser fetch
print("\nFetching video info and danmaku via browser fetch...")
matched = {}
total_danmaku = 0

for i, bv in enumerate(bv_ids[:20]):
    print(f"\n[{i+1}/{min(20, len(bv_ids))}] Processing {bv}...")

    # Fetch video info to get CID
    fetch_info_js = f"""(async function() {{
        var resp = await fetch('https://api.bilibili.com/x/web-interface/view?bvid={bv}');
        var data = await resp.json();
        return JSON.stringify({{cid: data.data.cid, title: data.data.title, dm_count: data.data.stat.danmaku}});
    }})()"""

    try:
        info_str = js(fetch_info_js)
        info = json.loads(info_str)
        print(f"  Title: {info['title'][:50]}")
        print(f"  CID: {info['cid']}, DM count: {info['dm_count']}")
    except Exception as e:
        print(f"  Error fetching info: {e}")
        continue

    if not info.get('cid'):
        print(f"  No CID found, skipping")
        continue

    cid = info['cid']

    # Fetch danmaku via browser (browser handles gzip decompression)
    fetch_dm_js = f"""(async function() {{
        var resp = await fetch('https://api.bilibili.com/x/v1/dm/list.so?oid={cid}');
        var text = await resp.text();
        return text;
    })()"""

    try:
        dm_xml = js(fetch_dm_js)
    except Exception as e:
        print(f"  Error fetching danmaku: {e}")
        continue

    # Parse XML to extract text
    try:
        import xml.etree.ElementTree as ET
        root = ET.fromstring(dm_xml)
        dms = [d.text.strip() for d in root.iter('d') if d.text and d.text.strip()]
        total_danmaku += len(dms)
        print(f"  Parsed {len(dms)} danmaku")
    except Exception as e:
        print(f"  Error parsing XML: {e}")
        continue

    # Check each danmaku against dictionary terms
    matches_found = 0
    for dm in dms:
        dm_lower = dm.lower()
        for term_lower, term_data in term_map.items():
            if term_lower in dm_lower:
                if term_data['term'] not in matched:
                    matched[term_data['term']] = []
                if len(matched[term_data['term']]) < 5:  # cap per term
                    matched[term_data['term']].append({
                        'text': dm,
                        'source': f'bvid={bv}',
                        'title': info['title'][:60]
                    })
                matches_found += 1

    print(f"  Matches in this video: {matches_found}")
    time.sleep(0.5)  # gentle rate limiting

print(f"\n{'='*60}")
print(f"Total danmaku harvested: {total_danmaku}")
print(f"Matched dictionary terms: {len(matched)}")
print(f"Total match instances: {sum(len(v) for v in matched.values())}")

# Show matches for terms that need evidence most
for term in need_evidence[:30]:
    if term['term'] in matched:
        ms = matched[term['term']]
        print(f"\n  TERM '{term['term']}' (family: {term['family']}, existing: {term['evidence_count']}):")
        for m in ms[:3]:
            print(f"    - \"{m['text'][:80]}\" | {m['source']}")

# Save matched terms
output = {
    'matched_terms': matched,
    'total_danmaku': total_danmaku,
    'videos_scanned': min(20, len(bv_ids)),
    'terms_needing_evidence': len(need_evidence)
}
with open('D:/Bilibili_User_Personality/_danmaku_matches.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"\nResults saved to _danmaku_matches.json")
