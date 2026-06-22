from __future__ import annotations

import argparse
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from python_backend.corpus.loader import CorpusLoader
from python_backend.corpus.dictionary import DictionaryLoader


@dataclass(frozen=True)
class AnalyzerRequest:
    comments: list[str]
    keyword_hints: list[Any] = field(default_factory=list)
    uid: str = "unknown"
    name: str = "unknown"
    model: str = "deepseek-v4-flash"
    effort: str = "max"
    multiagent: bool = False


class DeepSeekAnalyzerClient:
    """Build JS-compatible DeepSeek analyzer request contracts."""

    MULTIAGENTS = (
        {
            "id": "lexical-context",
            "name": "Lexical and emoji context analyst",
            "focus": (
                "Explain the literal wording, Bilibili slang, emoji/bracket-emote tone, "
                "meme/copypasta function, and whether any keyword hit is actually meaningful "
                "in the complete sentence."
            ),
        },
        {
            "id": "speech-act",
            "name": "Full sentence speech-act analyst",
            "focus": (
                "Analyze each complete sentence as a speech act: target, stance, satire, "
                "burden of proof, cooperation, correction, and how the sentence maps to radar axes."
            ),
        },
        {
            "id": "skeptic",
            "name": "False-positive and quality skeptic",
            "focus": (
                "Challenge overconfident keyword-only readings, reject hallucinated quotes, "
                "identify ambiguity, and mark unsupported axis scores as neutral."
            ),
        },
    )

    def build_request_from_payload(self, payload: dict[str, Any] | None = None) -> AnalyzerRequest:
        payload = payload if isinstance(payload, dict) else {}
        return AnalyzerRequest(
            comments=self._comments_from_payload(payload),
            keyword_hints=self._keyword_hints_from_payload(payload),
            uid=str(payload.get("uid") or "unknown"),
            name=str(payload.get("name") or "unknown"),
            model=str(payload.get("model") or "deepseek-v4-flash"),
            effort=str(payload.get("reasoningEffort") or payload.get("reasoning_effort") or payload.get("effort") or "max"),
            multiagent=payload.get("multiagent") is True or payload.get("multiAgent") is True,
        )

    def build_payload(self, request: AnalyzerRequest) -> dict[str, object]:
        return {
            "model": request.model,
            "effort": request.effort,
            "uid": request.uid or "unknown",
            "name": request.name or "unknown",
            "comments": self._split_sentences("\n".join(request.comments)),
            "keywordHints": self._normalize_hints(request.keyword_hints),
            "multiagent": request.multiagent,
        }

    def build_chat_request(self, request: AnalyzerRequest, *, compact: bool = False) -> dict[str, object]:
        return self._chat_body(
            request,
            self._standalone_messages(request, compact=compact),
            max_tokens=6000 if compact else 2000,
        )

    def build_request_plan(self, request: AnalyzerRequest, *, compact: bool = False) -> list[dict[str, object]]:
        if not request.multiagent:
            return [self.build_chat_request(request, compact=compact)]
        return [
            self._chat_body(
                request,
                self._multiagent_messages(request, agent=agent, compact=compact),
                max_tokens=1600,
            )
            for agent in self.MULTIAGENTS
        ]

    def build_merge_request(self, request: AnalyzerRequest, agent_results: list[dict[str, Any]], *, compact: bool = False) -> dict[str, object]:
        return self._chat_body(
            request,
            self._merge_messages(request, agent_results, compact=compact),
            max_tokens=6000 if compact else 2600,
        )

    def _chat_body(self, request: AnalyzerRequest, messages: list[dict[str, str]], *, max_tokens: int) -> dict[str, object]:
        return {
            "model": request.model,
            "reasoning_effort": request.effort,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "stream": False,
            "max_tokens": max_tokens,
        }

    def _standalone_messages(self, request: AnalyzerRequest, *, compact: bool) -> list[dict[str, str]]:
        input_payload = self._analysis_input(request, compact=compact)
        return [
            {
                "role": "system",
                "content": (
                    "You are a standalone Chinese online speech-act analyzer. Analyze complete "
                    "comments directly. Return valid JSON only; no markdown."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Analyze the comments below as a STANDALONE full-sentence psychologist/speech-act analyzer.\n\n"
                    "Authoritative input is the complete sentence/comment text. Keyword hints are optional, non-binding context only:\n"
                    "- Do not assign radar/personality scores from keyword hits alone.\n"
                    "- Do not let dictionary terms override the full sentence speech act.\n"
                    "- A score or risk label is valid only when it cites an original quote and explains the complete sentence context.\n"
                    "- Emoji, Bilibili bracket emotes, ASCII emoticons, and repeated punctuation are part of sentence tone, not decoration and not standalone proof of hostility.\n"
                    "- If a hostile-looking word is a meme, quote, copypasta, title, self-reference, or playful marker, keep risk neutral/low unless the full sentence attacks a concrete target.\n"
                    "- If evidence is insufficient for an axis, use a neutral 40-60 score and say evidence is insufficient.\n\n"
                    "Input JSON:\n"
                    f"{json.dumps(input_payload, ensure_ascii=False, indent=2)}\n\n"
                    "Return JSON with axes, sentenceAnalyses, overall, and confidence. "
                    "sentenceAnalyses.quote and axis evidence must be exact original quotes."
                ),
            },
        ]

    def _multiagent_messages(self, request: AnalyzerRequest, *, agent: dict[str, str], compact: bool) -> list[dict[str, str]]:
        input_payload = self._analysis_input(request, compact=compact)
        return [
            {
                "role": "system",
                "content": (
                    "You are one specialist agent in a multi-agent Chinese online speech-act "
                    "analysis pipeline. Return valid JSON only; no markdown."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Agent role: {agent['name']}\n"
                    f"Agent focus: {agent['focus']}\n\n"
                    "Analyze only from the complete sentence/comment text. Keyword hints are optional and non-binding.\n"
                    "Emoji and Bilibili bracket emotes are semantic tone markers, especially for satire, sarcasm, face-saving joking, mockery, and onlooker stance.\n"
                    "Do not treat a keyword or emoji alone as proof of hostility. Preserve original quotes exactly.\n\n"
                    "Input JSON:\n"
                    f"{json.dumps(input_payload, ensure_ascii=False, indent=2)}\n\n"
                    "Return JSON with agentId, observations, axisSuggestions, and risks."
                ),
            },
        ]

    def _merge_messages(self, request: AnalyzerRequest, agent_results: list[dict[str, Any]], *, compact: bool) -> list[dict[str, str]]:
        input_payload = self._analysis_input(request, compact=compact)
        outputs = [
            {
                "agentId": result.get("id"),
                "name": result.get("name"),
                "ok": bool(result.get("ok")),
                "parsed": result.get("parsed"),
                "error": result.get("error", ""),
            }
            for result in agent_results
        ]
        return [
            {
                "role": "system",
                "content": (
                    "You are the merge and quality-control agent for Chinese online speech-act "
                    "analysis. Return valid JSON only; no markdown."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Merge the specialist agent outputs into one final standalone analysis.\n\n"
                    "Quality rules:\n"
                    "- The complete sentence/comment text is authoritative.\n"
                    "- Keep only claims supported by exact source quotes from Input JSON.\n"
                    "- Resolve disagreements conservatively. If evidence is weak, use neutral 40-60 axis scores and say evidence is insufficient.\n"
                    "- Reject hallucinated quotes, keyword-only claims, and emoji-only hostility claims.\n"
                    "- Preserve emoji/bracket-emote tone analysis when it changes satire, sarcasm, joking, mockery, or indirect stance.\n"
                    "- Output the same final schema as the single-agent analyzer.\n\n"
                    "Input JSON:\n"
                    f"{json.dumps(input_payload, ensure_ascii=False, indent=2)}\n\n"
                    "Specialist agent outputs:\n"
                    f"{json.dumps(outputs, ensure_ascii=False, indent=2)}"
                ),
            },
        ]

    def _analysis_input(self, request: AnalyzerRequest, *, compact: bool) -> dict[str, object]:
        limit = 40 if compact else 80
        return {
            "uid": request.uid or "unknown",
            "name": request.name or "unknown",
            "comments": self._split_sentences("\n".join(request.comments))[:limit],
            "keywordHints": self._normalize_hints(request.keyword_hints),
        }

    def _normalize_hints(self, hints: list[Any]) -> list[dict[str, str]]:
        normalized = []
        seen = set()
        for hint in hints:
            if isinstance(hint, str):
                item = {"term": hint.strip(), "family": "", "meaning": ""}
            elif isinstance(hint, dict):
                item = {
                    "term": str(hint.get("term") or hint.get("keyword") or hint.get("text") or "").strip(),
                    "family": str(hint.get("family") or hint.get("axis") or "").strip(),
                    "meaning": str(hint.get("meaning") or hint.get("reason") or hint.get("description") or "").strip(),
                }
            else:
                continue
            key = (item["term"], item["family"], item["meaning"])
            if item["term"] and key not in seen:
                seen.add(key)
                normalized.append(item)
            if len(normalized) >= 80:
                break
        return normalized

    def _keyword_hints_from_payload(self, payload: dict[str, Any]) -> list[Any]:
        explicit_hints = payload.get("keywordHints") or payload.get("keyword_hints")
        if isinstance(explicit_hints, list):
            return list(explicit_hints)
        dictionary = payload.get("dictionary")
        if isinstance(dictionary, dict) and isinstance(dictionary.get("entries"), list):
            return self._dictionary_entries_to_hints(dictionary["entries"])
        if payload.get("dictionaryPath"):
            return self._dictionary_entries_to_hints(DictionaryLoader.load_from_payload(payload).entries)
        return []

    def _dictionary_entries_to_hints(self, entries: list[Any]) -> list[dict[str, Any]]:
        hints = []
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            key = (
                str(entry.get("term") or entry.get("keyword") or entry.get("text") or "").strip(),
                str(entry.get("family") or entry.get("axis") or "").strip(),
            )
            if key[0] and key not in seen:
                seen.add(key)
                hints.append(entry)
        return hints

    def _comments_from_payload(self, payload: dict[str, Any]) -> list[str]:
        if isinstance(payload.get("comments"), list):
            comments = []
            for item in payload["comments"]:
                text = self._comment_text(item)
                if text:
                    comments.append(text)
            return comments
        if isinstance(payload.get("corpus"), dict) or payload.get("corpusPath"):
            corpus = CorpusLoader.load_from_payload(payload)
            return [text for item in corpus.comments if (text := self._comment_text(item))]
        text = str(payload.get("text") or payload.get("fullText") or "").strip()
        return [text] if text else []

    def _comment_text(self, item: Any) -> str:
        if isinstance(item, dict):
            for key in ("message", "text", "commentText", "combinedText", "content"):
                text = str(item.get(key) or "").strip()
                if text:
                    return text
            return ""
        return str(item or "").strip()

    def _split_sentences(self, text: str) -> list[str]:
        values = []
        seen = set()
        for line in re.split(r"[\r\n]+", str(text or "")):
            for sentence in re.split(r"(?<=[。！？!?;；])", line):
                sentence = sentence.strip()
                if sentence and sentence not in seen:
                    seen.add(sentence)
                    values.append(sentence)
        return values


