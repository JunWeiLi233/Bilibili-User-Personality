from __future__ import annotations

import re
from typing import Any


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def is_scrape_diagnostic_message(value: Any) -> bool:
    message = clean_text(value)
    return bool(
        re.search(r"(?:^|[:\s])(?:discover|explicit Tieba thread URLs):\s+.*HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?://", message, re.IGNORECASE)
        or re.search(r"HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?://(?:tieba|c\.tieba|www\.bilibili|api\.bilibili)\.", message, re.IGNORECASE)
    )


def clean_comment_message(value: Any) -> str:
    message = clean_text(value)
    return message if message and not is_scrape_diagnostic_message(message) else ""


class LocalCorpusFlattener:
    """Flatten local Bilibili/Tieba corpus shapes into the JS comment contract."""

    def flatten(self, raw: Any) -> list[dict[str, str]]:
        if isinstance(raw, list) and all(isinstance(item, str) for item in raw):
            return [
                {"message": message, "platform": "bilibili", "source": "Bilibili local text corpus", "uid": "", "uname": ""}
                for message in (clean_comment_message(item) for item in raw)
                if message
            ]

        if isinstance(raw, dict) and isinstance(raw.get("_uidComments"), dict):
            return self._flatten_uid_comment_map(raw.get("_uidComments") or {})

        if isinstance(raw, dict) and isinstance(raw.get("comments"), list):
            return self._flatten_top_level_comments(raw.get("comments") or [])

        if isinstance(raw, dict) and isinstance(raw.get("runs"), list):
            return self._flatten_run_comments(raw.get("runs") or [])

        if isinstance(raw, dict) and isinstance(raw.get("users"), dict):
            return self._flatten_users(raw.get("users") or {})

        values = raw if isinstance(raw, list) else self._object_values(raw)
        return self._flatten_uid_comment_map({"": values})

    def _flatten_top_level_comments(self, comments: list[Any]) -> list[dict[str, str]]:
        flattened = []
        for item in comments:
            if not isinstance(item, dict):
                continue
            message = clean_comment_message(item.get("message"))
            if not message:
                continue
            platform = clean_text(item.get("platform")) or "bilibili"
            flattened.append(
                {
                    "message": message,
                    "platform": platform,
                    "source": clean_text(item.get("source")) or (self._source_for_tieba_comment(item) if platform == "tieba" else "Bilibili local corpus"),
                    "uid": clean_text(item.get("uid") or item.get("mid")),
                    "uname": clean_text(item.get("uname")),
                }
            )
        return flattened

    def _flatten_run_comments(self, runs: list[Any]) -> list[dict[str, str]]:
        flattened = []
        for run in runs:
            if not isinstance(run, dict):
                continue
            for result in run.get("results") or []:
                if not isinstance(result, dict):
                    continue
                for item in result.get("comments") or []:
                    if not isinstance(item, dict):
                        continue
                    message = clean_comment_message(item.get("message"))
                    if not message:
                        continue
                    platform = clean_text(item.get("platform")) or "tieba"
                    flattened.append(
                        {
                            "message": message,
                            "platform": platform,
                            "source": self._source_for_tieba_comment(item) if platform == "tieba" else clean_text(item.get("source")) or "Bilibili local corpus",
                            "uid": clean_text(item.get("uid") or item.get("mid")),
                            "uname": clean_text(item.get("uname")),
                        }
                    )
        return flattened

    def _flatten_uid_comment_map(self, raw_map: dict[str, Any]) -> list[dict[str, str]]:
        flattened = []
        for uid, items in raw_map.items():
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                message = clean_comment_message(item.get("message"))
                if not message:
                    continue
                bvid = clean_text(item.get("bvid"))
                flattened.append(
                    {
                        "message": message,
                        "platform": "bilibili",
                        "source": self._source_for_bilibili_comment(item),
                        "uid": bvid or clean_text(item.get("uid") or uid),
                        "uname": clean_text(item.get("uname")),
                    }
                )
        return flattened

    def _flatten_users(self, users: dict[str, Any]) -> list[dict[str, str]]:
        comments = []
        for uid, user in users.items():
            if not isinstance(user, dict):
                continue
            bvids = user.get("bvids") if isinstance(user.get("bvids"), list) else []
            comment_lines = self._split_comment_text(user.get("commentText"))
            scraped_lines = comment_lines or self._split_comment_text(user.get("combinedText"))
            for index, message in enumerate(scraped_lines):
                comments.append(
                    {
                        "message": message,
                        "platform": "bilibili",
                        "source": self._source_for_scraped_user_comment(bvids[index] if index < len(bvids) else ""),
                        "uid": clean_text(user.get("uid") or uid),
                        "uname": clean_text(user.get("uname") or user.get("name")),
                    }
                )
            for item in user.get("comments") if isinstance(user.get("comments"), list) else []:
                message = clean_comment_message(item.get("message") if isinstance(item, dict) else "")
                if not message:
                    continue
                comments.append(
                    {
                        "message": message,
                        "platform": "bilibili",
                        "source": self._source_for_aicu_object("Bilibili local AICU corpus", item.get("oid")),
                        "uid": clean_text(uid),
                        "uname": clean_text(item.get("uname") or user.get("name")),
                    }
                )
            for item in user.get("danmaku") if isinstance(user.get("danmaku"), list) else []:
                message = clean_comment_message((item.get("content") or item.get("message")) if isinstance(item, dict) else "")
                if not message:
                    continue
                comments.append(
                    {
                        "message": message,
                        "platform": "bilibili",
                        "source": self._source_for_aicu_object("Bilibili local AICU danmaku corpus", item.get("oid")),
                        "uid": clean_text(uid),
                        "uname": clean_text(item.get("uname") or user.get("name")),
                    }
                )
        return comments

    def _split_comment_text(self, value: Any) -> list[str]:
        return [message for message in (clean_comment_message(item) for item in str(value or "").splitlines()) if message]

    def _source_for_bilibili_comment(self, item: dict[str, Any]) -> str:
        bvid = clean_text(item.get("bvid"))
        return f"Bilibili local UID discovery corpus: https://www.bilibili.com/video/{bvid}/" if bvid else "Bilibili local UID discovery corpus"

    def _source_for_scraped_user_comment(self, bvid: Any) -> str:
        bvid = clean_text(bvid)
        return f"Bilibili local scraped user corpus: https://www.bilibili.com/video/{bvid}/" if bvid else "Bilibili local scraped user corpus"

    def _source_for_aicu_object(self, prefix: str, oid: Any) -> str:
        oid = clean_text(oid)
        return f"{prefix}: https://www.bilibili.com/video/av{oid}/" if oid else prefix

    def _source_for_tieba_comment(self, item: dict[str, Any]) -> str:
        source_url = clean_text(item.get("sourceUrl") or item.get("source"))
        return f"Tieba public thread scan: {source_url}" if source_url else "Tieba public thread scan"

    def _object_values(self, raw: Any) -> list[Any]:
        if not isinstance(raw, dict):
            return []
        values = []
        for value in raw.values():
            if isinstance(value, list):
                values.extend(value)
            else:
                values.append(value)
        return values
