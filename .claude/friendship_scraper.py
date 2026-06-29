"""
Bilibili Friendship Web Scraper

Crawls the Bilibili comment graph from a seed space URL:
Seed user → their videos → commenters → their subscriptions/followers → their videos → ...

Run via:
    PYTHONUTF8=1 browser-harness -c "exec(open(r'D:/Bilibili_User_Personality/.claude/friendship_scraper.py').read())"

Or for a specific seed URL:
    FRIENDSHIP_SEED_URL="https://space.bilibili.com/12345678" PYTHONUTF8=1 browser-harness -c "exec(open(r'D:/Bilibili_User_Personality/.claude/friendship_scraper.py').read())"

If FRIENDSHIP_SEED_URL is not set, defaults to a known seed UID from the existing harvest.
"""

import json, time, os, re, sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from collections import defaultdict

# ── Configuration ──────────────────────────────────────────────────────────────

MAX_FOLLOWER_THRESHOLD = int(os.environ.get("FRIENDSHIP_MAX_FOLLOWER", "50000"))
MAX_DEPTH = int(os.environ.get("FRIENDSHIP_MAX_DEPTH", "2"))
MAX_USERS_PER_LEVEL = int(os.environ.get("FRIENDSHIP_USERS_PER_LEVEL", "20"))
MAX_VIDEOS_PER_USER = int(os.environ.get("FRIENDSHIP_VIDEOS_PER_USER", "5"))
COMMENT_PAGES_PER_VIDEO = int(os.environ.get("FRIENDSHIP_COMMENT_PAGES", "2"))
DELAY_BETWEEN_CALLS = float(os.environ.get("FRIENDSHIP_API_DELAY", "2.5"))
DELAY_BETWEEN_USERS = float(os.environ.get("FRIENDSHIP_USER_DELAY", "5.0"))
COOLDOWN_ON_RATELIMIT = int(os.environ.get("FRIENDSHIP_COOLDOWN", "60"))
MAX_SUBSCRIPTIONS_PER_USER = int(os.environ.get("FRIENDSHIP_MAX_SUBS", "50"))
MAX_FOLLOWERS_PER_USER = int(os.environ.get("FRIENDSHIP_MAX_FOLLOWERS", "50"))
MAX_CONSECUTIVE_ERRORS = int(os.environ.get("FRIENDSHIP_MAX_ERRORS", "3"))
MAX_USERS_PER_RUN = int(os.environ.get("FRIENDSHIP_MAX_USERS", "20"))

