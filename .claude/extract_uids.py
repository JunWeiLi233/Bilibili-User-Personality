"""
Extract 100+ unique commenter UIDs from Bilibili video BV1m54y1Q7eQ
using browser-harness indexed interaction + Reply API.
"""
import json, time, random, os, sys

AID = 840488687
BVID = "BV1m54y1Q7eQ"
VIDEO_URL = f"https://www.bilibili.com/video/{BVID}"
OUTPUT = "D:/Bilibili_User_Personality/.claude/extracted_uids.json"
TARGET_UNIQUE = 300  # Extract more than needed for matching against AICU DB
MAX_PAGES = 50

def main():
    print("=== Opening Bilibili video page ===")
    smart_open(VIDEO_URL)
    wait_for_load()
    wait(3)
    print(page_info())

    all_uids = set()
    pages_with_data = 0
    
    # Use Reply API from browser context to get commenter UIDs
    for mode in [3, 2, 0]:  # hot, time-sorted, default
        for pn in range(1, 21):  # 20 pages per mode
            if len(all_uids) >= TARGET_UNIQUE:
                break
            
            js_code = f"""
            (async () => {{
                try {{
                    const url = 'https://api.bilibili.com/x/v2/reply/main?oid={AID}&type=1&mode={mode}&ps=40&pn={pn}';
                    const resp = await fetch(url, {{
                        headers: {{ 'Referer': 'https://www.bilibili.com/' }}
                    }});
                    const data = await resp.json();
                    if (data.code === 0 && data.data && data.data.replies) {{
                        return JSON.stringify({{
                            ok: true,
                            count: data.data.replies.length,
                            uids: data.data.replies.map(r => String(r.mid || r.member?.mid || '')).filter(Boolean),
                            hasMore: !data.data.cursor?.is_end
                        }});
                    }}
                    return JSON.stringify({{ok: false, code: data.code, message: data.message}});
                }} catch(e) {{
                    return JSON.stringify({{ok: false, error: e.message}});
                }}
            }})()
            """
            
            raw = js(js_code)
            if not raw:
                time.sleep(0.3)
                continue
            
            try:
                result = json.loads(raw)
            except:
                continue
            
            if result.get('ok') and result.get('uids'):
                before = len(all_uids)
                all_uids.update(result['uids'])
                added = len(all_uids) - before
                pages_with_data += 1
                print(f"  mode={mode} pn={pn}: +{added} unique (total: {len(all_uids)})")
                
                if not result.get('hasMore'):
                    break
            else:
                # Might be end of pages
                if result.get('code') and result['code'] != 0:
                    break
            
            time.sleep(0.5)  # Rate limiting
            
        if len(all_uids) >= TARGET_UNIQUE:
            break
    
    print(f"\n=== Collected {len(all_uids)} unique UIDs from {pages_with_data} pages ===")
    
    # Convert to list and save
    uid_list = list(all_uids)
    output = {
        "seed": "中华",
        "bvid": BVID,
        "aid": AID,
        "video_title": "【醒醒】中华儿女该起床了",
        "total_comments": 56706,
        "unique_uids_collected": len(uid_list),
        "pages_queried": pages_with_data,
        "uids": uid_list,
        "extracted_at": None  # Will be filled by JS
    }
    
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"Saved to {OUTPUT}")
    print(f"First 20 UIDs: {uid_list[:20]}")
    
    return len(uid_list)

result = main()
print(f"\nDone: {result} UIDs collected")