class DeepSeekAnalysisValidator:
    """Validate DeepSeek analysis JSON against the original source comments."""

    def validate_payloads(self, source_payload: dict[str, Any] | None = None, analysis_payload: dict[str, Any] | None = None) -> dict[str, Any]:
        source_payload = source_payload if isinstance(source_payload, dict) else {}
        analysis_payload = analysis_payload if isinstance(analysis_payload, dict) else {}
        return self.validate(self._comments_from_payload(source_payload), self._analysis_from_payload(analysis_payload))

    def validate(self, comments: list[str], analysis: dict[str, Any]) -> dict[str, Any]:
        source_sentences = self._source_sentences(comments)
        source_normalized = [self._normalize_quote(sentence) for sentence in source_sentences]
        sentence_analyses = analysis.get("sentenceAnalyses") if isinstance(analysis.get("sentenceAnalyses"), list) else []
        axes = analysis.get("axes") if isinstance(analysis.get("axes"), list) else []
        unsupported_quotes = self._unsupported_sentence_quotes(sentence_analyses, source_normalized)
        unsupported_axis_evidence = self._unsupported_axis_evidence(axes, source_normalized)
        summary = {
            "sourceSentences": len(source_sentences),
            "sentenceAnalyses": len(sentence_analyses),
            "axes": len(axes),
            "unsupportedQuotes": len(unsupported_quotes),
            "unsupportedAxisEvidence": len(unsupported_axis_evidence),
        }
        return {
            "ok": not unsupported_quotes and not unsupported_axis_evidence,
            "summary": summary,
            "unsupportedQuotes": unsupported_quotes,
            "unsupportedAxisEvidence": unsupported_axis_evidence,
        }

    def _source_sentences(self, comments: list[str]) -> list[str]:
        return DeepSeekAnalyzerClient()._split_sentences("\n".join(str(comment) for comment in comments))

    def _comments_from_payload(self, payload: dict[str, Any]) -> list[str]:
        return DeepSeekAnalyzerClient()._comments_from_payload(payload)

    def _analysis_from_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        parsed = payload.get("parsed")
        if isinstance(parsed, dict):
            return parsed
        analysis = payload.get("analysis")
        if isinstance(analysis, dict):
            return analysis
        return payload

    def _unsupported_sentence_quotes(self, sentence_analyses: list[Any], source_normalized: list[str]) -> list[dict[str, str]]:
        unsupported = []
        for index, item in enumerate(sentence_analyses):
            if not isinstance(item, dict):
                continue
            quote = str(item.get("quote") or item.get("text") or "").strip()
            if quote and not self._is_supported_quote(quote, source_normalized):
                unsupported.append({"path": f"sentenceAnalyses[{index}].quote", "quote": quote})
        return unsupported

    def _unsupported_axis_evidence(self, axes: list[Any], source_normalized: list[str]) -> list[dict[str, str]]:
        unsupported = []
        for index, axis in enumerate(axes):
            if not isinstance(axis, dict):
                continue
            axis_name = str(axis.get("axis") or axis.get("name") or "").strip()
            for evidence in self._axis_evidence_values(axis):
                if evidence and not self._is_supported_quote(evidence, source_normalized):
                    unsupported.append({"path": f"axes[{index}].evidence", "quote": evidence, "axis": axis_name})
        return unsupported

    def _axis_evidence_values(self, axis: dict[str, Any]) -> list[str]:
        raw = axis.get("evidence")
        if raw is None:
            raw = axis.get("quote")
        if isinstance(raw, list):
            return [str(item).strip() for item in raw if str(item).strip()]
        if isinstance(raw, dict):
            values = []
            for key in ("quote", "text", "evidence"):
                value = str(raw.get(key) or "").strip()
                if value:
                    values.append(value)
            return values
        value = str(raw or "").strip()
        return [value] if value else []

    def _is_supported_quote(self, quote: str, source_normalized: list[str]) -> bool:
        normalized_quote = self._normalize_quote(quote)
        return bool(normalized_quote) and any(normalized_quote in sentence for sentence in source_normalized)

    def _normalize_quote(self, text: str) -> str:
        return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(text or "")).lower())