OUTPUT_DIR = Path(os.environ.get("FRIENDSHIP_OUTPUT_DIR",
    "D:/Bilibili_User_Personality/.claude/friendship_harvest"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Helpers ────────────────────────────────────────────────────────────────────

def load_json(path, default=None):
    """Load JSON from file, returning default on any failure."""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def save_json(path, data):
    """Save data as pretty JSON."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def extract_uid_from_url(url):
    """Extract numeric UID from a Bilibili space URL."""
    u = urlparse(url)
    # https://space.bilibili.com/<uid>[/...]
    if "space.bilibili.com" in u.netloc:
        parts = u.path.strip("/").split("/")
        if parts and parts[0].isdigit():
            return parts[0]
    # https://space.bilibili.com/<uid>
    m = re.search(r'space\.bilibili\.com/(\d+)', url)
    if m:
        return m.group(1)
    # Already a numeric UID
    if url.strip().isdigit():
        return url.strip()
    raise ValueError(f"Cannot extract UID from: {url}")

def is_rate_limited(data):
    """Check if API response indicates rate limiting."""
    if isinstance(data, dict):
        code = data.get("code")
        if code in (-799, -412):
            return True
    return False

def is_not_logged_in(data):
    """Check if response indicates not authenticated."""
    if isinstance(data, dict):
        code = data.get("code")
        if code == -101:
            return True
    return False

def check_consecutive_errors(errors):
    """Check if we've hit too many consecutive errors."""
    return errors >= MAX_CONSECUTIVE_ERRORS

def is_html_response(raw):
    """Check if the response is HTML (blocked endpoint) instead of JSON."""
    if isinstance(raw, str) and raw.strip().startswith("<!DOCTYPE html"):
        return True
    if isinstance(raw, str) and raw.strip().startswith("<html"):
        return True
    return False

def extract_cjk_danmaku(text_bytes):
    """Extract danmaku text segments from protobuf binary using CJK scanning.

    Same approach as parseDanmakuProtobuf in bilibiliCrawler.js — decode as
    UTF-8, scan for CJK text runs, filter for real content.
    """
    text = text_bytes.decode("utf-8", errors="replace") if isinstance(text_bytes, bytes) else text_bytes
    items = []
    current = ""
    for i in range(len(text)):
        cp = ord(text[i])
        is_cjk = (
            (0x4E00 <= cp <= 0x9FFF) or
            (0x3400 <= cp <= 0x4DBF) or
            (0x3000 <= cp <= 0x303F) or
            (0xFF00 <= cp <= 0xFFEF)
        )
        is_printable = 0x20 <= cp <= 0x7E
        if is_cjk or is_printable:
            current += text[i]
        else:
            if (len(current) >= 2 and len(current) < 120
                    and re.search(r'[一-鿿]', current)
                    and not current.startswith('{')
                    and not current.startswith('http')):
                if not re.search(r'开启后|全站视频|弹幕|^\d', current):
                    items.append(current.strip())
            current = ""
    if (len(current) >= 2 and len(current) < 120
            and re.search(r'[一-鿿]', current)
            and not current.startswith('{')
            and not current.startswith('http')):
        if not re.search(r'开启后|全站视频|弹幕|^\d', current):
            items.append(current.strip())
    return items

# ── CDP / Browser JS helpers ───────────────────────────────────────────────────

def js_fetch(endpoint, referer=None):
    """Execute a fetch() call in the browser context via js().

    Returns parsed JSON dict, or None on failure.
    Falls back to urlopen if js() unavailable.
    """
    ref = referer or "https://www.bilibili.com/"
    full_url = endpoint if endpoint.startswith("http") else f"https://api.bilibili.com{endpoint}"

    # Try js() first (CDP browser context — inherits cookies)
    try:
        raw = js(f"""
(async function() {{
    try {{
        var r = await fetch('{full_url}', {{
            headers: {{ "Referer": "{ref}", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }}
        }});
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('json') >= 0) {{
            return JSON.stringify(await r.json());
        }} else if (ct.indexOf('protobuf') >= 0 || ct.indexOf('octet-stream') >= 0) {{
            var buf = await r.arrayBuffer();
            var bytes = new Uint8Array(buf);
            var txt = '';
            for (var bi = 0; bi < bytes.length; bi++) {{
                txt += String.fromCharCode(bytes[bi]);
            }}
            return JSON.stringify({{_protobuf: true, _data: txt}});
        }} else {{
            var txt = await r.text();
            if (txt.length < 200 && txt.indexOf('{{') >= 0) {{
                return JSON.stringify({{_text: true, _data: txt}});
            }}
            return JSON.stringify({{_raw_text: true, _data: txt.substring(0, 500)}});
        }}
    }} catch(e) {{
        return JSON.stringify({{_error: e.message}});
    }}
}})()
""")
        if raw:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(parsed, dict) and parsed.get("_error"):
                return None
            # If CDP browser isn't logged into Bilibili (code -101), fall back
            # to direct HTTP with BILIBILI_COOKIE env var for authentication.
            if is_not_logged_in(parsed):
                fallback = _http_fetch(endpoint, referer)
                if fallback is not None:
                    return fallback
            return parsed
        return None
    except Exception as e:
        return _http_fetch(endpoint, referer)


def _http_fetch(endpoint, referer=None):
    """Direct HTTP fetch with BILIBILI_COOKIE fallback (no CDP browser needed)."""
    ref = referer or "https://www.bilibili.com/"
    full_url = endpoint if endpoint.startswith("http") else f"https://api.bilibili.com{endpoint}"
    try:
        from urllib.request import urlopen, Request
        cookie_val = os.environ.get("BILIBILI_COOKIE", "")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": ref,
        }
        if cookie_val:
            headers["Cookie"] = cookie_val
        req = Request(full_url, headers=headers)
        with urlopen(req, timeout=15) as r:
            ct = r.headers.get("Content-Type", "")
            if "protobuf" in ct or "octet-stream" in ct:
                return {"_protobuf": True, "_data": r.read().decode("latin-1")}
            body = r.read().decode("utf-8", errors="replace")
            if body.strip().startswith("<"):
                return None
            return json.loads(body)
    except Exception:
        return None

def js_fetch_buffer(endpoint, referer=None):
    """Fetch binary data (protobuf) from CDP browser context."""
    ref = referer or "https://www.bilibili.com/"
    full_url = endpoint if endpoint.startswith("http") else f"https://api.bilibili.com{endpoint}"

    try:
        raw = js(f"""
(async function() {{
    try {{
        var r = await fetch('{full_url}', {{
            headers: {{ "Referer": "{ref}", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }}
        }});
        var buf = await r.arrayBuffer();
        var bytes = new Uint8Array(buf);
        var txt = '';
        for (var bi = 0; bi < bytes.length; bi++) {{
            txt += String.fromCharCode(bytes[bi]);
        }}
        return txt;
    }} catch(e) {{
        return '';
    }}
}})()
""")
        if raw:
            # Convert latin-1 encoded string back to bytes for protobuf scanning
            return raw.encode("latin-1")
        return b""
    except:
        # Fallback to urllib
        try:
            from urllib.request import urlopen, Request
            cookie_val = os.environ.get("BILIBILI_COOKIE", "")
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": ref,
            }
            if cookie_val:
                headers["Cookie"] = cookie_val
            req = Request(full_url, headers=headers)
            with urlopen(req, timeout=15) as r:
                return r.read()
        except:
            return b""

