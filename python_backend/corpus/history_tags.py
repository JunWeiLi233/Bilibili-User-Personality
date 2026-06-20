from __future__ import annotations

import html
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from python_backend.scrapers.rate_limiter import RateLimitPolicy


DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH = "server/data/bilibiliHistoryTagCorpus.json"
DEFAULT_HISTORY_TAG_SEEDS = [
    "鍘嗗彶",
    "涓浗鍘嗗彶",
    "涓栫晫鍘嗗彶",
    "杩戜唬鍙?",
    "鍙や唬鍙?",
    "鍘嗗彶绉戞櫘",
    "鍘嗗彶瑙ｈ",
    "鍘嗗彶浜虹墿",
    "鍘嗗彶浜嬩欢",
    "鎴樹簤鍙?",
    "鍐涗簨鍘嗗彶",
    "鑰冨彜",
    "鏂囩墿",
    "鍗氱墿棣?",
    "鏄庢湞",
    "娓呮湞",
    "涓夊浗",
    "绉︽眽",
    "鍞愭湞",
    "瀹嬫湞",
    "姘戝浗",
]


def _parse_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item or "").strip() for item in value if str(item or "").strip()]
    return [item.strip() for item in re.split(r"[\r\n,;|]+", str(value or "")) if item.strip()]


def _clean_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[^\w\u3400-\u9fff]+", "", text, flags=re.UNICODE)
    return text.lower()


def _clean_title(value: Any, fallback: str = "") -> str:
    text = str(value or "")
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or fallback


def _unique_by(items: list[Any], key_fn) -> list[Any]:
    seen = set()
    result = []
    for item in items:
        key = key_fn(item)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _query_needles(search_queries: Any = None, target_terms: Any = None) -> list[str]:
    values = []
    for item in [*_parse_list(search_queries), *_parse_list(target_terms)]:
        values.extend([item, *str(item).split()])
    return _unique_by([_clean_text(item) for item in values if len(_clean_text(item)) >= 2], lambda item: item)


def _video_text(video: dict[str, Any]) -> str:
    values = [video.get("title"), video.get("description"), video.get("desc"), video.get("dynamic"), *(video.get("tags") or [])]
    return _clean_text(" ".join(str(value) for value in values if value))


def _score_history_video(video: dict[str, Any], needles: list[str]) -> int:
    text = _video_text(video)
    if not text:
        return 0
    score = 0
    for needle in needles:
        if needle in text:
            score += 3 if len(needle) >= 4 else 1
    if any("\u5386\u53f2" in _clean_text(tag) for tag in video.get("tags") or []):
        score += 2
    if "\u5386\u53f2" in _clean_text(video.get("sourceQuery")):
        score += 1
    return score


def _bounded_int(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(number, maximum))


