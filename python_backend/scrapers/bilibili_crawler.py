from __future__ import annotations

import html
import json
import math
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from python_backend.scrapers.rate_limiter import RateLimitPolicy


BLOCK_CODES = {-101, -111, -352, -412, -509, -799}
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
USER_AGENTS = (
    DEFAULT_USER_AGENT,
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
)
ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7"
SEC_CH_UA = '"Chromium";v="124", "Google Chrome";v="124", "Not.A/Brand";v="99"'


def _bounded_number(value: Any, fallback: float, minimum: float, maximum: float) -> float:
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        number = fallback
    if not math.isfinite(number):
        number = fallback
    bounded = max(minimum, min(number, maximum))
    return int(bounded) if float(bounded).is_integer() else bounded


class BilibiliCrawlerConfigBuilder:
    """Build JS-compatible Bilibili crawler runtime config from environment payloads."""

    def build(self, env: dict[str, Any] | None = None) -> dict[str, int | float]:
        env = env if isinstance(env, dict) else {}
        pacing = RateLimitPolicy(
            min_delay_ms=env.get("BILIBILI_CRAWLER_MIN_DELAY_MS", 2500),
            jitter_ms=env.get("BILIBILI_CRAWLER_JITTER_MS", 2000),
            block_cooldown_ms=env.get("BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS", 120000),
        ).to_bilibili_crawler_options()
        return {
            **pacing,
            "cacheTtlMs": _bounded_number(env.get("BILIBILI_CRAWLER_CACHE_TTL_MS", 300000), 300000, 0, 300000),
            "longPauseProbability": _bounded_number(env.get("BILIBILI_CRAWLER_LONG_PAUSE_PROBABILITY", 0.15), 0.15, 0, 1),
            "longPauseMinMs": _bounded_number(env.get("BILIBILI_CRAWLER_LONG_PAUSE_MIN_MS", 3000), 3000, 0, 60000),
            "longPauseMaxMs": _bounded_number(env.get("BILIBILI_CRAWLER_LONG_PAUSE_MAX_MS", 8000), 8000, 0, 60000),
            "pagePauseMinMs": _bounded_number(env.get("BILIBILI_CRAWLER_PAGE_PAUSE_MIN_MS", 1500), 1500, 0, 60000),
            "pagePauseMaxMs": _bounded_number(env.get("BILIBILI_CRAWLER_PAGE_PAUSE_MAX_MS", 3000), 3000, 0, 60000),
            "objectPauseMinMs": _bounded_number(env.get("BILIBILI_CRAWLER_OBJECT_PAUSE_MIN_MS", 2000), 2000, 0, 60000),
            "objectPauseMaxMs": _bounded_number(env.get("BILIBILI_CRAWLER_OBJECT_PAUSE_MAX_MS", 5000), 5000, 0, 60000),
            "requestTimeoutMs": _bounded_number(env.get("BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS", 30000), 30000, 0, 120000),
        }


class BilibiliCrawlerSummary:
    """Shape Bilibili crawler helper output into the JS/Python comparator summary contract."""

    RESULT_KEYS = (
        "bvids",
        "bvid",
        "blocked",
        "cookie",
        "objects",
        "targetReplies",
        "danmaku",
        "dynamicRecords",
        "crawlerConfig",
        "syntheticCookieJar",
        "headers",
        "requestSchedule",
        "responseCache",
        "capturedCookies",
        "requestTimeout",
        "responseOutcome",
        "textResponseOutcome",
        "dependencyCookie",
        "requestStateReset",
        "sessionIdentity",
        "cookieInitialization",
        "humanPause",
        "fetchConfig",
    )

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class BilibiliCrawlerContractComparator:
    """Compare Bilibili crawler helper outputs using the JS/Python summary contract."""

    def __init__(self, summary: BilibiliCrawlerSummary | None = None):
        self.summary = summary or BilibiliCrawlerSummary()

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