# ── Bilibili API Functions ─────────────────────────────────────────────────────

CARD_CACHE = {}

def get_user_card(uid):
    """Fetch user card info using /x/web-interface/card.

    Returns dict with mid, name, sign, follower_count or None on failure.
    Results are cached to avoid redundant API calls.
    """
    if uid in CARD_CACHE:
        return CARD_CACHE[uid]

    data = js_fetch(f"/x/web-interface/card?mid={uid}&photo=false",
                     f"https://space.bilibili.com/{uid}")
    if not data or data.get("code") != 0:
        card_data = data.get("data") if data else None
        if not card_data:
            CARD_CACHE[uid] = None
            return None

    card = data.get("data", {}).get("card", {})
    result = {
        "mid": str(card.get("mid", uid)),
        "name": card.get("name", f"UID {uid}"),
        "sign": card.get("sign", ""),
        "follower_count": int(card.get("fans", 0)),
        "following_count": int(card.get("attention", 0)),
        "video_count": int(card.get("videos", 0)),
    }
    CARD_CACHE[uid] = result
    return result

def get_user_videos(uid, max_videos=5):
    """Fetch user's published videos via /x/space/arc/search.

    Returns list of dicts with bvid, aid, title, cid.
    """
    base_url = f"/x/space/arc/search?mid={uid}&pn=1&ps=50&order=pubdate"
    data = js_fetch(base_url, f"https://space.bilibili.com/{uid}")

    videos = []
    if not data or data.get("code") != 0:
        return videos

    vlist = data.get("data", {}).get("list", {}).get("vlist", [])
    if not vlist:
        return videos

    for item in vlist[:max_videos]:
        videos.append({
            "bvid": item.get("bvid", ""),
            "aid": str(item.get("aid", 0)),
            "title": item.get("title", ""),
            "comment": int(item.get("comment", 0)),
            "play": int(item.get("play", 0)),
        })
    return videos

def get_video_info(bvid):
    """Fetch video info via /x/web-interface/view to get aid and cid."""
    data = js_fetch(f"/x/web-interface/view?bvid={bvid}",
                     "https://www.bilibili.com/video/{bvid}/")
    if not data or data.get("code") != 0:
        return None

    d = data.get("data", {})
    aid = d.get("aid", 0)
    cid = d.get("cid", 0)

    # If cid is 0, check pages
    if not cid:
        pages = d.get("pages", [])
        if pages:
            cid = pages[0].get("cid", 0)

    return {
        "aid": str(aid),
        "cid": str(cid),
        "title": (d.get("title") or "")[:80],
        "owner_mid": str(d.get("owner", {}).get("mid", "")),
        "owner_name": d.get("owner", {}).get("name", ""),
        "stat": {
            "reply": d.get("stat", {}).get("reply", 0),
            "danmaku": d.get("stat", {}).get("danmaku", 0),
        }
    }

