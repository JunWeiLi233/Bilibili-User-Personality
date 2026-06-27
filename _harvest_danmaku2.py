import json, re, time
from concurrent.futures import ThreadPoolExecutor, as_completed

# Load BV IDs and deduplicate
with open('D:/Bilibili_User_Personality/_trending_bvids.json', 'r') as f:
    bv_ids_raw = json.load(f)

bv_ids = list(dict.fromkeys(bv_ids_raw))  # preserve order, deduplicate
print(f"Unique BV IDs: {len(bv_ids)}")

# Load dictionary terms that need evidence
dict_data = json.load(open('D:/Bilibili_User_Personality/server/data/deepseekKeywordDictionary.json', 'r', encoding='utf-8'))
all_terms = []
for entry in dict_data.get('entries', []):
    term = entry.get('term', '')
    family = entry.get('family', '')
    evidence = entry.get('evidence', [])
    all_terms.append({'term': term, 'family': family, 'evidence_count': len(evidence)})

need_evidence = [t for t in all_terms if t['evidence_count'] < 3]
print(f"Terms needing evidence (< 3): {len(need_evidence)}")
print(f"Total terms in dictionary: {len(all_terms)}")

# Also look for terms with 3 that could benefit from more
low_evidence = [t for t in all_terms if t['evidence_count'] < 5]
print(f"Terms with < 5 evidence: {len(low_evidence)}")

# Build a set of all dictionary terms for fast matching
term_set = set(t['term'].lower() for t in all_terms)
print(f"Unique terms in set: {len(term_set)}")

# Fetch CID and danmaku for each BV
def fetch_video_info(bvid):
    try:
        url = f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
        resp = http_get(url)
        data = json.loads(resp)
        cid = data.get('data', {}).get('cid', 0)
        title = data.get('data', {}).get('title', '')
        stat = data.get('data', {}).get('stat', {})
        return {'bvid': bvid, 'cid': cid, 'title': title, 'view': stat.get('view', 0), 'danmaku': stat.get('danmaku', 0)}
    except Exception as e:
        print(f"  Error fetching {bvid}: {e}")
        return None

def fetch_danmaku(video_info):
    if not video_info or not video_info['cid']:
        return []
    try:
        cid = video_info['cid']
        # Bilibili danmaku API returns XML
        url = f"https://api.bilibili.com/x/v1/dm/list.so?oid={cid}"
        resp = http_get(url)
        # Parse XML to extract text content
        import xml.etree.ElementTree as ET
        root = ET.fromstring(resp)
        danmaku_list = []
        for d in root.iter('d'):
            text = (d.text or '').strip()
            if text:
                danmaku_list.append(text)
        return danmaku_list
    except Exception as e:
        print(f"  Error fetching danmaku for {video_info.get('bvid', '?')}: {e}")
        return []

print("\nFetching video info for all BV IDs...")
with ThreadPoolExecutor(max_workers=5) as ex:
    futures = {ex.submit(fetch_video_info, bv): bv for bv in bv_ids}
    video_infos = []
    for f in as_completed(futures):
        result = f.result()
        if result:
            video_infos.append(result)

print(f"Got info for {len(video_infos)} videos")

# Fetch danmaku for top videos (those with most views or danmaku count)
video_infos.sort(key=lambda v: v['danmaku'], reverse=True)
top_videos = video_infos[:20]
print(f"\nTop {len(top_videos)} videos by danmaku count:")
for v in top_videos[:10]:
    print(f"  {v['title'][:50]}... (BV: {v['bvid']}, CID: {v['cid']}, DM: {v['danmaku']})")

print("\nFetching danmaku for top videos...")
all_danmaku = []
matched_terms = {}

for v in top_videos:
    dms = fetch_danmaku(v)
    print(f"  {v['title'][:40]}...: {len(dms)} danmaku fetched")
    all_danmaku.extend(dms)

    # Check each danmaku against dictionary terms
    for dm in dms:
        dm_lower = dm.lower()
        for term in all_terms:
            if term['term'].lower() in dm_lower:
                if term['term'] not in matched_terms:
                    matched_terms[term['term']] = []
                if len(matched_terms[term['term']]) < 5:
                    matched_terms[term['term']].append({
                        'text': dm,
                        'source': f"BV: {v['bvid']}",
                        'title': v['title']
                    })

print(f"\nTotal danmaku harvested: {len(all_danmaku)}")
print(f"Matched dictionary terms found in danmaku: {len(matched_terms)}")

# Show matches for terms that need evidence
for term in need_evidence[:20]:
    t = term['term']
    if t in matched_terms:
        print(f"\n  TERM '{t}' ({term['family']}, {term['evidence_count']} existing evidence):")
        for m in matched_terms[t][:3]:
            print(f"    - \"{m['text']}\" | {m['source']}")

# Save matched terms for adding to dictionary
output = {
    'matched_terms': {k: v for k, v in matched_terms.items()},
    'total_danmaku': len(all_danmaku),
    'videos_scanned': len(top_videos),
    'terms_needing_evidence': len(need_evidence)
}
with open('D:/Bilibili_User_Personality/_danmaku_matches.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print("\nMatches saved to _danmaku_matches.json")