class BilibiliCrawlerRunner:
    """Run deterministic Bilibili crawler helper functions from a JSON payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.helper = BilibiliCrawlerHelper()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.helper.run_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BilibiliCrawlerPayloadContractComparator:
    """Compare file-backed Python crawler helper output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = BilibiliCrawlerSummary()
        self.comparator = BilibiliCrawlerContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = BilibiliCrawlerRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class BilibiliCrawlerHelper:
    """Normalize Bilibili crawler identifiers and block responses without network IO."""

    def run_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        text = payload.get("text") or payload.get("input") or ""
        block_payload = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
        result = {
            "ok": True,
            "bvids": self.parse_bvid_pool(text),
            "bvid": self.extract_bvid(text),
            "blocked": self.is_block_response(block_payload),
        }
        if "cookie" in payload:
            result["cookie"] = self.normalize_bilibili_cookie(payload.get("cookie"))
        if isinstance(payload.get("objects"), list):
            result["objects"] = self.dedupe_public_objects(payload.get("objects"))
        if isinstance(payload.get("reply"), dict):
            result["targetReplies"] = self.collect_reply_for_uid(
                payload.get("reply"),
                payload.get("targetUid"),
                payload.get("object") if isinstance(payload.get("object"), dict) else {},
                [],
            )
        if "danmakuXml" in payload:
            result["danmaku"] = self.parse_danmaku_xml(
                payload.get("danmakuXml"),
                payload.get("video") if isinstance(payload.get("video"), dict) else {},
            )
        if isinstance(payload.get("dynamicItems"), list):
            result["dynamicRecords"] = self.extract_dynamic_records(payload.get("dynamicItems"), payload.get("uid"))
        if isinstance(payload.get("env"), dict):
            result["crawlerConfig"] = self.build_crawler_config(payload.get("env"))
        synthetic_cookie = payload.get("syntheticCookie") if isinstance(payload.get("syntheticCookie"), dict) else None
        synthetic_cookie_jar = None
        if synthetic_cookie is not None:
            synthetic_cookie_jar = self.make_synthetic_cookie_jar(
                random_fn=lambda: synthetic_cookie.get("randomValue", 0.5),
                now_ms=synthetic_cookie.get("nowMs"),
            )
            result["syntheticCookieJar"] = synthetic_cookie_jar
        if isinstance(payload.get("request"), dict):
            request = payload.get("request") or {}
            result["headers"] = self.build_request_headers(
                request.get("url"),
                request.get("referer", "https://www.bilibili.com"),
                request_cookie=request.get("cookie") or request.get("bilibiliCookie") or "",
                synthetic_cookie=synthetic_cookie_jar,
            )
        if isinstance(payload.get("schedule"), dict):
            schedule = payload.get("schedule") or {}
            result["requestSchedule"] = self.plan_request_schedule(
                config=schedule.get("config") if isinstance(schedule.get("config"), dict) else {},
                state=schedule.get("state") if isinstance(schedule.get("state"), dict) else {},
                now_ms=schedule.get("nowMs", 0),
                random_values=schedule.get("randomValues") if isinstance(schedule.get("randomValues"), list) else [],
            )
        if isinstance(payload.get("cache"), dict):
            cache = payload.get("cache") or {}
            result["responseCache"] = self.plan_response_cache(
                url=cache.get("url"),
                referer=cache.get("referer", "https://www.bilibili.com"),
                request_cookie=cache.get("cookie") or cache.get("bilibiliCookie") or "",
                config=cache.get("config") if isinstance(cache.get("config"), dict) else {},
                cached=cache.get("cached") if isinstance(cache.get("cached"), dict) else None,
                now_ms=cache.get("nowMs", 0),
                payload=cache.get("payload") if isinstance(cache.get("payload"), dict) else None,
            )
        if isinstance(payload.get("setCookie"), dict):
            set_cookie = payload.get("setCookie") or {}
            result["capturedCookies"] = self.capture_set_cookies(
                set_cookie.get("headers") if isinstance(set_cookie.get("headers"), list) else [],
                cookie_jar=set_cookie.get("cookieJar") if isinstance(set_cookie.get("cookieJar"), dict) else {},
            )
        if isinstance(payload.get("timeout"), dict):
            timeout = payload.get("timeout") or {}
            result["requestTimeout"] = self.plan_fetch_timeout(
                timeout.get("url"),
                config=timeout.get("config") if isinstance(timeout.get("config"), dict) else {},
                has_abort_controller=bool(timeout.get("hasAbortController", True)),
                has_abort_signal_any=bool(timeout.get("hasAbortSignalAny", False)),
                caller_signal=bool(timeout.get("callerSignal", False)),
                caller_aborted=bool(timeout.get("callerAborted", False)),
            )
        if isinstance(payload.get("response"), dict):
            response = payload.get("response") or {}
            result["responseOutcome"] = self.plan_response_outcome(
                response.get("url"),
                referer=response.get("referer", "https://www.bilibili.com"),
                response_ok=bool(response.get("ok", True)),
                status=response.get("status", 200),
                payload=response.get("payload") if isinstance(response.get("payload"), dict) else None,
                config=response.get("config") if isinstance(response.get("config"), dict) else {},
                state=response.get("state") if isinstance(response.get("state"), dict) else {},
                now_ms=response.get("nowMs", 0),
                request_cookie=response.get("cookie") or response.get("bilibiliCookie") or "",
            )
        if isinstance(payload.get("textResponse"), dict):
            text_response = payload.get("textResponse") or {}
            result["textResponseOutcome"] = self.plan_text_response_outcome(
                text_response.get("url"),
                response_ok=bool(text_response.get("ok", True)),
                status=text_response.get("status", 200),
                config=text_response.get("config") if isinstance(text_response.get("config"), dict) else {},
                state=text_response.get("state") if isinstance(text_response.get("state"), dict) else {},
                now_ms=text_response.get("nowMs", 0),
            )
        if isinstance(payload.get("dependencyCookie"), dict):
            dependency_cookie = payload.get("dependencyCookie") or {}
            result["dependencyCookie"] = self.plan_dependency_cookie_forwarding(
                dependency_cookie.get("cookie") or dependency_cookie.get("bilibiliCookie") or "",
                fetch_json_options=dependency_cookie.get("fetchJsonOptions")
                if isinstance(dependency_cookie.get("fetchJsonOptions"), dict)
                else None,
                fetch_text_options=dependency_cookie.get("fetchTextOptions")
                if isinstance(dependency_cookie.get("fetchTextOptions"), dict)
                else None,
            )
        if isinstance(payload.get("requestStateReset"), dict):
            state_reset = payload.get("requestStateReset") or {}
            result["requestStateReset"] = self.plan_request_state_reset(
                state_reset.get("state") if isinstance(state_reset.get("state"), dict) else state_reset
            )
        if isinstance(payload.get("sessionIdentity"), dict):
            session_identity = payload.get("sessionIdentity") or {}
            result["sessionIdentity"] = self.plan_session_identity(
                session_identity.get("state") if isinstance(session_identity.get("state"), dict) else {},
                random_value=session_identity.get("randomValue", 0),
            )
        if isinstance(payload.get("cookieInitialization"), dict):
            cookie_initialization = payload.get("cookieInitialization") or {}
            random_value = cookie_initialization.get("randomValue", 0.5)
            result["cookieInitialization"] = self.plan_cookie_initialization(
                cookie_initialization.get("state") if isinstance(cookie_initialization.get("state"), dict) else {},
                env_cookie=cookie_initialization.get("envCookie", ""),
                random_fn=lambda: random_value,
                now_ms=cookie_initialization.get("nowMs", 0),
            )
        if isinstance(payload.get("humanPause"), dict):
            human_pause = payload.get("humanPause") or {}
            result["humanPause"] = self.plan_human_pause(
                human_pause.get("minMs", 0),
                human_pause.get("maxMs", 0),
                random_value=human_pause.get("randomValue", 0),
            )
        if isinstance(payload.get("fetchConfig"), dict):
            fetch_config = payload.get("fetchConfig") or {}
            result["fetchConfig"] = self.plan_fetch_config_with_signal(
                fetch_config.get("config") if isinstance(fetch_config.get("config"), dict) else {},
                has_signal=bool(fetch_config.get("hasSignal", False)),
                signal_token=fetch_config.get("signalToken", fetch_config.get("signal", "signal")),
            )
        return result

    def build_crawler_config(self, env: dict[str, Any] | None = None) -> dict[str, int | float]:
        return BilibiliCrawlerConfigBuilder().build(env)

    def plan_fetch_config_with_signal(
        self,
        config: dict[str, Any] | None = None,
        *,
        has_signal: bool = False,
        signal_token: Any = "signal",
    ) -> dict[str, Any]:
        base_config = dict(config) if isinstance(config, dict) else {}
        if not has_signal:
            return {"config": base_config, "forwardsSignal": False}
        merged = {**base_config, "signal": signal_token}
        return {"config": merged, "forwardsSignal": True}

    def plan_human_pause(self, min_ms: Any = 0, max_ms: Any = 0, random_value: Any = 0) -> dict[str, Any]:
        minimum = self._number(min_ms, 0)
        maximum = self._number(max_ms, 0)
        if maximum <= 0:
            return {"waitMs": 0, "willWait": False}
        if maximum <= minimum:
            return {"waitMs": minimum, "willWait": True}
        random_number = self._bounded_float(random_value, 0, 0, 1)
        return {
            "waitMs": minimum + math.floor(random_number * (maximum - minimum)),
            "willWait": True,
        }

    def plan_cookie_initialization(
        self,
        state: dict[str, Any] | None = None,
        env_cookie: Any = "",
        random_fn: Any | None = None,
        now_ms: Any | None = None,
    ) -> dict[str, Any]:
        state = state if isinstance(state, dict) else {}
        if bool(state.get("cookiesInitialized")):
            cookie_jar = state.get("cookieJar") if isinstance(state.get("cookieJar"), dict) else {}
            return {
                "cookiesInitialized": True,
                "cookieJar": {str(name): str(value) for name, value in cookie_jar.items() if str(name or "").strip() and str(value or "").strip()},
                "source": "existing",
            }

        cookie_jar = self._cookie_pairs(env_cookie)
        if cookie_jar:
            return {
                "cookiesInitialized": True,
                "cookieJar": cookie_jar,
                "source": "env",
            }

        return {
            "cookiesInitialized": True,
            "cookieJar": self.make_synthetic_cookie_jar(random_fn=random_fn, now_ms=now_ms),
            "source": "synthetic",
        }

    def plan_session_identity(
        self,
        state: dict[str, Any] | None = None,
        random_value: Any = 0,
    ) -> dict[str, Any]:
        state = state if isinstance(state, dict) else {}
        if bool(state.get("sessionUaPicked")):
            user_agent = str(state.get("sessionUserAgent") or DEFAULT_USER_AGENT)
            return {
                "sessionUaPicked": True,
                "sessionUserAgent": user_agent,
                "sessionPlatform": str(state.get("sessionPlatform") or self._platform_for_user_agent(user_agent)),
                "pickedIndex": None,
            }

        try:
            random_number = float(random_value)
        except (TypeError, ValueError):
            random_number = 0.0
        if not math.isfinite(random_number):
            random_number = 0.0
        pick = math.floor(random_number * len(USER_AGENTS))
        index = pick % len(USER_AGENTS)
        user_agent = USER_AGENTS[index] or USER_AGENTS[0]
        return {
            "sessionUaPicked": True,
            "sessionUserAgent": user_agent,
            "sessionPlatform": self._platform_for_user_agent(user_agent),
            "pickedIndex": index,
        }

    def plan_request_state_reset(self, state: dict[str, Any] | None = None) -> dict[str, Any]:
        state = state if isinstance(state, dict) else {}
        return {
            "responseCacheSize": 0,
            "cookieJar": {},
            "nextRequestAt": 0,
            "cooldownUntil": 0,
            "consecutiveBlocks": 0,
            "sessionUaPicked": False,
            "cookiesInitialized": False,
            "sessionUserAgent": str(state.get("sessionUserAgent") or DEFAULT_USER_AGENT),
            "sessionPlatform": str(state.get("sessionPlatform") or "Windows"),
        }

    def plan_dependency_cookie_forwarding(
        self,
        cookie: Any = "",
        fetch_json_options: dict[str, Any] | None = None,
        fetch_text_options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        bilibili_cookie = self.normalize_bilibili_cookie(cookie)
        if not bilibili_cookie:
            return {
                "enabled": False,
                "bilibiliCookie": "",
                "fetchJsonOptions": None,
                "fetchTextOptions": None,
            }
        json_options = {**(fetch_json_options if isinstance(fetch_json_options, dict) else {}), "bilibiliCookie": bilibili_cookie}
        text_options = {**(fetch_text_options if isinstance(fetch_text_options, dict) else {}), "bilibiliCookie": bilibili_cookie}
        return {
            "enabled": True,
            "bilibiliCookie": bilibili_cookie,
            "fetchJsonOptions": json_options,
            "fetchTextOptions": text_options,
        }

    def plan_text_response_outcome(
        self,
        url: Any,
        response_ok: bool = True,
        status: Any = 200,
        config: dict[str, Any] | None = None,
        state: dict[str, Any] | None = None,
        now_ms: Any = 0,
    ) -> dict[str, Any]:
        status_number = self._number(status, 0)
        state = state if isinstance(state, dict) else {}
        if not response_ok:
            cooldown = self.plan_block_cooldown(config, state, now_ms) if status_number in {403, 412, 429, 503} else None
            return {
                "ok": False,
                "error": f"HTTP {status_number} from {url}",
                "blocked": cooldown is not None,
                "consecutiveBlocks": cooldown["consecutiveBlocks"] if cooldown else self._number(state.get("consecutiveBlocks"), 0),
                "cooldownUntil": cooldown["cooldownUntil"] if cooldown else None,
            }

        return {
            "ok": True,
            "error": "",
            "blocked": False,
            "consecutiveBlocks": 0,
            "cooldownUntil": None,
        }

    def plan_response_outcome(
        self,
        url: Any,
        referer: Any = "https://www.bilibili.com",
        response_ok: bool = True,
        status: Any = 200,
        payload: dict[str, Any] | None = None,
        config: dict[str, Any] | None = None,
        state: dict[str, Any] | None = None,
        now_ms: Any = 0,
        request_cookie: Any = "",
    ) -> dict[str, Any]:
        status_number = self._number(status, 0)
        state = state if isinstance(state, dict) else {}
        if not response_ok:
            cooldown = self.plan_block_cooldown(config, state, now_ms) if status_number in {403, 412, 429, 503} else None
            return {
                "ok": False,
                "error": f"HTTP {status_number} from {url}",
                "blocked": cooldown is not None,
                "consecutiveBlocks": cooldown["consecutiveBlocks"] if cooldown else self._number(state.get("consecutiveBlocks"), 0),
                "cooldownUntil": cooldown["cooldownUntil"] if cooldown else None,
                "cacheWrite": None,
            }

        payload = payload if isinstance(payload, dict) else {}
        if self.is_block_response(payload):
            cooldown = self.plan_block_cooldown(config, state, now_ms)
            return {
                "ok": True,
                "error": "",
                "blocked": True,
                "consecutiveBlocks": cooldown["consecutiveBlocks"],
                "cooldownUntil": cooldown["cooldownUntil"],
                "cacheWrite": None,
            }

        cache = self.plan_response_cache(
            url=url,
            referer=referer,
            request_cookie=request_cookie,
            config=config,
            now_ms=now_ms,
            payload=payload,
        )
        write = cache.get("write") if payload.get("code") == 0 else None
        cache_write = {"key": cache.get("key"), **write} if isinstance(write, dict) else None
        return {
            "ok": True,
            "error": "",
            "blocked": False,
            "consecutiveBlocks": 0 if payload.get("code") == 0 else self._number(state.get("consecutiveBlocks"), 0),
            "cooldownUntil": None,
            "cacheWrite": cache_write,
        }

    def plan_fetch_timeout(
        self,
        url: Any,
        config: dict[str, Any] | None = None,
        has_abort_controller: bool = True,
        has_abort_signal_any: bool = False,
        caller_signal: bool = False,
        caller_aborted: bool = False,
    ) -> dict[str, Any]:
        cfg = {**self.build_crawler_config({}), **(config if isinstance(config, dict) else {})}
        timeout_ms = max(0, self._number(cfg.get("requestTimeoutMs"), 30000))
        uses_abort_controller = bool(timeout_ms and has_abort_controller)
        combines_signals = bool(uses_abort_controller and caller_signal and has_abort_signal_any)
        return {
            "timeoutMs": timeout_ms,
            "usesAbortController": uses_abort_controller,
            "forwardsCallerSignal": bool(caller_signal),
            "combinesSignals": combines_signals,
            "timeoutError": f"Bilibili request timed out after {timeout_ms}ms: {url}" if uses_abort_controller else "",
        }

    def capture_set_cookies(
        self,
        set_cookie_headers: list[Any] | None = None,
        cookie_jar: dict[str, Any] | None = None,
    ) -> dict[str, str]:
        captured = {
            str(name): str(value)
            for name, value in (cookie_jar if isinstance(cookie_jar, dict) else {}).items()
            if str(name or "").strip() and str(value or "").strip()
        }
        for line in set_cookie_headers if isinstance(set_cookie_headers, list) else []:
            first = str(line or "").split(";")[0]
            eq = first.find("=")
            if eq <= 0:
                continue
            name = first[:eq].strip()
            value = first[eq + 1 :].strip()
            if name and value:
                captured[name] = value
        return captured

    def plan_response_cache(
        self,
        url: Any,
        referer: Any = "https://www.bilibili.com",
        request_cookie: Any = "",
        config: dict[str, Any] | None = None,
        cached: dict[str, Any] | None = None,
        now_ms: Any = 0,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        cfg = {**self.build_crawler_config({}), **(config if isinstance(config, dict) else {})}
        ttl_ms = max(0, self._number(cfg.get("cacheTtlMs"), 300000))
        key = "" if self.normalize_bilibili_cookie(request_cookie) else self.cache_key(url, referer)
        now = self._number(now_ms, 0)
        if key and ttl_ms > 0 and isinstance(cached, dict) and self._number(cached.get("expiresAt"), 0) > now:
            return {"key": key, "hit": True, "payload": cached.get("payload"), "write": None}
        write = None
        if key and ttl_ms > 0 and isinstance(payload, dict) and payload.get("code") == 0:
            write = {"expiresAt": now + ttl_ms, "payload": payload}
        return {"key": key, "hit": False, "payload": None, "write": write}

    def cache_key(self, url: Any, referer: Any = "") -> str:
        return f"{referer or ''} {str(url)}"

    def plan_request_schedule(
        self,
        config: dict[str, Any] | None = None,
        state: dict[str, Any] | None = None,
        now_ms: Any = 0,
        random_values: list[Any] | None = None,
    ) -> dict[str, int]:
        cfg = {**self.build_crawler_config({}), **(config if isinstance(config, dict) else {})}
        state = state if isinstance(state, dict) else {}
        randoms = iter(random_values if isinstance(random_values, list) else [])
        now = self._number(now_ms, 0)
        cooldown_until = self._number(state.get("cooldownUntil"), 0)
        next_request_at = self._number(state.get("nextRequestAt"), 0)
        wait_ms = max(0, max(cooldown_until, next_request_at) - now)
        effective_now = now + wait_ms

        long_pause_ms = 0
        long_pause_probability = self._bounded_float(cfg.get("longPauseProbability"), 0.15, 0, 1)
        long_pause_min_ms = self._number(cfg.get("longPauseMinMs"), 3000)
        long_pause_max_ms = self._number(cfg.get("longPauseMaxMs"), 8000)
        if (
            long_pause_probability > 0
            and long_pause_max_ms > long_pause_min_ms
            and self._next_random(randoms) > 1 - long_pause_probability
        ):
            long_pause_ms = long_pause_min_ms + math.floor(
                self._next_random(randoms) * (long_pause_max_ms - long_pause_min_ms)
            )
            effective_now += long_pause_ms

        jitter_cap = max(0, self._number(cfg.get("jitterMs"), 2000))
        jitter_ms = math.floor(self._next_random(randoms) * jitter_cap)
        return {
            "waitMs": wait_ms,
            "longPauseMs": long_pause_ms,
            "jitterMs": jitter_ms,
            "nextRequestAt": effective_now + max(0, self._number(cfg.get("minDelayMs"), 2500)) + jitter_ms,
            "cooldownUntil": cooldown_until,
        }

    def plan_block_cooldown(
        self,
        config: dict[str, Any] | None = None,
        state: dict[str, Any] | None = None,
        now_ms: Any = 0,
    ) -> dict[str, int]:
        cfg = {**self.build_crawler_config({}), **(config if isinstance(config, dict) else {})}
        state = state if isinstance(state, dict) else {}
        consecutive_blocks = self._number(state.get("consecutiveBlocks"), 0) + 1
        multiplier = min(2 ** (consecutive_blocks - 1), 8)
        cooldown_ms = max(0, self._number(cfg.get("blockCooldownMs"), 120000))
        return {
            "consecutiveBlocks": consecutive_blocks,
            "cooldownMultiplier": multiplier,
            "cooldownUntil": self._number(now_ms, 0) + cooldown_ms * multiplier,
        }

    def build_request_headers(
        self,
        url: Any,
        referer: Any = "https://www.bilibili.com",
        request_cookie: Any = "",
        synthetic_cookie: dict[str, Any] | None = None,
        user_agent: Any = DEFAULT_USER_AGENT,
    ) -> dict[str, str]:
        ua = str(user_agent or DEFAULT_USER_AGENT)
        referer_text = str(referer or "https://www.bilibili.com")
        headers = {
            "user-agent": ua,
            "referer": referer_text,
            "origin": self._origin(referer_text),
            "accept": "application/json, text/plain, */*",
            "accept-language": ACCEPT_LANGUAGE,
            "cache-control": "no-cache",
            "pragma": "no-cache",
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"' if "Macintosh" in ua else '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": self.site_relation(url, referer_text),
        }
        cookie = self.cookie_header(request_cookie, synthetic_cookie)
        if cookie:
            headers["cookie"] = cookie
        return headers

    def site_relation(self, url: Any, referer: Any) -> str:
        url_parts = urlparse(str(url or ""))
        referer_parts = urlparse(str(referer or ""))
        if not url_parts.netloc or not referer_parts.netloc:
            return "cross-site"
        if url_parts.netloc == referer_parts.netloc:
            return "same-origin"
        url_base = ".".join(url_parts.hostname.split(".")[-2:]) if url_parts.hostname else ""
        referer_base = ".".join(referer_parts.hostname.split(".")[-2:]) if referer_parts.hostname else ""
        return "same-site" if url_base and url_base == referer_base else "cross-site"

    def _platform_for_user_agent(self, user_agent: Any) -> str:
        return "macOS" if "Macintosh" in str(user_agent or "") else "Windows"

    def cookie_header(self, request_cookie: Any = "", synthetic_cookie: dict[str, Any] | None = None) -> str:
        merged: dict[str, str] = {}
        for name, value in (synthetic_cookie or {}).items():
            name_text = str(name or "").strip()
            value_text = str(value or "").strip()
            if name_text and value_text:
                merged[name_text] = value_text
        merged.update(self._cookie_pairs(request_cookie))
        return "; ".join(f"{name}={value}" for name, value in merged.items())

    def make_synthetic_cookie_jar(self, random_fn: Any | None = None, now_ms: Any | None = None) -> dict[str, str]:
        rand = random_fn if callable(random_fn) else (lambda: 0.5)
        now_value = self._number(now_ms, 0) if now_ms is not None else 0
        epoch = int(now_value // 1000)

        def random_hex(length: int) -> str:
            chars = []
            for _index in range(length):
                value = max(0, min(int(float(rand()) * 16), 15))
                chars.append(format(value, "x").upper())
            return "".join(chars)

        return {
            "buvid3": f"{random_hex(8)}-{random_hex(4)}-{random_hex(4)}-{random_hex(4)}-{random_hex(13)}infoc",
            "buvid4": f"{random_hex(8)}-{random_hex(4)}-{random_hex(4)}-{random_hex(4)}-{random_hex(12)}-{epoch}-1",
            "b_nut": str(epoch),
            "_uuid": f"{random_hex(8)}-{random_hex(4)}-{random_hex(4)}-{random_hex(4)}-{random_hex(15)}infoc",
            "b_lsid": f"{random_hex(8)}_{random_hex(10)}",
            "bsource": "search_bing",
            "home_feed": "recommend",
        }

    def parse_bvid_pool(self, raw: Any = "") -> list[str]:
        text = str(raw or "")
        return [
            item.strip()
            for item in re.split(r"[\s,，、;|锛]+", text)
            if re.fullmatch(r"BV[0-9A-Za-z]+", item.strip())
        ]

    def extract_bvid(self, value: Any = "") -> str:
        match = re.search(r"BV[0-9A-Za-z]+", str(value or "").strip())
        return match.group(0) if match else ""

    def is_block_response(self, payload: dict[str, Any] | None = None) -> bool:
        payload = payload or {}
        try:
            code = int(float(payload.get("code")))
        except (TypeError, ValueError):
            return False
        return code in BLOCK_CODES

    def normalize_bilibili_cookie(self, value: Any = "") -> str:
        parts = []
        for part in re.split(r";\s*", str(value or "")):
            part = part.strip()
            eq = part.find("=")
            if eq <= 0:
                continue
            name = part[:eq].strip()
            cookie_value = part[eq + 1 :].strip()
            if not name or not cookie_value:
                continue
            if re.search(r"[\r\n:]", name) or re.search(r"[\r\n]", cookie_value):
                continue
            parts.append(f"{name}={cookie_value}")
        return "; ".join(parts)

    def _cookie_pairs(self, value: Any = "") -> dict[str, str]:
        pairs: dict[str, str] = {}
        for part in re.split(r";\s*", self.normalize_bilibili_cookie(value)):
            eq = part.find("=")
            if eq <= 0:
                continue
            pairs[part[:eq].strip()] = part[eq + 1 :].strip()
        return pairs

    def collect_reply_for_uid(
        self,
        reply: dict[str, Any] | None,
        target_uid: Any,
        obj: dict[str, Any] | None,
        bucket: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        bucket = bucket if bucket is not None else []
        if not isinstance(reply, dict) or not isinstance(reply.get("content"), dict) or not isinstance(reply.get("member"), dict):
            return bucket
        obj = obj if isinstance(obj, dict) else {}
        member = reply.get("member") or {}
        mid = str(reply.get("mid") or member.get("mid") or "")
        if mid == str(target_uid):
            bucket.append(self._reply_record(reply, obj, mid))
        for child in reply.get("replies") if isinstance(reply.get("replies"), list) else []:
            self.collect_reply_for_uid(child, target_uid, obj, bucket)
        return bucket

    def dedupe_public_objects(self, objects: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for obj in objects if isinstance(objects, list) else []:
            if not isinstance(obj, dict) or not obj.get("oid"):
                continue
            reply_type = self._number(obj.get("replyType"), 1)
            oid = str(obj.get("oid") or "")
            key = f"{reply_type}:{oid}"
            if key in seen:
                continue
            seen.add(key)
            unique.append({**obj, "oid": oid, "replyType": reply_type})
        return unique

    def parse_danmaku_xml(self, xml: Any = "", video: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        video = video if isinstance(video, dict) else {}
        items: list[dict[str, Any]] = []
        text = str(xml or "")
        pattern = re.compile(r'<d\b[^>]*p="([^"]*)"[^>]*>([\s\S]*?)</d>', re.IGNORECASE)
        index = 0
        for match in pattern.finditer(text):
            message = re.sub(r"\s+", " ", html.unescape(match.group(2))).strip()
            if not message:
                continue
            meta = str(match.group(1) or "").split(",")
            items.append(
                {
                    "bvid": video.get("bvid"),
                    "oid": str(video.get("oid") or ""),
                    "replyType": self._number(video.get("replyType"), 1),
                    "sourceTitle": video.get("title") or "",
                    "sourceUrl": video.get("sourceUrl") or "",
                    "rpid": f"danmaku-{video.get('cid') or video.get('oid') or video.get('bvid')}-{index}",
                    "like": 0,
                    "ctime": self._number(meta[4] if len(meta) > 4 else 0, 0),
                    "uname": "",
                    "mid": str(meta[6] if len(meta) > 6 else ""),
                    "message": message,
                    "kind": "danmaku",
                }
            )
            index += 1
        return items

    def extract_dynamic_records(self, items: list[dict[str, Any]] | None = None, uid: Any = "") -> dict[str, list[dict[str, Any]]]:
        objects: list[dict[str, Any]] = []
        authored_posts: list[dict[str, Any]] = []
        uid_text = str(uid or "")

        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            dynamic_id = str(item.get("id_str") or item.get("id") or "")
            basic = item.get("basic") if isinstance(item.get("basic"), dict) else {}
            comment_type = self._number(basic.get("comment_type"), 0)
            comment_oid = str(basic.get("comment_id_str") or basic.get("comment_id") or "")
            text = self._dynamic_text(item)
            title = self._dynamic_title(item, text)
            source_url = f"https://t.bilibili.com/{dynamic_id}" if dynamic_id else f"https://space.bilibili.com/{uid_text}/dynamic"

            if text:
                authored_posts.append(
                    {
                        "sourceKind": "dynamic-post",
                        "oid": comment_oid or dynamic_id,
                        "replyType": comment_type or 17,
                        "sourceTitle": title,
                        "sourceUrl": source_url,
                        "rpid": f"dynamic-{dynamic_id or comment_oid}",
                        "like": 0,
                        "ctime": self._number(self._path(item, "modules", "module_author", "pub_ts"), 0),
                        "uname": self._path(item, "modules", "module_author", "name") or "",
                        "mid": uid_text,
                        "message": text,
                    }
                )

            if comment_type > 0 and comment_oid:
                objects.append(
                    {
                        "id": f"dynamic-{comment_type}-{comment_oid}",
                        "kind": "dynamic",
                        "oid": comment_oid,
                        "replyType": comment_type,
                        "title": f"\u52a8\u6001\uff1a{self._text_snippet(title, comment_oid)}",
                        "authorMid": uid_text,
                        "sourceUrl": source_url,
                        "replyCount": self._number(self._path(item, "modules", "module_stat", "comment", "count"), 0),
                    }
                )

        return {"objects": objects, "authoredPosts": authored_posts}

    def _reply_record(self, reply: dict[str, Any], obj: dict[str, Any], mid: str) -> dict[str, Any]:
        member = reply.get("member") or {}
        content = reply.get("content") or {}
        return {
            "sourceKind": obj.get("kind"),
            "bvid": obj.get("bvid"),
            "oid": str(obj.get("oid") or ""),
            "replyType": self._number(obj.get("replyType"), 1),
            "sourceTitle": obj.get("title") or "",
            "sourceUrl": obj.get("sourceUrl") or "",
            "rpid": str(reply.get("rpid") or ""),
            "like": self._number(reply.get("like"), 0),
            "ctime": self._number(reply.get("ctime"), 0),
            "uname": member.get("uname") or "",
            "mid": mid,
            "message": content.get("message") or "",
        }

    def _dynamic_text(self, item: dict[str, Any]) -> str:
        dynamic = self._path(item, "modules", "module_dynamic")
        dynamic = dynamic if isinstance(dynamic, dict) else {}
        major = dynamic.get("major") if isinstance(dynamic.get("major"), dict) else {}
        opus = major.get("opus") if isinstance(major.get("opus"), dict) else {}
        archive = major.get("archive") if isinstance(major.get("archive"), dict) else {}
        article = major.get("article") if isinstance(major.get("article"), dict) else {}
        values = [
            self._path(dynamic, "desc", "text"),
            self._path(opus, "summary", "text"),
            opus.get("title"),
            archive.get("desc"),
            archive.get("title"),
            article.get("desc"),
            article.get("title"),
        ]
        return str(next((value for value in values if value), "")).strip()

    def _dynamic_title(self, item: dict[str, Any], text: str) -> str:
        dynamic = self._path(item, "modules", "module_dynamic")
        dynamic = dynamic if isinstance(dynamic, dict) else {}
        major = dynamic.get("major") if isinstance(dynamic.get("major"), dict) else {}
        archive = major.get("archive") if isinstance(major.get("archive"), dict) else {}
        article = major.get("article") if isinstance(major.get("article"), dict) else {}
        opus = major.get("opus") if isinstance(major.get("opus"), dict) else {}
        title = archive.get("title") or article.get("title") or opus.get("title")
        return str(title or self._text_snippet(text, f"\u52a8\u6001 {item.get('id_str') or item.get('id') or ''}"))

    def _text_snippet(self, text: Any, fallback: Any) -> str:
        clean = re.sub(r"\s+", " ", str(text or "")).strip()
        if not clean:
            return str(fallback)
        return f"{clean[:48]}..." if len(clean) > 48 else clean

    def _path(self, value: Any, *keys: str) -> Any:
        current = value
        for key in keys:
            if not isinstance(current, dict):
                return None
            current = current.get(key)
        return current

    def _origin(self, referer: str) -> str:
        parts = urlparse(referer)
        if parts.scheme and parts.netloc:
            return f"{parts.scheme}://{parts.netloc}"
        return "https://www.bilibili.com"

    def _next_random(self, values: Any) -> float:
        try:
            value = next(values)
        except StopIteration:
            value = 0
        return self._bounded_float(value, 0, 0, 1)

    def _bounded_float(self, value: Any, fallback: float, minimum: float, maximum: float) -> float:
        try:
            number = float(str(value))
        except (TypeError, ValueError):
            number = fallback
        if not math.isfinite(number):
            number = fallback
        return max(minimum, min(number, maximum))

    def _number(self, value: Any, fallback: int = 0) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return fallback