def scrape_video_comments(bvid, aid, pages=2):
    """Scrape comments from a video using /x/v2/reply.

    Fetches up to `pages` pages of comments, including sub-replies.
    Returns list of comment dicts.
    """
    comments = []
    if not aid or aid == "0":
        return comments

    for pn in range(1, pages + 1):
        try:
            data = js_fetch(
                f"/x/v2/reply?type=1&oid={aid}&pn={pn}&ps=20&sort=1",
                f"https://www.bilibili.com/video/{bvid}/"
            )
            if not data or data.get("code") != 0:
                break

            if is_rate_limited(data):
                wait(get_cooldown_remaining())
                break

            replies = data.get("data", {}).get("replies", [])
            if not replies:
                break

            for r in replies:
                member = r.get("member", {}) or {}
                content = r.get("content", {}) or {}
                mid = str(r.get("mid", member.get("mid", "")))
                uname = member.get("uname", "")
                message = (content.get("message") or "").strip()

                if message:
                    comments.append({
                        "uname": uname,
                        "mid": mid,
                        "message": message,
                        "like": r.get("like", 0),
                        "ctime": r.get("ctime", 0),
                        "rpid": str(r.get("rpid", "")),
                        "is_reply": False,
                    })

                # Sub-replies
                sub_replies = r.get("replies", [])
                for sr in sub_replies:
                    sr_member = sr.get("member", {}) or {}
                    sr_content = sr.get("content", {}) or {}
                    sr_mid = str(sr.get("mid", sr_member.get("mid", "")))
                    sr_uname = sr_member.get("uname", "")
                    sr_msg = (sr_content.get("message") or "").strip()

                    if sr_msg:
                        comments.append({
                            "uname": sr_uname,
                            "mid": sr_mid,
                            "message": sr_msg,
                            "like": sr.get("like", 0),
                            "ctime": sr.get("ctime", 0),
                            "rpid": str(sr.get("rpid", "")),
                            "is_reply": True,
                        })

            if len(replies) < 20:
                break

            wait(DELAY_BETWEEN_CALLS)

        except Exception as e:
            break

    return comments

def scrape_video_danmaku(cid):
    """Scrape danmaku from a video using /x/v2/dm/web/view (protobuf).

    Returns list of danmaku text strings.
    """
    danmaku = []
    if not cid or cid == "0":
        return danmaku

    try:
        raw_bytes = js_fetch_buffer(f"/x/v2/dm/web/view?oid={cid}&type=1")
        if raw_bytes and len(raw_bytes) > 10:
            items = extract_cjk_danmaku(raw_bytes)
            danmaku = items[:200]  # Cap at 200
    except Exception:
        pass

    return danmaku

def get_user_subscriptions(uid, max_users=50):
    """Fetch who a user follows via /x/relation/followings.

    Returns list of dicts with mid, uname.
    Requires auth — returns empty list on -101.
    """
    items = []
    data = js_fetch(f"/x/relation/followings?vmid={uid}&pn=1&ps={max_users}",
                     f"https://space.bilibili.com/{uid}")

    if not data:
        return items

    if is_not_logged_in(data):
        return items  # Auth required, skip silently

    if data.get("code") != 0:
        return items

    follow_list = data.get("data", {}).get("list", [])
    for f in follow_list:
        items.append({
            "mid": str(f.get("mid", "")),
            "uname": f.get("uname", ""),
        })

    return items

def get_user_followers(uid, max_users=50):
    """Fetch who follows a user via /x/relation/followers.

    Returns list of dicts with mid, uname.
    Requires auth — returns empty list on -101.
    """
    items = []
    data = js_fetch(f"/x/relation/followers?vmid={uid}&pn=1&ps={max_users}",
                     f"https://space.bilibili.com/{uid}")

    if not data:
        return items

    if is_not_logged_in(data):
        return items  # Auth required, skip silently

    if data.get("code") != 0:
        return items

    follow_list = data.get("data", {}).get("list", [])
    for f in follow_list:
        items.append({
            "mid": str(f.get("mid", "")),
            "uname": f.get("uname", ""),
        })

    return items

