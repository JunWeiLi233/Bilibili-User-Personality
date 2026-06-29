"""
Bilibili comment + danmaku CDP harvester.
Uses browser-harness to run JS in browser context (real cookies/session).
Checkpoints after each video so interruption loses zero work.

Usage:
  browser-harness -c '
import sys; sys.path.insert(0, r"D:/Bilibili_User_Personality/.claude")
from harvest_corpus import run; run()
'
"""

import json, time, os, sys
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.parse import quote as url_quote

OUT_DIR = Path("D:/Bilibili_User_Personality/.claude/corpus_harvest")
CHECKPOINT = OUT_DIR / "checkpoint.json"
CORPUS_COMMENTS = OUT_DIR / "corpus_comments.json"
CORPUS_DANMAKU = OUT_DIR / "corpus_danmaku.json"
SEEN_BVIDS = OUT_DIR / "seen_bvids.json"

TARGET_VIDEOS = 100
DELAY = 2.5  # seconds between videos
COMMENT_PAGES = 3
DANMAKU_LIMIT = 200

# ── JS template: fetch comments + danmaku for one video ──────────────────

FETCH_JS = r"""(async function() {
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

    // Comments via /x/v2/reply (page-based, works without WBI signing)
    if (R.aid) {
        for (var pn = 1; pn <= ARG_CP; pn++) {
            try {
                var cr = await fetch('https://api.bilibili.com/x/v2/reply?type=1&oid=' + R.aid + '&pn=' + pn + '&ps=20&sort=1');
                var cd = await cr.json();
                if (cd.code !== 0) break;
                var replies = (cd.data && cd.data.replies) || [];
                if (!replies.length) break;
                for (var ri = 0; ri < replies.length; ri++) {
                    var r = replies[ri];
                    var msg = (r.content && r.content.message) ? r.content.message.trim() : '';
                    if (msg) R.comments.push({
                        uname: (r.member||{}).uname||'',
                        mid: String(r.mid || (r.member||{}).mid || ''),
                        message: msg,
                        like: r.like||0,
                        ctime: r.ctime||0,
                        rpid: String(r.rpid||'')
                    });
                    // Sub-replies
                    var subs = r.replies || [];
                    for (var si = 0; si < subs.length; si++) {
                        var smsg = (subs[si].content && subs[si].content.message) ? subs[si].content.message.trim() : '';
                        if (smsg) R.comments.push({
                            uname: (subs[si].member||{}).uname||'',
                            mid: String(subs[si].mid || (subs[si].member||{}).mid || ''),
                            message: smsg,
                            is_reply: true,
                            rpid: String(subs[si].rpid||'')
                        });
                    }
                }
            } catch(e) { break; }
        }
    }

    // Danmaku via protobuf (/x/v2/dm/web/view)
    if (R.cid) {
        try {
            var dr = await fetch('https://api.bilibili.com/x/v2/dm/web/view?oid=' + R.cid + '&type=1');
            var buf = await dr.arrayBuffer();
            var bytes = new Uint8Array(buf);
            var text = new TextDecoder('utf-8').decode(bytes);
            var cur = '';
            var segs = [];
            for (var i = 0; i < text.length; i++) {
                var cp = text.codePointAt(i);
                var isCJK = (cp > 0x4E00 && cp < 0x9FFF) || (cp > 0x3000 && cp < 0x303F) || (cp >= 0xFF00 && cp <= 0xFFEF);
                var isPrintable = cp >= 0x20 && cp <= 0x7E;
                if (isCJK || isPrintable) {
                    cur += text[i];
                } else {
                    if (cur.length >= 2 && cur.length < 120 && /[一-鿿]/.test(cur) && cur[0] != '{' && cur.indexOf('http') != 0) {
                        if (cur.indexOf('开启后') < 0 && cur.indexOf('全站视频') < 0 && cur.indexOf('弹幕') < 0 && !/^\\d/.test(cur)) {
                            segs.push(cur.trim());
                        }
                    }
                    cur = '';
                }
            }
            R.danmaku = segs.slice(0, ARG_DL);
        } catch(e) {}
    }

    R.cc = R.comments.length;
    R.dc = R.danmaku.length;
    R.comments = R.comments.slice(0, 200);
    return JSON.stringify(R);
})()"""


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def discover_videos(seen_bvids, *, smart_open_fn, js_fn, wait_fn):
    """Discover videos from multiple sources. Returns list of new BVs."""
    new_bvs = []
    seen = set(seen_bvids or [])

    # Source 1: Popular page (pages 1-5)
    print("Discovering from popular page...")
    for pn in range(1, 6):
        try:
            req = Request(
                f"https://api.bilibili.com/x/web-interface/popular?pn={pn}&ps=50",
                headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"},
            )
            with urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="replace"))
            for v in (data.get("data", {}).get("list", []) or []):
                bv = v.get("bvid", "")
                if bv and bv not in seen:
                    new_bvs.append(bv)
                    seen.add(bv)
        except Exception as e:
            print(f"  popular pn={pn}: {e}")

    # Source 2: Browser search (high-controversy topics to maximize term coverage)
    queries = [
        "评论区 对线",
        "时政 争议",
        "游戏 吵架",
        "科技 争论",
        "社会 热点",
        "历史 辩论",
        "哲学 讨论",
    ]
    print("Discovering from search...")
    for q in queries:
        try:
            encoded = url_quote(q)
            smart_open_fn(f"https://search.bilibili.com/video?keyword={encoded}&order=click")
            wait_fn(2.0)
            bvs = js_fn("""
            (function(){
                var l=document.querySelectorAll('a[href*="/video/BV"]');
                var s=new Set(),r=[];
                for(var i=0;i<l.length&&r.length<10;i++){
                    var m=l[i].href.match(/BV[A-Za-z0-9]+/);
                    if(!m||s.has(m[0]))continue;
                    s.add(m[0]);r.push(m[0]);
                }
                return r;
            })()
            """)
            for b in (bvs or []):
                if b and b not in seen:
                    new_bvs.append(b)
                    seen.add(b)
        except Exception as e:
            print(f"  search '{q}': {e}")

    print(f"Discovered {len(new_bvs)} new videos")
    return new_bvs