class HistoryTagScrapePlanner:
    """Build scrapeBilibiliHistoryTags.js-compatible request plans."""

    def __init__(self, project_dir: str | None = None):
        self.project_dir = project_dir or ""

    def build_plan(
        self,
        argv: list[Any] | None = None,
        env: dict[str, Any] | None = None,
        seed_files: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        env = env or {}
        options = {
            "outputPath": str(env.get("BILIBILI_HISTORY_TAG_CORPUS_PATH") or DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH),
            "pages": _bounded_int(env.get("BILIBILI_HISTORY_TAG_PAGES"), 1, 1, 10),
            "pageSize": _bounded_int(env.get("BILIBILI_HISTORY_TAG_PAGE_SIZE"), 20, 1, 50),
            "delayMs": _bounded_int(env.get("BILIBILI_HISTORY_TAG_DELAY_MS"), 5000, 0, 120000),
            "jitterMs": _bounded_int(env.get("BILIBILI_HISTORY_TAG_JITTER_MS"), 2500, 0, 120000),
            "seeds": _parse_list(env.get("BILIBILI_HISTORY_TAG_SEEDS")),
            "seedFile": str(env.get("BILIBILI_HISTORY_TAG_SEED_FILE") or ""),
            "write": env.get("BILIBILI_HISTORY_TAG_WRITE") == "1",
        }
        for raw_arg in argv or []:
            arg = str(raw_arg)
            if arg.startswith("--output="):
                options["outputPath"] = arg[len("--output=") :].strip()
            elif arg.startswith("--pages="):
                options["pages"] = _bounded_int(arg[len("--pages=") :], options["pages"], 1, 10)
            elif arg.startswith("--page-size="):
                options["pageSize"] = _bounded_int(arg[len("--page-size=") :], options["pageSize"], 1, 50)
            elif arg.startswith("--delay-ms="):
                options["delayMs"] = _bounded_int(arg[len("--delay-ms=") :], options["delayMs"], 0, 120000)
            elif arg.startswith("--jitter-ms="):
                options["jitterMs"] = _bounded_int(arg[len("--jitter-ms=") :], options["jitterMs"], 0, 120000)
            elif arg.startswith("--seed="):
                options["seeds"].append(arg[len("--seed=") :].strip())
            elif arg.startswith("--seeds="):
                options["seeds"].extend(_parse_list(arg[len("--seeds=") :]))
            elif arg.startswith("--seed-file="):
                options["seedFile"] = arg[len("--seed-file=") :].strip()
            elif arg == "--write":
                options["write"] = True
        if options["seedFile"]:
            options["seeds"].extend(_parse_list((seed_files or {}).get(options["seedFile"], "")))
        options["seeds"] = _unique_by([seed for seed in options["seeds"] if seed], lambda seed: seed)
        if not options["seeds"]:
            options["seeds"] = list(DEFAULT_HISTORY_TAG_SEEDS)
        options.update(
            RateLimitPolicy(
                min_delay_ms=options["delayMs"],
                jitter_ms=options["jitterMs"],
                block_cooldown_ms=0,
            ).to_history_tag_options()
        )

        requests = self._requests(options["seeds"], options["pages"], options["pageSize"])
        return {
            "ok": True,
            "outputPath": options["outputPath"],
            "pages": options["pages"],
            "pageSize": options["pageSize"],
            "delayMs": options["delayMs"],
            "jitterMs": options["jitterMs"],
            "write": options["write"],
            "seeds": options["seeds"],
            "seedFile": options["seedFile"],
            "collectComments": False,
            "collectDanmaku": False,
            "requests": requests,
            "summary": {
                "seeds": len(options["seeds"]),
                "requests": len(requests),
                "commentDanmakuScraping": False,
            },
        }

    def _requests(self, seeds: list[str], pages: int, page_size: int) -> list[dict[str, Any]]:
        requests = []
        for seed in seeds:
            encoded = quote(seed, safe="")
            for page in range(1, pages + 1):
                requests.append(
                    {
                        "seed": seed,
                        "page": page,
                        "url": f"https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={encoded}&page={page}&page_size={page_size}",
                        "referer": f"https://search.bilibili.com/all?keyword={encoded}",
                    }
                )
        return requests


class HistoryTagCorpusSummary:
    """Shape history-tag corpus merge results into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("corpus", "tags", "videos", "runs")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class HistoryTagScrapePlanSummary:
    """Shape history-tag scrape plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("outputPath", "pages", "pageSize", "delayMs", "jitterMs", "write", "seeds", "requests", "summary")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class HistoryTagCorpusContractComparator:
    """Compare history-tag corpus merge results using the JS/Python JSON contract."""

    def __init__(self, summary: HistoryTagCorpusSummary | None = None):
        self.summary = summary or HistoryTagCorpusSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }


class HistoryTagScrapePlanContractComparator:
    """Compare history-tag scrape plans using the JS/Python JSON contract."""

    def __init__(self, summary: HistoryTagScrapePlanSummary | None = None):
        self.summary = summary or HistoryTagScrapePlanSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }


class HistoryTagCorpusManager:
    """Merge and query Bilibili history-tag video corpus JSON contracts."""

    def __init__(self, generated_at: str | None = None):
        self.generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def merge_result(self, current: dict[str, Any] | None, update: dict[str, Any] | None) -> dict[str, Any]:
        corpus = self.merge(current, update)
        return {"ok": True, "corpus": corpus, "tags": len(corpus["tags"]), "videos": len(corpus["videos"]), "runs": len(corpus["runs"])}

    def merge(self, current: dict[str, Any] | None, update: dict[str, Any] | None) -> dict[str, Any]:
        current = current if isinstance(current, dict) else {}
        update = update if isinstance(update, dict) else {}
        tags = _unique_by([*(current.get("tags") or []), *(update.get("tags") or [])], lambda tag: _clean_text(tag.get("name") if isinstance(tag, dict) else tag))
        videos = _unique_by(
            [self._normalize_video(video) for video in [*(current.get("videos") or []), *(update.get("videos") or [])] if isinstance(video, dict)],
            lambda video: video.get("bvid") or video.get("sourceUrl"),
        )
        return {
            "version": 1,
            "updatedAt": self.generated_at,
            "tags": tags,
            "videos": videos,
            "runs": [*(current.get("runs") or []), *(update.get("runs") or [])],
        }

    def videos_for_search(self, corpus: dict[str, Any] | None, search_queries: Any = None, target_terms: Any = None, limit: int = 20) -> list[dict[str, Any]]:
        needles = _query_needles(search_queries, target_terms)
        fallback_needles = ["\u5386\u53f2"]
        scored = []
        for video in (corpus or {}).get("videos") or []:
            if not isinstance(video, dict):
                continue
            score = _score_history_video(video, needles if needles else fallback_needles)
            if video.get("bvid") and score > 0:
                scored.append({"video": video, "score": score})
        scored.sort(key=lambda item: (-item["score"], -float(item["video"].get("replyCount") or 0)))
        capped = scored[: max(1, int(limit or 20))]
        return _unique_by([self._search_result(item["video"]) for item in capped], lambda video: video.get("bvid"))

    def _normalize_video(self, video: dict[str, Any]) -> dict[str, Any]:
        bvid = str(video.get("bvid") or "").strip()
        aid = "" if video.get("aid") is None else str(video.get("aid"))
        return {
            **video,
            "bvid": bvid,
            "aid": aid,
            "title": _clean_title(video.get("title"), bvid),
            "sourceUrl": video.get("sourceUrl") or (f"https://www.bilibili.com/video/{bvid}/" if bvid else ""),
            "tags": _unique_by(_parse_list(video.get("tags")), _clean_text),
            "sourceQuery": str(video.get("sourceQuery") or "").strip(),
            "replyCount": self._number(video.get("replyCount")),
        }

    def _search_result(self, video: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": f"video-1-{video.get('aid') or video.get('bvid')}",
            "kind": "video",
            "bvid": video.get("bvid"),
            "oid": str(video.get("aid") or ""),
            "replyType": 1,
            "title": video.get("title") or video.get("bvid"),
            "desc": video.get("description") or video.get("desc") or "",
            "sourceUrl": video.get("sourceUrl") or f"https://www.bilibili.com/video/{video.get('bvid')}/",
            "replyCount": self._number(video.get("replyCount")),
            "tags": video.get("tags") if isinstance(video.get("tags"), list) else [],
            "source": "bilibili-history-tags",
        }

    def _number(self, value: Any) -> int:
        try:
            return int(float(value or 0))
        except (TypeError, ValueError):
            return 0


