"""
Working harvest: /x/v2/reply for comments, /x/v2/dm/web/view protobuf for danmaku.
Conservative: 3s delay, sequential, rate-limit aware.
"""
import json, time, urllib.parse

OUT = "D:/Bilibili_User_Personality/.claude/harvest_v3.json"
ALL_C, ALL_D = [], []
SEEN = set()
DELAY = 3.0
MAX = 20

for p in ["D:/Bilibili_User_Personality/.claude/harvested_comments.json",
          "D:/Bilibili_User_Personality/.claude/harvested_danmaku.json"]:
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        for c in d.get("comments", []):
            SEEN.add(c.get("bvid", ""))
    except: pass
SEEN.discard("")

# ── Discovery ──────────────────────────────────────────────────────────
print("── Discovery ──")
queue = []
for pn in [1, 2, 3]:
    try:
        raw = http_get(f"https://api.bilibili.com/x/web-interface/popular?pn={pn}&ps=50")
        data = json.loads(raw)
        for v in data.get("data", {}).get("list", []):
            bv = v.get("bvid", "")
            if bv and bv not in SEEN:
                queue.append(bv); SEEN.add(bv)
    except: pass

# Search via browser
for q in ["评论区 对线", "时政 争议"]:
    encoded = urllib.parse.quote(q)
    smart_open(f"https://search.bilibili.com/video?keyword={encoded}&order=click")
    wait(2.5)
    try:
        bvs = js("(function(){var l=document.querySelectorAll('a[href*=\"/video/BV\"]');var s=new Set(),r=[];for(var i=0;i<l.length&&r.length<8;i++){var m=l[i].href.match(/BV[A-Za-z0-9]+/);if(!m||s.has(m[0]))continue;s.add(m[0]);r.push(m[0]);}return r;})()")
        for b in (bvs or []):
            if b not in SEEN: queue.append(b); SEEN.add(b)
    except: pass

print(f"Queue: {len(queue)} BVs")

# ── JS template ────────────────────────────────────────────────────────

JS = r"""(async function() {
    var bv = "ARG_BV";
    var R = {bv: bv, title: '', cc: 0, dc: 0, comments: [], danmaku: []};

    try {
        var ir = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bv);
        var id = await ir.json();
        if (!id.data) return JSON.stringify(R);
        R.title = (id.data.title || '').substring(0, 80);
        R.aid = id.data.aid;
        R.cid = id.data.cid;
    } catch(e) { return JSON.stringify(R); }

    // Comments via /x/v2/reply
    if (R.aid) {
        for (var pn = 1; pn <= 3; pn++) {
            try {
                var cr = await fetch('https://api.bilibili.com/x/v2/reply?type=1&oid=' + R.aid + '&pn=' + pn + '&ps=20&sort=1');
                var cd = await cr.json();
                if (cd.code !== 0) break;
                var replies = (cd.data && cd.data.replies) || [];
                if (!replies.length) break;
                for (var ri = 0; ri < replies.length; ri++) {
                    var r = replies[ri];
                    var msg = (r.content && r.content.message) ? r.content.message.trim() : '';
                    if (msg) R.comments.push({uname: (r.member||{}).uname||'', message: msg, like: r.like||0});
                    var subs = r.replies || [];
                    for (var si = 0; si < subs.length; si++) {
                        var smsg = (subs[si].content && subs[si].content.message) ? subs[si].content.message.trim() : '';
                        if (smsg) R.comments.push({uname: (subs[si].member||{}).uname||'', message: smsg, is_reply: true});
                    }
                }
            } catch(e) { break; }
        }
    }

    // Danmaku via protobuf extraction
    if (R.cid) {
        try {
            var dr = await fetch('https://api.bilibili.com/x/v2/dm/web/view?oid=' + R.cid + '&type=1');
            var buf = await dr.arrayBuffer();
            var bytes = new Uint8Array(buf);
            var text = new TextDecoder('utf-8').decode(bytes);
            var segs = [], cur = '';
            for (var i = 0; i < text.length; i++) {
                var cp = text.codePointAt(i);
                if (cp > 0x4E00 && cp < 0x9FFF || cp > 0x3000 && cp < 0x303F || cp >= 0x20 && cp <= 0x7E) {
                    cur += text[i];
                } else {
                    if (cur.length >= 2 && cur.length < 120 && /[一-鿿]/.test(cur) && cur[0] != '{' && cur.indexOf('http') != 0) {
                        // Filter out system messages and UI labels
                        if (cur.indexOf('开启后') < 0 && cur.indexOf('全站视频') < 0 && cur.indexOf('弹幕') < 0 && !/^\\d/.test(cur)) {
                            segs.push(cur.trim());
                        }
                    }
                    cur = '';
                }
            }
            R.danmaku = segs.slice(0, 200);
        } catch(e) {}
    }

    R.cc = R.comments.length;
    R.dc = R.danmaku.length;
    R.comments = R.comments.slice(0, 150);
    return JSON.stringify(R);
})()"""

# ── Run ────────────────────────────────────────────────────────────────

n = min(MAX, len(queue))
harvested = 0
for i in range(n):
    bv = queue[i]
    print(f"[{i+1}/{n}] {bv}...", end=" ", flush=True)
    try:
        raw = js(JS.replace("ARG_BV", bv))
        if raw:
            d = json.loads(raw)
            title = d.get("title", "?")[:45]
            cc, dc = d.get("cc", 0), d.get("dc", 0)
            print(f"\"{title}\" -> {cc}c + {dc}d")
            for c in d.get("comments", []):
                ALL_C.append(dict(bvid=bv, title=d.get("title", ""), **c))
            ALL_D.extend(d.get("danmaku", []))
            harvested += 1
        else:
            print("no response")
    except Exception as e:
        print(f"ERR: {e}")
    time.sleep(DELAY)

# ── Save ───────────────────────────────────────────────────────────────

with open(OUT, "w", encoding="utf-8") as f:
    json.dump({
        "harvested_at": "2026-06-25",
        "method": "/x/v2/reply + protobuf danmaku, 3s delay, sequential",
        "videos_harvested": harvested,
        "total_comments": len(ALL_C),
        "total_danmaku": len(ALL_D),
        "comments": ALL_C,
        "danmaku": ALL_D,
    }, f, ensure_ascii=False, indent=2)
print(f"\nDONE: {harvested}v -> {len(ALL_C)}c + {len(ALL_D)}d -> {OUT}")