def run(*, smart_open_fn=None, js_fn=None, wait_fn=None):
    # Use pre-imports if provided, else fall back to globals (browser-harness exec scope)
    _smart_open = smart_open_fn or globals().get("smart_open")
    _js = js_fn or globals().get("js")
    _wait = wait_fn or globals().get("wait") or time.sleep

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load state
    state = load_json(CHECKPOINT, {"done": [], "queue": [], "total_comments": 0, "total_danmaku": 0})
    all_comments = load_json(CORPUS_COMMENTS, [])
    all_danmaku = load_json(CORPUS_DANMAKU, [])
    seen_bvids = load_json(SEEN_BVIDS, [])

    # Discover if queue is empty
    queue = state.get("queue", [])
    done = set(state.get("done", []))

    if not queue or len(done) >= TARGET_VIDEOS:
        discovered = discover_videos(seen_bvids, smart_open_fn=_smart_open, js_fn=_js, wait_fn=_wait)
        queue = [b for b in discovered if b not in done]
        state["queue"] = queue

    # Filter already-done
    queue = [b for b in queue if b not in done]
    remaining = max(0, TARGET_VIDEOS - len(done))
    queue = queue[:remaining]

    if not queue:
        print(f"All done! {len(done)} videos harvested.")
        print(f"  Comments: {len(all_comments)}")
        print(f"  Danmaku: {len(all_danmaku)}")
        return

    print(f"Queue: {len(queue)} videos, {len(done)} already done, target: {TARGET_VIDEOS}")

    # Harvest
    js_template = FETCH_JS.replace("ARG_CP", str(COMMENT_PAGES)).replace("ARG_DL", str(DANMAKU_LIMIT))

    for i, bv in enumerate(queue):
        if bv in done:
            continue
        print(f"[{len(done)+1}/{TARGET_VIDEOS}] {bv}...", end=" ", flush=True)

        try:
            raw = _js(js_template.replace("ARG_BV", bv))
            if raw:
                d = json.loads(raw) if isinstance(raw, str) else raw
                title = (d.get("title") or "?")[:45]
                cc = d.get("cc", 0)
                dc = d.get("dc", 0)
                print(f'"{title}" -> {cc}c + {dc}d')

                # Tag with bvid + title
                for c in d.get("comments", []):
                    all_comments.append(dict(
                        bvid=bv,
                        title=d.get("title", ""),
                        source="cdp_harvest",
                        **c,
                    ))
                for dm in d.get("danmaku", []):
                    all_danmaku.append(dict(
                        bvid=bv,
                        title=d.get("title", ""),
                        danmaku=dm,
                    ))

                done.add(bv)

                # Checkpoint after every video
                state["done"] = sorted(done)
                state["queue"] = [b for b in queue if b not in done]
                state["total_comments"] = len(all_comments)
                state["total_danmaku"] = len(all_danmaku)
                save_json(CHECKPOINT, state)
                save_json(CORPUS_COMMENTS, all_comments)
                save_json(CORPUS_DANMAKU, all_danmaku)
                save_json(SEEN_BVIDS, sorted(set(seen_bvids + list(done))))
            else:
                print("no response")
        except Exception as e:
            print(f"ERR: {e}")

        if len(done) >= TARGET_VIDEOS:
            break
        _wait(DELAY)

    print(f"\nDONE: {len(done)} videos")
    print(f"  Comments: {len(all_comments)}")
    print(f"  Danmaku: {len(all_danmaku)}")
    print(f"  Output: {CORPUS_COMMENTS}, {CORPUS_DANMAKU}")


# Allow import (for modular use) or direct execution
if __name__ == "__main__":
    run()