class DeepSeekAnalysisPlanSummary:
    """Shape DeepSeek request plans into the JS/Python comparator summary contract."""

    REQUEST_KEYS = ("model", "reasoning_effort", "max_tokens")

    def summarize(self, plan: dict[str, Any] | None = None) -> dict[str, Any]:
        plan = plan if isinstance(plan, dict) else {}
        requests = plan.get("requests") if isinstance(plan.get("requests"), list) else []
        return {
            "mode": plan.get("mode"),
            "requestCount": len(requests),
            "requests": [
                {key: request.get(key) for key in self.REQUEST_KEYS if isinstance(request, dict)}
                for request in requests
            ],
        }


class DeepSeekAnalysisPlanRunner:
    """Emit Python-built DeepSeek analyzer request plans for JS orchestration."""

    def __init__(self, payload_path: str | Path, compact: bool = False):
        self.payload_path = Path(payload_path)
        self.compact = compact
        self.client = DeepSeekAnalyzerClient()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        request = self.client.build_request_from_payload(payload)
        requests = self.client.build_request_plan(request, compact=self.compact)
        if request.multiagent:
            return {
                "ok": True,
                "mode": "multiagent",
                "requests": requests,
                "merge": {
                    "mergeAgent": "quality-merge",
                    "requestTemplate": self.client.build_merge_request(request, [], compact=self.compact),
                },
            }
        return {
            "ok": True,
            "mode": "single",
            "requests": requests,
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class DeepSeekAnalysisPlanContractComparator:
    """Compare Python-built DeepSeek request plans against saved JS-compatible plans."""

    def __init__(self, payload_path: str | Path, js_plan_path: str | Path, compact: bool = False):
        self.payload_path = Path(payload_path)
        self.js_plan_path = Path(js_plan_path)
        self.compact = compact
        self.summary = DeepSeekAnalysisPlanSummary()

    def compare(self) -> dict[str, Any]:
        python_plan = DeepSeekAnalysisPlanRunner(self.payload_path, compact=self.compact).run()
        js_plan = self._read_js_plan()
        mismatches = self._mismatches(python_plan, js_plan)
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_plan),
            "js": self.summary.summarize(js_plan),
        }

    def _read_js_plan(self) -> dict[str, Any]:
        with self.js_plan_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _mismatches(self, python_plan: dict[str, Any], js_plan: dict[str, Any]) -> list[dict[str, Any]]:
        mismatches: list[dict[str, Any]] = []
        if "mode" in js_plan and python_plan.get("mode") != js_plan.get("mode"):
            mismatches.append({"key": "mode", "python": python_plan.get("mode"), "js": js_plan.get("mode")})
        python_requests = python_plan.get("requests") if isinstance(python_plan.get("requests"), list) else []
        js_requests = js_plan.get("requests") if isinstance(js_plan.get("requests"), list) else []
        if "requests" in js_plan and len(python_requests) != len(js_requests):
            mismatches.append({"key": "requestCount", "python": len(python_requests), "js": len(js_requests)})
        for index, (python_request, js_request) in enumerate(zip(python_requests, js_requests)):
            if not isinstance(python_request, dict) or not isinstance(js_request, dict):
                continue
            for key in self.summary.REQUEST_KEYS:
                if key in js_request and python_request.get(key) != js_request.get(key):
                    mismatches.append({"key": f"requests[{index}].{key}", "python": python_request.get(key), "js": js_request.get(key)})
        return mismatches