class HistoryTagCorpusLoader:
    """Read history-tag corpus contracts from monolithic JSON or split shard manifests."""

    DEFAULT_CORPUS = {"version": 1, "updatedAt": None, "tags": [], "videos": [], "runs": []}

    def __init__(self, path: str | Path, fallback: dict[str, Any] | None = None):
        self.path = Path(path)
        self.fallback = dict(fallback or self.DEFAULT_CORPUS)

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return dict(self.fallback)
        payload = self._read_json_object(self.path)
        if not isinstance(payload, dict):
            return dict(self.fallback)
        if payload.get("storage") != "split":
            return self._with_lists(payload)
        return {
            **payload,
            "tags": self._hydrate_files(payload.get("tagFiles"), "tags", payload.get("tags")),
            "videos": self._hydrate_files(payload.get("videoFiles"), "videos", payload.get("videos")),
            "runs": self._hydrate_files(payload.get("runFiles"), "runs", payload.get("runs")),
        }

    def _with_lists(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            **payload,
            "tags": payload.get("tags") if isinstance(payload.get("tags"), list) else [],
            "videos": payload.get("videos") if isinstance(payload.get("videos"), list) else [],
            "runs": payload.get("runs") if isinstance(payload.get("runs"), list) else [],
        }

    def _hydrate_files(self, file_paths: Any, key: str, fallback: Any = None) -> list[Any]:
        if not isinstance(file_paths, list):
            return list(fallback) if isinstance(fallback, list) else []
        items = []
        for file_path in file_paths:
            if not isinstance(file_path, str) or not file_path.strip():
                continue
            shard = self._read_json_object(self.path.parent / file_path)
            if isinstance(shard, dict) and isinstance(shard.get(key), list):
                items.extend(shard[key])
        return items

    def _read_json_object(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else None


class HistoryTagCorpusShardWriter:
    """Write history-tag corpora into split tag, video, and run shard manifests."""

    def __init__(self, path: str | Path, max_shard_bytes: int = 64 * 1024):
        self.path = Path(path)
        self.max_shard_bytes = max(1024, int(max_shard_bytes))

    def write(
        self,
        *,
        tags: list[Any],
        videos: list[dict[str, Any]],
        runs: list[dict[str, Any]],
        manifest: dict[str, Any] | None = None,
    ) -> None:
        manifest = dict(manifest or {})
        tag_files = self._write_shards(tags, "tags", self._tags_dir(), "tags", manifest)
        video_files = self._write_shards(videos, "videos", self._videos_dir(), "videos", manifest)
        run_files = self._write_shards(runs, "runs", self._runs_dir(), "runs", manifest)
        payload = {
            **manifest,
            "version": manifest.get("version", 1),
            "storage": "split",
            "shardMaxBytes": self.max_shard_bytes,
            "tagFiles": tag_files,
            "tagCount": len(tags),
            "videoFiles": video_files,
            "videoCount": len(videos),
            "runFiles": run_files,
            "runCount": len(runs),
        }
        self._write_json(self.path, payload)
        self._remove_stale_shards(self._tags_dir(), tag_files, r"tags-\d{4}\.json")
        self._remove_stale_shards(self._videos_dir(), video_files, r"videos-\d{4}\.json")
        self._remove_stale_shards(self._runs_dir(), run_files, r"runs-\d{4}\.json")

    def _tags_dir(self) -> Path:
        return self.path.with_suffix("").parent / f"{self.path.with_suffix('').name}.tags"

    def _videos_dir(self) -> Path:
        return self.path.with_suffix("").parent / f"{self.path.with_suffix('').name}.videos"

    def _runs_dir(self) -> Path:
        return self.path.with_suffix("").parent / f"{self.path.with_suffix('').name}.runs"

    def _write_shards(
        self,
        values: list[Any],
        file_stem: str,
        directory: Path,
        key: str,
        manifest: dict[str, Any],
    ) -> list[str]:
        directory.mkdir(parents=True, exist_ok=True)
        shards = self._split_values(values, key, manifest)
        files: list[str] = []
        for index, shard_values in enumerate(shards, start=1):
            name = f"{file_stem}-{index:04d}.json"
            self._write_json(directory / name, self._build_shard_payload(manifest, index, len(shards), key, shard_values))
            files.append(f"{directory.name}/{name}")
        return files

    def _split_values(self, values: list[Any], key: str, manifest: dict[str, Any]) -> list[list[Any]]:
        if not values:
            return [[]]
        shards: list[list[Any]] = []
        current: list[Any] = []
        for value in values:
            candidate = [*current, value]
            if current and self._json_bytes(self._build_shard_payload(manifest, 9999, 9999, key, candidate)) > self.max_shard_bytes:
                shards.append(current)
                current = [value]
            else:
                current = candidate
        if current:
            shards.append(current)
        return shards

    def _remove_stale_shards(self, directory: Path, kept_files: list[str], pattern: str) -> None:
        kept_names = {Path(path).name for path in kept_files}
        regex = re.compile(pattern, re.IGNORECASE)
        if not directory.exists():
            return
        for path in directory.iterdir():
            if path.is_file() and regex.fullmatch(path.name) and path.name not in kept_names:
                path.unlink()

    @staticmethod
    def _build_shard_payload(
        manifest: dict[str, Any],
        shard: int,
        shard_count: int,
        key: str,
        values: list[Any],
    ) -> dict[str, Any]:
        return {
            "version": manifest.get("version", 1),
            "updatedAt": manifest.get("updatedAt") or None,
            "shard": shard,
            "shardCount": shard_count,
            key: values,
        }

    @staticmethod
    def _json_bytes(payload: dict[str, Any]) -> int:
        return len((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class HistoryTagCorpusRunner:
    """Merge Bilibili history-tag corpus JSON contracts from files."""

    def __init__(self, current_path: str | Path, update_path: str | Path, generated_at: str | None = None):
        self.current_path = Path(current_path)
        self.update_path = Path(update_path)
        self.manager = HistoryTagCorpusManager(generated_at=generated_at)

    def run(self) -> dict[str, Any]:
        current = HistoryTagCorpusLoader(self.current_path).load()
        update = HistoryTagCorpusLoader(self.update_path, fallback={"tags": [], "videos": [], "runs": []}).load()
        return self.manager.merge_result(current, update)


class HistoryTagCorpusPayloadContractComparator:
    """Compare file-backed history-tag corpus merges against saved JS-compatible JSON."""

    def __init__(
        self,
        current_path: str | Path,
        update_path: str | Path,
        js_report_path: str | Path,
        generated_at: str | None = None,
    ):
        self.current_path = Path(current_path)
        self.update_path = Path(update_path)
        self.js_report_path = Path(js_report_path)
        self.generated_at = generated_at
        self.summary = HistoryTagCorpusSummary()
        self.comparator = HistoryTagCorpusContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = HistoryTagCorpusRunner(self.current_path, self.update_path, generated_at=self.generated_at).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class HistoryTagScrapePlanRunner:
    """Read a JS-compatible history-tag scrape payload and emit a dry-run request plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_json_object(self.payload_path, {})
        if not isinstance(payload, dict):
            raise ValueError("History-tag scrape plan payload must be a JSON object.")
        planner = HistoryTagScrapePlanner(project_dir=str(payload.get("projectDir") or payload.get("project_dir") or ""))
        return planner.build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
            seed_files=payload.get("seedFiles") if isinstance(payload.get("seedFiles"), dict) else {},
        )

    def _read_json_object(self, path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class HistoryTagScrapePlanPayloadContractComparator:
    """Compare file-backed history-tag scrape plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = HistoryTagScrapePlanSummary()
        self.comparator = HistoryTagScrapePlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = HistoryTagScrapePlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
