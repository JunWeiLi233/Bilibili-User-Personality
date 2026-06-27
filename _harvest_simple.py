# Browser-harness danmaku harvester using async fetch via js()
import json, time, re, xml.etree.ElementTree as ET

# Load BV IDs
with open('D:/Bilibili_User_Personality/_trending_bvids.json', 'r') as f:
    bv_ids_raw = json.load(f)
bv_ids = list(dict.fromkeys(bv_ids_raw))
print(f"Unique BV IDs: {len(bv_ids)}")

# Load terms
with open('D:/Bilibili_User_Personality/server/data/_flat_terms.json', 'r', encoding='utf-8') as f:
    all_terms = json.load(f)
term_set = {}
for t in all_terms:
    term_set[t['term'].lower()] = (t['term'], t['family'], t['evidence_count'])
print(f"Terms loaded: {len(term_set)}")

matched = {}
total_danmaku = 0

for i, bv in enumerate(bv_ids[:15]):
    print(f"\n[{i+1}/{min(15, len(bv_ids))}] BV={bv}...")

    # Get CID via async fetch in browser
    fetch_info = """(async function(bvid) {
        const resp = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
        const data = await resp.json();
        return JSON.stringify({
            cid: data.data && data.data.cid,
            title: (data.data && data.data.title || '').substring(0, 80),
            dm_count: data.data && data.data.stat && data.data.stat.danmaku
        });
    })(""" + f'"{bv}"' + """)"""

    try:
        info_str = js(fetch_info)
        info = json.loads(info_str)
        cid = info.get('cid', 0)
        title = info.get('title', '')
        dm_count = info.get('dm_count', 0)
        print(f"  Title: {title}")
        print(f"  CID: {cid}, DM count: {dm_count}")
    except Exception as e:
        print(f"  Error getting info: {e}")
        continue

    if not cid:
        print(f"  No CID")
        continue

    # Fetch danmaku via async fetch in browser (browser handles gzip)
    fetch_dm = """(async function(cid) {
        const resp = await fetch('https://api.bilibili.com/x/v1/dm/list.so?oid=' + cid);
        const text = await resp.text();
        return text;
    })(""" + str(cid) + """)"""

    try:
        dm_xml = js(fetch_dm)
    except Exception as e:
        print(f"  Error fetching DM: {e}")
        continue

    # Parse XML
    try:
        root = ET.fromstring(dm_xml)
        dms = [d.text.strip() for d in root.iter('d') if d.text and d.text.strip()]
        total_danmaku += len(dms)
        print(f"  Parsed {len(dms)} danmaku")
        if dms:
            print(f"  Samples: {dms[:5]}")
    except Exception as e:
        preview = dm_xml[:300] if dm_xml else '(empty)'
        print(f"  XML parse error: {e}")
        print(f"  Response preview: {preview}")
        continue

    # Cross-reference with terms
    match_count = 0
    for dm in dms:
        dm_lower = dm.lower()
        for term_lower, (term_orig, family, ev_count) in term_set.items():
            if term_lower in dm_lower:
                if term_orig not in matched:
                    matched[term_orig] = {
                        'family': family,
                        'existing_evidence': ev_count,
                        'new_matches': []
                    }
                if len(matched[term_orig]['new_matches']) < 5:
                    matched[term_orig]['new_matches'].append({
                        'text': dm,
                        'source': f'bvid={bv}'
                    })
                match_count += 1

    print(f"  Term matches: {match_count}")
    time.sleep(2)  # rate limit

print(f"\n{'='*60}")
print(f"Total danmaku harvested: {total_danmaku}")
print(f"Terms with matches: {len(matched)}")
total_new = sum(len(v['new_matches']) for v in matched.values())
print(f"Total match instances: {total_new}")

# Focus on terms needing evidence
need_more = {k: v for k, v in matched.items() if v['existing_evidence'] < 5}
print(f"\nTerms with <5 existing evidence that got new matches: {len(need_more)}")
if need_more:
    for term, data in sorted(need_more.items(), key=lambda x: x[1]['existing_evidence'])[:20]:
        print(f"  '{term}' ({data['family']}) existing={data['existing_evidence']}: +{len(data['new_matches'])} new")
else:
    print("  All matched terms already have 5+ evidence.")

# Save
with open('D:/Bilibili_User_Personality/_danmaku_matches.json', 'w', encoding='utf-8') as f:
    json.dump(matched, f, ensure_ascii=False, indent=2)
print(f"\nSaved to _danmaku_matches.json")