def get_keyword_families():
    """Load keyword families from dictionary for scoring."""
    # Try multiple dictionary paths
    dic_dir = Path("D:/Bilibili_User_Personality/server/data/deepseekKeywordDictionary.entries")
    families = set()
    if dic_dir.exists():
        for fpath in sorted(dic_dir.glob("*.json")):
            data = load_json(str(fpath), {})
            entries = data.get("entries", [])
            for e in entries:
                families.add(e.get("term", ""))
    return families

KEYWORD_FAMILIES = None

def score_users(uid_list, context_comments):
    """Score discovered users by engagement signal.

    Factors:
    - Comment frequency in seed context (how many times they commented)
    - Average comment length
    - Keyword dictionary term matches in their comments

    Returns sorted list of [(uid, score)].
    """
    global KEYWORD_FAMILIES
    if KEYWORD_FAMILIES is None:
        KEYWORD_FAMILIES = get_keyword_families()

    # Build per-UID stats from context comments
    uid_stats = defaultdict(lambda: {"count": 0, "total_len": 0, "keyword_hits": 0})

    for c in context_comments:
        mid = c.get("mid", "")
        msg = c.get("message", "")
        if mid in uid_list:
            uid_stats[mid]["count"] += 1
            uid_stats[mid]["total_len"] += len(msg)
            # Check keyword matches
            for kw in KEYWORD_FAMILIES:
                if kw and kw in msg:
                    uid_stats[mid]["keyword_hits"] += 1

    scored = []
    for uid in uid_list:
        if uid not in uid_stats:
            scored.append((uid, 0.0))
            continue

        s = uid_stats[uid]
        freq_score = min(s["count"] * 3.0, 30.0)
        avg_len = s["total_len"] / max(s["count"], 1)
        len_score = min(avg_len / 20.0, 5.0)
        kw_score = min(s["keyword_hits"] * 2.0, 10.0)

        total = freq_score + len_score + kw_score
        scored.append((uid, total))

    scored.sort(key=lambda x: -x[1])
    return scored

def log_progress(ckpt, uid, level, comments, danmaku, elapsed_min):
    """Print a progress line for the current user."""
    stats = ckpt["stats"]
    print(f"[{stats['users_visited']}/{MAX_USERS_PER_RUN}] "
          f"L{level} uid={uid} "
          f"→ {len(comments)}c + {len(danmaku)}d "
          f"(total: {stats['total_comments']}c + {stats['total_danmaku']}d) "
          f"[{elapsed_min:.0f}min]")

def print_report(ckpt):
    """Print final summary report."""
    s = ckpt["stats"]
    users_detail = f"({s['levels'].get('0',0)} seed, "
    users_detail += f"{s['levels'].get('1',0)} L1, "
    users_detail += f"{s['levels'].get('2',0)} L2)"

    print("\n" + "=" * 60)
    print("  FRIENDSHIP WEB HARVEST — COMPLETE")
    print("=" * 60)
    print(f"  Seed UID:     {ckpt['seed_uid']}")
    print(f"  Users visited: {s['users_visited']} {users_detail}")
    print(f"  Users skipped: {s['users_skipped']} (over follower threshold)")
    print(f"  Users errored: {s['users_errored']}")
    print(f"  Total comments: {s['total_comments']}")
    print(f"  Total danmaku:  {s['total_danmaku']}")
    print(f"  Graph edges:    {s['graph_edges']}")
    print(f"  Elapsed:        {s['elapsed_min']:.0f} min")
    print(f"  Output:         {OUTPUT_DIR / f'output_{ckpt["seed_uid"]}.json'}")
    print("=" * 60)

def get_cooldown_remaining():
    """Check how long to wait when rate limited."""
    return COOLDOWN_ON_RATELIMIT

# ── Checkpoint System ──────────────────────────────────────────────────────────

