"""Collect UIDs from multiple Bilibili videos via browser-harness."""
import json, time

BVDS = [
    ("BV1m54y1Q7eQ", "中华"),      # 56702 comments
    ("BV1oT4y1671T", "历史"),      # 34056
    ("BV1zW411j7r6", "中国历代疆域变化"),  # 29135
    ("BV1n441127jG", "中国历史"),   # 27033
    ("BV1cX4y1y7qR", "乾隆"),      # 18678
    ("BV1Ue4y1w7bk", "历史剧"),    # 17910
    ("BV1JK7N6xEtw", "秦始皇"),    # 16121
    ("BV1Z5411p7Ct", "二战"),      # 14124
    ("BV1cM41197ui", "史记"),      # 13667
    ("BV1fs411m7tX", "抗日战争"),   # 13564
]

OUTPUT = "D:/Bilibili_User_Personality/.claude/extracted_uids.json"

def get_aids():
    """Get AIDs from BVIDs using the Bilibili API in browser context."""
    aids = {}
    for bvid, seed in BVDS:
        js_code = (
            '(async function() {'
            'try {'
            f'const url = "https://api.bilibili.com/x/web-interface/view?bvid={bvid}";'
            'const resp = await fetch(url, { headers: { "Referer": "https://www.bilibili.com/" } });'
            'const data = await resp.json();'
            'return JSON.stringify({ aid: data.data ? data.data.aid : 0, title: data.data ? data.data.title : "" });'
            '} catch(e) { return JSON.stringify({ error: e.message }); }'
            '})()'
        )
        raw = js(js_code)
        if raw:
            try:
                result = json.loads(raw)
                if result.get('aid'):
                    aids[bvid] = result['aid']
                    print(f'  {bvid}: aid={result["aid"]}, title={result.get("title","")[:40]}')
            except:
                pass
        time.sleep(0.2)
    return aids

all_uids = set()
video_stats = {}

print('=== Opening Bilibili ===')
smart_open('https://www.bilibili.com/video/BV1m54y1Q7eQ/')
wait_for_load()
wait(3)
print(page_info())

print('\n=== Getting AIDs ===')
aids = get_aids()
if not aids:
    # Hardcode for the main video which we know works
    aids = {'BV1m54y1Q7eQ': 840488687}
    print('  Using hardcoded AID for main video')

print(f'\n=== Extracting UIDs from {len(aids)} videos ===')
for bvid, seed in BVDS:
    if len(all_uids) >= 500:
        break
    
    aid = aids.get(bvid)
    if not aid:
        continue
    
    print(f'\n--- {seed} ({bvid}, aid={aid}) ---')
    video_before = len(all_uids)
    
    for mode in [3, 2]:
        if len(all_uids) >= 500:
            break
        
        js_code = (
            f'(async function() {{'
            f'try {{'
            f'const url = "https://api.bilibili.com/x/v2/reply/main?oid={aid}&type=1&mode={mode}&ps=40";'
            f'const resp = await fetch(url, {{ headers: {{ "Referer": "https://www.bilibili.com/" }} }});'
            f'const data = await resp.json();'
            f'if (data.code === 0 && data.data && data.data.replies) {{'
            f'return JSON.stringify({{ ok: true, uids: data.data.replies.map(function(r) {{ return String(r.mid || (r.member && r.member.mid) || ""); }}).filter(Boolean) }});'
            f'}}'
            f'return JSON.stringify({{ ok: false, code: data.code }});'
            f'}} catch(e) {{ return JSON.stringify({{ ok: false, error: e.message }}); }}'
            f'}})()'
        )
        
        raw = js(js_code)
        if raw:
            try:
                result = json.loads(raw)
                if result.get('ok') and result.get('uids'):
                    before = len(all_uids)
                    all_uids.update(result['uids'])
                    added = len(all_uids) - before
                    print(f'  mode={mode}: +{added} UIDs (total: {len(all_uids)})')
            except:
                pass
        
        time.sleep(0.3)
    
    video_added = len(all_uids) - video_before
    video_stats[bvid] = video_added
    print(f'  Video total: +{video_added}')

print(f'\n=== Collected {len(all_uids)} unique UIDs ===')
for bvid, count in video_stats.items():
    print(f'  {bvid}: {count}')

uid_list = list(all_uids)
with open(OUTPUT, 'w', encoding='utf-8') as f:
    json.dump({
        'seed': '中华',
        'bvid': 'BV1m54y1Q7eQ',
        'video_title': '【醒醒】中华儿女该起床了',
        'videos_queried': len(video_stats),
        'unique_uids_collected': len(uid_list),
        'video_stats': video_stats,
        'uids': uid_list,
    }, f, ensure_ascii=False, indent=2)
print(f'Saved to {OUTPUT}')
