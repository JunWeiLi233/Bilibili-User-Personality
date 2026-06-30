"""
CDP harvester — run via: browser-harness -c "exec(open(r'D:/Bilibili_User_Personality/.claude/harvest_corpus_run.py').read())"
"""
import json, time, sys
from urllib.request import urlopen, Request
from urllib.parse import quote as url_quote
from pathlib import Path

TARGET = 100
DELAY = 2.5
COMMENT_PAGES = 3
OUT_DIR = Path("D:/Bilibili_User_Personality/.claude/corpus_harvest")
OUT_DIR.mkdir(parents=True, exist_ok=True)
CKPT_PATH = OUT_DIR / "checkpoint.json"
COMMENTS_PATH = OUT_DIR / "corpus_comments.json"
DANMAKU_PATH = OUT_DIR / "corpus_danmaku.json"
SEEN_PATH = OUT_DIR / "seen_bvids.json"

def load(p, default=None):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def save(p, d):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)

state = load(CKPT_PATH, {"done": [], "queue": [], "tc": 0, "td": 0})
comments = load(COMMENTS_PATH, [])
danmaku = load(DANMAKU_PATH, [])
seen_bvids = load(SEEN_PATH, [])
seenset = set(state.get("done", []) + seen_bvids)
done = set(state.get("done", []))

# --- Discovery ---
queue = [b for b in state.get("queue", []) if b not in done]
if not queue or len(done) >= TARGET:
    print("Discovering videos...")
    # Popular page
    for pn in range(1, 6):
        try:
            req = Request(
                f"https://api.bilibili.com/x/web-interface/popular?pn={pn}&ps=50",
                headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"},
            )
            with urlopen(req, timeout=15) as r:
                d = json.loads(r.read().decode("utf-8", errors="replace"))
            for v in d.get("data", {}).get("list", []) or []:
                bv = v.get("bvid", "")
                if bv and bv not in seenset:
                    queue.append(bv)
                    seenset.add(bv)
        except Exception as e:
            print(f"  popular pn={pn}: {e}")

    # Browser search for high-controversy topics
    search_queries = [
        "评论区 对线",
        "时政 争议",
        "游戏 吵架",
        "科技 争论",
        "社会 热点",
    ]
    for q in search_queries:
        try:
            smart_open(f"https://search.bilibili.com/video?keyword={url_quote(q)}&order=click")
            wait(2.0)
            bvs_raw = js("""
(function(){
    var l = document.querySelectorAll('a[href*="/video/BV"]');
    var s = new Set(), r = [];
    for (var i = 0; i < l.length && r.length < 10; i++) {
        var m = l[i].href.match(/BV[A-Za-z0-9]+/);
        if (!m || s.has(m[0])) continue;
        s.add(m[0]);
        r.push(m[0]);
    }
    return r;
})()
""")
            for b in (bvs_raw or []):
                if b and b not in seenset:
                    queue.append(b)
                    seenset.add(b)
        except Exception as e:
            print(f"  search '{q}': {e}")

    queue = [b for b in queue if b not in done]
    print(f"Discovered {len(queue)} new videos")

remaining = max(0, TARGET - len(done))
queue = queue[:remaining]
print(f"Queue: {len(queue)}, Done: {len(done)}, Target: {TARGET}")