@dataclass(frozen=True)
class DeepSeekAnalysisPlanRequest:
    """Analyzer-layer request object for DeepSeek plan JSON contract modes."""

    payload_path: str | Path
    compact: bool = False
    compare_js_plan_path: str | Path | None = None

    def run(self) -> dict[str, Any]:
        if self.compare_js_plan_path:
            return DeepSeekAnalysisPlanContractComparator(
                self.payload_path,
                self.compare_js_plan_path,
                compact=self.compact,
            ).compare()
        return DeepSeekAnalysisPlanRunner(self.payload_path, compact=self.compact).run()


class DeepSeekAnalysisPlanCommandRequest:
    """Parse CLI argv for DeepSeek plan generation while keeping ownership in analyzers."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a Python-owned DeepSeek analyzer request plan from a JS-compatible JSON payload.")
        parser.add_argument("--payload", required=True, help="Path to a JSON payload containing text/comments and optional keywordHints.")
        parser.add_argument("--compact", action="store_true", help="Build the compact retry prompt variant.")
        parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible DeepSeek plan JSON to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return DeepSeekAnalysisPlanRequest(
            payload_path=args.payload,
            compact=args.compact,
            compare_js_plan_path=args.compare_js_plan or None,
        ).run()


class DeepSeekAnalysisValidationSummary:
    """Shape DeepSeek validation results into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("ok", "summary", "unsupportedQuotes", "unsupportedAxisEvidence")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class DeepSeekAnalysisValidateRunner:
    """Validate a DeepSeek analysis JSON file against the original JS-compatible payload."""

    def __init__(self, payload_path: str | Path, analysis_path: str | Path):
        self.payload_path = Path(payload_path)
        self.analysis_path = Path(analysis_path)
        self.validator = DeepSeekAnalysisValidator()

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.payload_path)
        analysis_payload = self._read_json(self.analysis_path)
        return self.validator.validate_payloads(payload, analysis_payload)

    def _read_json(self, path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class DeepSeekAnalysisValidateContractComparator:
    """Compare Python DeepSeek validation output against a saved JS-compatible report."""

    def __init__(self, payload_path: str | Path, analysis_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.analysis_path = Path(analysis_path)
        self.js_report_path = Path(js_report_path)
        self.summary = DeepSeekAnalysisValidationSummary()

    def compare(self) -> dict[str, Any]:
        python_result = DeepSeekAnalysisValidateRunner(self.payload_path, self.analysis_path).run()
        js_result = self._read_js_report()
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

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


@dataclass(frozen=True)
class DeepSeekAnalysisValidateRequest:
    """Analyzer-layer request object for DeepSeek validation JSON contract modes."""

    payload_path: str | Path
    analysis_path: str | Path
    compare_js_report_path: str | Path | None = None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return DeepSeekAnalysisValidateContractComparator(
                self.payload_path,
                self.analysis_path,
                self.compare_js_report_path,
            ).compare()
        return DeepSeekAnalysisValidateRunner(self.payload_path, self.analysis_path).run()


class DeepSeekAnalysisValidateCommandRequest:
    """Parse CLI argv for DeepSeek validation while keeping request ownership in analyzers."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Validate DeepSeek analysis quotes against source comments.")
        parser.add_argument("--payload", required=True, help="Path to the original JS-compatible analysis payload.")
        parser.add_argument("--analysis", required=True, help="Path to the DeepSeek analysis JSON or wrapper containing parsed/analysis.")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible validation report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return DeepSeekAnalysisValidateRequest(
            payload_path=args.payload,
            analysis_path=args.analysis,
            compare_js_report_path=args.compare_js_report or None,
        ).run()