def init_checkpoint(seed_uid):
    """Initialize or load checkpoint for the given seed UID."""
    ckpt_path = OUTPUT_DIR / f"friendship_ckpt_{seed_uid}.json"
    existing = load_json(str(ckpt_path))
    if existing:
        print(f"Resuming from checkpoint ({ckpt_path.name})")
        return existing

    return {
        "seed_uid": seed_uid,
        "seed_url": "",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "config": {
            "max_follower_threshold": MAX_FOLLOWER_THRESHOLD,
            "max_depth": MAX_DEPTH,
            "max_users_per_level": MAX_USERS_PER_LEVEL,
            "max_videos_per_user": MAX_VIDEOS_PER_USER,
            "comment_pages": COMMENT_PAGES_PER_VIDEO,
        },
        "users": {},
        "queue": [],
        "queue_index": 0,
        "comments": [],
        "danmaku": [],
        "graph_edges": [],
        "stats": {
            "users_visited": 0,
            "users_skipped": 0,
            "users_errored": 0,
            "total_comments": 0,
            "total_danmaku": 0,
            "graph_edges": 0,
            "levels": {},
            "elapsed_min": 0,
        },
    }

def save_checkpoint(ckpt):
    """Save checkpoint to disk."""
    now = time.time()
    frac = f"{now % 1:.3f}"[1:]  # .123
    ckpt["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + frac + "Z"
    ckpt_path = OUTPUT_DIR / f"friendship_ckpt_{ckpt['seed_uid']}.json"
    save_json(str(ckpt_path), ckpt)

def save_final_output(ckpt):
    """Write the final merged output file."""
    output_path = OUTPUT_DIR / f"output_{ckpt['seed_uid']}.json"
    save_json(str(output_path), ckpt)
    print(f"\nFinal output written to {output_path}")

# ── Main Algorithm ─────────────────────────────────────────────────────────────

def friendship_harvest(seed_url):
    """Main BFS-like friendship web harvest loop."""
    seed_uid = extract_uid_from_url(seed_url)
    print(f"\n{'='*60}")
    print(f"  BILIBILI FRIENDSHIP WEB HARVEST")
    print(f"  Seed URL: {seed_url}")
    print(f"  Seed UID: {seed_uid}")
    print(f"  Max depth: {MAX_DEPTH}, Max users/level: {MAX_USERS_PER_LEVEL}")
    print(f"  Max follower threshold: {MAX_FOLLOWER_THRESHOLD:,}")
    print(f"{'='*60}\n")

    # Ensure we're on Bilibili in the browser (for cookies)
    try:
        smart_open("https://space.bilibili.com/")
        wait(2)
        ensure_real_tab()
    except:
        pass

    ckpt = init_checkpoint(seed_uid)
    ckpt["seed_url"] = seed_url

    # Initialize queue from checkpoint or seed
    if not ckpt["queue"]:
        ckpt["queue"] = [[seed_uid, 0, None]]  # [uid, level, discovered_from]
        ckpt["queue_index"] = 0

        # If pre-discovered commenter UIDs were provided, inject them as Level 1
        seed_uids_file = os.environ.get("FRIENDSHIP_SEED_UIDS_FILE", "")
        if seed_uids_file:
            seed_data = load_json(seed_uids_file, {})
            raw_uids = seed_data.get("commenterUids", [])
            if raw_uids:
                print(f"\n  Loading {len(raw_uids)} pre-discovered commenter UIDs from {seed_uids_file}")
                pre_skipped = 0
                pre_injected = 0
                for raw_uid in raw_uids:
                    if raw_uid == seed_uid:
                        continue  # Don't re-crawl the seed
                    # Apply celebrity filter immediately
                    card = get_user_card(raw_uid)
                    if card and card["follower_count"] > MAX_FOLLOWER_THRESHOLD:
                        pre_skipped += 1
                        continue
                    if not card:
                        continue
                    ckpt["queue"].append([raw_uid, 1, seed_uid])
                    pre_injected += 1
                    wait(DELAY_BETWEEN_CALLS)
                print(f"  Pre-filtered: {pre_injected} UIDs queued as Level 1, {pre_skipped} skipped (celebrity)")
        save_checkpoint(ckpt)

    visited = set(ckpt["users"].keys())
    consecutive_errors = 0
    start_time = time.time()

    while ckpt["queue_index"] < len(ckpt["queue"]):
        uid, level, discovered_from = ckpt["queue"][ckpt["queue_index"]]
        ckpt["queue_index"] += 1

        # Already processed?
        if uid in visited:
            continue

        # Level cap check
        if level > MAX_DEPTH:
            continue

        # Users-per-run cap
        if ckpt["stats"]["users_visited"] >= MAX_USERS_PER_RUN:
            print(f"\nReached max users per run ({MAX_USERS_PER_RUN}). "
                  f"Set FRIENDSHIP_MAX_USERS to increase.")
            break

        # ── Step 0: Anti-celebrity check ──
        print(f"\n[L{level}] Checking uid={uid}...", end=" ", flush=True)
        card = get_user_card(uid)

        if card is None:
            print("card fetch failed, skipping")
            consecutive_errors += 1
            ckpt["stats"]["users_errored"] += 1
            save_checkpoint(ckpt)
            if check_consecutive_errors(consecutive_errors):
                print(f"ERROR: {MAX_CONSECUTIVE_ERRORS} consecutive errors. Stopping.")
                break
            continue

        follower_count = card["follower_count"]
        print(f"\"{card['name']}\" fans={follower_count:,}", end="", flush=True)

        if follower_count > MAX_FOLLOWER_THRESHOLD:
            print(f" > {MAX_FOLLOWER_THRESHOLD:,} → SKIPPED (celebrity threshold)")
            ckpt["users"][uid] = {
                "uid": uid,
                "level": level,
                "discovered_from": discovered_from,
                "name": card["name"],
                "follower_count": follower_count,
                "skipped": True,
                "skipped_reason": "celebrity_threshold",
                "completed": False,
            }
            ckpt["stats"]["users_skipped"] += 1
            visited.add(uid)
            save_checkpoint(ckpt)
            consecutive_errors = 0
            continue

        # Mark as visited
        visited.add(uid)
        ckpt["stats"]["users_visited"] += 1
        ckpt["stats"]["levels"][str(level)] = ckpt["stats"]["levels"].get(str(level), 0) + 1

        user_state = {
            "uid": uid,
            "level": level,
            "discovered_from": discovered_from,
            "name": card["name"],
            "follower_count": follower_count,
            "skipped": False,
            "videos_scraped": [],
            "commenter_uids": [],
            "subscription_uids": [],
            "follower_uids": [],
            "comment_count": 0,
            "danmaku_count": 0,
            "completed": False,
            "error": None,
        }
        ckpt["users"][uid] = user_state
        save_checkpoint(ckpt)
        consecutive_errors = 0

        wait(DELAY_BETWEEN_USERS)

        # ── Step 1: Get user's videos ──
        print(f"\n  Getting videos...", end=" ", flush=True)
        videos = get_user_videos(uid, MAX_VIDEOS_PER_USER)
        if not videos:
            print("no videos found")
            user_state["completed"] = True
            save_checkpoint(ckpt)
            continue

        print(f"{len(videos)} videos")

        # ── Step 2: Get video info (aid, cid) for each ──
        video_details = []
        for v in videos:
            bvid = v["bvid"]
            if not bvid:
                continue
            info = get_video_info(bvid)
            wait(DELAY_BETWEEN_CALLS)
            if info:
                v["aid"] = info["aid"]
                v["cid"] = info["cid"]
                v["_title"] = info["title"]
                v["_owner_mid"] = info["owner_mid"]
                v["_owner_name"] = info["owner_name"]
                video_details.append(v)
            else:
                video_details.append(v)

        # ── Step 3: Scrape comments + danmaku ──
        user_comments = []
        user_danmaku = []
        all_commenter_uids = set()

        for v in video_details:
            bvid = v["bvid"]
            aid = v.get("aid", "0")
            cid = v.get("cid", "0")
            title = v.get("_title", bvid)

            print(f"  [{bvid}] \"{title[:35]}\"...", end=" ", flush=True)

            # Comments
            comments = scrape_video_comments(bvid, aid, COMMENT_PAGES_PER_VIDEO)
            wait(DELAY_BETWEEN_CALLS)

            for c in comments:
                c["source_bvid"] = bvid
                c["source_uid"] = uid
                c["source_level"] = level
            user_comments.extend(comments)

            mids = set(c["mid"] for c in comments if c.get("mid"))
            all_commenter_uids.update(mids)

            # Danmaku
            danmaku_texts = scrape_video_danmaku(cid)

            for dm in danmaku_texts:
                user_danmaku.append({
                    "bvid": bvid,
                    "title": title,
                    "danmaku": dm,
                    "source_uid": uid,
                    "source_level": level,
                })

            print(f"{len(comments)}c + {len(danmaku_texts)}d")
            wait(DELAY_BETWEEN_CALLS)

        # ── Step 4: Get subscriptions + followers (Level 0 and Level 1 only) ──
        sub_uids = []
        follower_uids = []

        if level <= 1:
            print(f"  Getting subscriptions...", end=" ", flush=True)
            subs = get_user_subscriptions(uid, MAX_SUBSCRIPTIONS_PER_USER)
            wait(DELAY_BETWEEN_CALLS)
            sub_uids = [s["mid"] for s in subs if s.get("mid")]
            print(f"{len(sub_uids)} followed users")

            print(f"  Getting followers...", end=" ", flush=True)
            followers = get_user_followers(uid, MAX_FOLLOWERS_PER_USER)
            wait(DELAY_BETWEEN_CALLS)
            follower_uids = [f["mid"] for f in followers if f.get("mid")]
            print(f"{len(follower_uids)} followers")

        # ── Step 5: Enqueue discovered users for next level ──
        if level < MAX_DEPTH:
            candidates = set(all_commenter_uids)
            candidates.update(sub_uids)
            candidates.update(follower_uids)
            candidates -= visited  # Remove already-visited

            if candidates:
                scored = score_users(list(candidates), user_comments)
                top_n = scored[:MAX_USERS_PER_LEVEL]

                for new_uid, score in top_n:
                    ckpt["queue"].append([new_uid, level + 1, uid])
                    ckpt["graph_edges"].append({
                        "from_uid": uid,
                        "to_uid": new_uid,
                        "relation_type": "discovered",
                        "score": round(score, 2),
                        "level": level + 1,
                    })

                if len(candidates) > len(top_n):
                    print(f"  Discovered {len(candidates)} users, scoring top {len(top_n)}")
                else:
                    print(f"  Discovered {len(candidates)} users for level {level + 1}")

        # ── Step 6: Update user state ──
        user_state["videos_scraped"] = [v["bvid"] for v in video_details]
        user_state["commenter_uids"] = sorted(all_commenter_uids)
        user_state["subscription_uids"] = sub_uids
        user_state["follower_uids"] = follower_uids
        user_state["comment_count"] = len(user_comments)
        user_state["danmaku_count"] = len(user_danmaku)
        user_state["completed"] = True

        ckpt["comments"].extend(user_comments)
        ckpt["danmaku"].extend(user_danmaku)
        ckpt["stats"]["total_comments"] += len(user_comments)
        ckpt["stats"]["total_danmaku"] += len(user_danmaku)
        ckpt["stats"]["graph_edges"] = len(ckpt["graph_edges"])
        ckpt["stats"]["elapsed_min"] = (time.time() - start_time) / 60

        elapsed = (time.time() - start_time) / 60
        log_progress(ckpt, uid, level, user_comments, user_danmaku, elapsed)
        save_checkpoint(ckpt)

    # ── Finalize ──
    ckpt["stats"]["elapsed_min"] = (time.time() - start_time) / 60
    ckpt["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    save_checkpoint(ckpt)
    save_final_output(ckpt)
    print_report(ckpt)

    return ckpt

# ── Entry Point ────────────────────────────────────────────────────────────────

def main():
    seed_url = os.environ.get("FRIENDSHIP_SEED_URL", "")

    if not seed_url:
        # Default to a popular seed user from the existing harvest
        print("FRIENDSHIP_SEED_URL not set. Using default seed.")
        print("Set env var to override: FRIENDSHIP_SEED_URL=\"https://space.bilibili.com/<uid>\"")
        seed_url = "https://space.bilibili.com/43616307"  # Popular Bilibili user

    try:
        result = friendship_harvest(seed_url)
    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Checkpoint saved.")
    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