# --- JS harvest template ---
JS = r"""(async function() {
    var bv = "ARG_BV";
    var R = {bv: bv, title: '', aid: 0, cid: 0, comments: [], danmaku: []};
    try {
        var ir = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bv);
        var id = await ir.json();
        if (!id.data) return JSON.stringify(R);
        R.title = (id.data.title || '').substring(0, 80);
        R.aid = id.data.aid;
        R.cid = id.data.cid || (id.data.pages && id.data.pages[0] && id.data.pages[0].cid) || 0;
    } catch(e) { return JSON.stringify(R); }
    if (R.aid) {
        for (var pn = 1; pn <= CP; pn++) {
            try {
                var cr = await fetch('https://api.bilibili.com/x/v2/reply?type=1&oid=' + R.aid + '&pn=' + pn + '&ps=20&sort=1');
                var cd = await cr.json();
                if (cd.code !== 0) break;
                var replies = (cd.data && cd.data.replies) || [];
                if (!replies.length) break;
                for (var ri = 0; ri < replies.length; ri++) {
                    var r = replies[ri];
                    var msg = (r.content && r.content.message) ? r.content.message.trim() : '';
                    if (msg) R.comments.push({uname:(r.member||{}).uname||'',mid:String(r.mid||(r.member||{}).mid||''),message:msg,like:r.like||0,ctime:r.ctime||0,rpid:String(r.rpid||'')});
                    var subs = r.replies || [];
                    for (var si = 0; si < subs.length; si++) {
                        var smsg = (subs[si].content && subs[si].content.message) ? subs[si].content.message.trim() : '';
                        if (smsg) R.comments.push({uname:(subs[si].member||{}).uname||'',mid:String(subs[si].mid||(subs[si].member||{}).mid||''),message:smsg,is_reply:true,rpid:String(subs[si].rpid||'')});
                    }
                }
            } catch(e) { break; }
        }
    }
    if (R.cid) {
        try {
            var dr = await fetch('https://api.bilibili.com/x/v2/dm/web/view?oid=' + R.cid + '&type=1');
            var buf = await dr.arrayBuffer();
            var bytes = new Uint8Array(buf);
            var text = new TextDecoder('utf-8').decode(bytes);
            var cur = '', segs = [];
            for (var i = 0; i < text.length; i++) {
                var cp = text.codePointAt(i);
                if ((cp > 0x4E00 && cp < 0x9FFF) || (cp > 0x3000 && cp < 0x303F) || (cp >= 0xFF00 && cp <= 0xFFEF) || (cp >= 0x20 && cp <= 0x7E)) { cur += text[i]; }
                else {
                    if (cur.length >= 2 && cur.length < 120 && /[一-鿿]/.test(cur) && cur[0] != '{' && cur.indexOf('http') != 0) {
                        if (cur.indexOf('开启后') < 0 && cur.indexOf('全站视频') < 0 && cur.indexOf('弹幕') < 0 && !/^\d/.test(cur)) segs.push(cur.trim());
                    }
                    cur = '';
                }
            }
            R.danmaku = segs.slice(0, 200);
        } catch(e) {}
    }
    R.cc = R.comments.length; R.dc = R.danmaku.length;
    R.comments = R.comments.slice(0, 200);
    return JSON.stringify(R);
})()""".replace("CP", str(COMMENT_PAGES))

# --- Harvest loop ---
for i, bv in enumerate(queue):
    if bv in done:
        continue
    print(f"[{len(done)+1}/{TARGET}] {bv}...", end=" ", flush=True)
    try:
        raw = js(JS.replace("ARG_BV", bv))
        if raw:
            d = json.loads(raw) if isinstance(raw, str) else raw
            title = (d.get("title") or "?")[:45]
            cc, dc = d.get("cc", 0), d.get("dc", 0)
            print(f"\"{title}\" -> {cc}c + {dc}d")
            for c in d.get("comments", []):
                comments.append(dict(bvid=bv, title=d.get("title", ""), source="cdp_harvest", **c))
            for dm in d.get("danmaku", []):
                danmaku.append(dict(bvid=bv, title=d.get("title", ""), danmaku=dm))
            done.add(bv)
            state["done"] = sorted(done)
            state["queue"] = [b for b in queue if b not in done]
            state["tc"] = len(comments)
            state["td"] = len(danmaku)
            save(CKPT_PATH, state)
            save(COMMENTS_PATH, comments)
            save(DANMAKU_PATH, danmaku)
            save(SEEN_PATH, sorted(seenset))
        else:
            print("no response")
    except Exception as e:
        print(f"ERR: {e}")
    if len(done) >= TARGET:
        break
    wait(DELAY)

print(f"\nDONE: {len(done)} videos")
print(f"  Comments: {len(comments)}")
print(f"  Danmaku: {len(danmaku)}")
print(f"  Output: {COMMENTS_PATH}, {DANMAKU_PATH}")
