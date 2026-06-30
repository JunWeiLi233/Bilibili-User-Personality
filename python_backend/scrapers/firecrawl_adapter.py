"""Firecrawl adapter for Bilibili comment harvesting.

Tier-2 fallback when direct Bilibili API returns 412 (rate-limited)
or Cloudflare challenge. Self-hosted: http://localhost:3002 (no API key).
"""

import json, os, re, time
from typing import Any

from firecrawl import Firecrawl

API_URL  = os.environ.get("FIRECRAWL_BASE_URL", "http://localhost:3002")
API_KEY  = os.environ.get("FIRECRAWL_API_KEY", "")
ENABLED  = os.environ.get("FIRECRAWL_ENABLED", "0") == "1"

_fc: Firecrawl | None = None


def get_client() -> Firecrawl:
    global _fc
    if _fc is None:
        kw: dict[str, Any] = {"api_url": API_URL}
        if API_KEY: kw["api_key"] = API_KEY
        _fc = Firecrawl(**kw)
    return _fc


def is_available() -> bool:
    if not ENABLED: return False
    try:
        r = get_client().scrape("https://www.bilibili.com", formats=["markdown"])
        return bool(r.markdown)
    except Exception:
        return False


def search_bilibili(term: str, limit: int = 10) -> list[dict[str, str]]:
    """Search Bilibili for a keyword, return [{url, title, bv_id}, ...]."""
    if not ENABLED: return []
    query = f"{term} 评论 site:bilibili.com"
    try:
        results = get_client().search(query=query, limit=limit)
    except Exception:
        return []
    videos: list[dict[str, str]] = []
    for item in (results.web or []):
        url = item.url or ""
        if "bilibili.com/video/" not in url: continue
        m = re.search(r"(BV[\w]+)", url)
        videos.append({"url": url, "title": item.title or "", "bv_id": m.group(1) if m else ""})
        if len(videos) >= limit: break
    return videos


def scrape_video_comments(url: str, pages: int = 2) -> list[str]:
    """Scrape comment text from a Bilibili video page."""
    if not ENABLED: return []
    comments: list[str] = []
    for page in range(1, pages + 1):
        page_url = f"{url}?p={page}" if page > 1 else url
        try:
            resp = get_client().scrape(page_url, formats=["markdown"])
        except Exception:
            continue
        if not resp.markdown:
            continue
        for line in resp.markdown.split("\n"):
            line = line.strip()
            if line.startswith("- **") or line.startswith("* **"):
                comments.append(line)
        time.sleep(0.5)
    return comments


def batch_harvest_evidence(terms: list[str], videos_per_term: int = 5) -> dict[str, list[dict[str, str]]]:
    """Harvest evidence for multiple terms. Returns {term: [{comment_text, video_url, video_title}, ...]}."""
    if not ENABLED: return {}
    results: dict[str, list[dict[str, str]]] = {}
    for term in terms:
        videos = search_bilibili(term, limit=videos_per_term)
        evidence: list[dict[str, str]] = []
        for v in videos:
            for c in scrape_video_comments(v["url"], pages=2):
                if term in c:
                    evidence.append({"comment_text": c, "video_url": v["url"], "video_title": v["title"]})
        results[term] = evidence
        time.sleep(1.0)
    return results


def fallback_search(term: str) -> dict[str, Any] | None:
    """Called when Bilibili direct API is rate-limited. Returns None if Firecrawl also fails."""
    if not ENABLED: return None
    try:
        videos = search_bilibili(term, limit=8)
        return {"ok": True, "videos": videos, "source": "firecrawl"} if videos else None
    except Exception:
        return None
