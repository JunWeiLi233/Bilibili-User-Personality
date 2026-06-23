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
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


@dataclass(frozen=True)
class AnalyzerRequest:
    comments: list[str]
    keyword_hints: list[Any] = field(default_factory=list)
    source_comments: list[dict[str, str]] = field(default_factory=list)
    uid: str = "unknown"
    name: str = "unknown"
    model: str = "deepseek-v4-flash"
    effort: str = "max"
    multiagent: bool = False


class DeepSeekRequestOptionsContract:
    """Build the stable DeepSeek chat request option payload shared with JS."""

    def __init__(self, request: AnalyzerRequest):
        self.request = request

    def build(self, messages: list[dict[str, str]], *, max_tokens: int) -> dict[str, object]:
        return {
            "model": str(self.request.model or "deepseek-v4-flash"),
            "reasoning_effort": str(self.request.effort or "max"),
            "messages": messages,
            "response_format": {"type": "json_object"},
            "stream": False,
            "max_tokens": self._bounded_max_tokens(max_tokens),
        }

    def _bounded_max_tokens(self, value: object) -> int:
        try:
            tokens = int(float(str(value)))
        except (TypeError, ValueError):
            return 2000
        return max(1, tokens)


class DeepSeekAnalysisInputBuilder:
    """Build the stable input JSON embedded in DeepSeek analyzer prompts."""

    def build(self, request: AnalyzerRequest, *, compact: bool = False) -> dict[str, object]:
        limit = 40 if compact else 80
        return {
            "uid": request.uid or "unknown",
            "name": request.name or "unknown",
            "comments": self._split_sentences("\n".join(request.comments))[:limit],
            "sourceComments": request.source_comments[:limit],
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

    def __init__(self, input_builder: DeepSeekAnalysisInputBuilder | None = None):
        self.input_builder = input_builder or DeepSeekAnalysisInputBuilder()

    def build_request_from_payload(self, payload: dict[str, Any] | None = None) -> AnalyzerRequest:
        payload = payload if isinstance(payload, dict) else {}
        return AnalyzerRequest(
            comments=self._comments_from_payload(payload),
            keyword_hints=self._keyword_hints_from_payload(payload),
            source_comments=self._source_comments_from_payload(payload),
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
            "sourceComments": request.source_comments,
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
        return DeepSeekRequestOptionsContract(request).build(messages, max_tokens=max_tokens)

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
        return self.input_builder.build(request, compact=compact)

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

    def _source_comments_from_payload(self, payload: dict[str, Any]) -> list[dict[str, str]]:
        source_comments: list[dict[str, str]] = []
        comments = payload.get("comments")
        if isinstance(comments, list):
            for item in comments:
                source_comment = self._source_comment(item)
                if source_comment:
                    source_comments.append(source_comment)
            return source_comments
        if isinstance(payload.get("corpus"), dict) or payload.get("corpusPath"):
            corpus = CorpusLoader.load_from_payload(payload)
            for item in corpus.comments:
                source_comment = self._source_comment(item)
                if source_comment:
                    source_comments.append(source_comment)
            return source_comments
        text = str(payload.get("text") or payload.get("fullText") or "").strip()
        return [{"text": text}] if text else []

    def _source_comment(self, item: Any) -> dict[str, str]:
        text = self._comment_text(item)
        if not text:
            return {}
        if not isinstance(item, dict):
            return {"text": text}
        result = {"text": text}
        for source_key in ("source", "uid", "mid", "videoId", "bvid", "threadId", "postId", "url"):
            value = str(item.get(source_key) or "").strip()
            if value:
                result[source_key] = value
        return result

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


class DeepSeekAnalysisNormalizer:
    """Normalize DeepSeek analysis payloads into the JS runtime result contract."""

    AXIS_LABELS = (
        "对抗性动机",
        "认知闭合",
        "证据敏感",
        "逻辑一致",
        "合作讨论",
        "修正意愿",
    )
    AXIS_ALIASES = {
        "attack": AXIS_LABELS[0],
        "antagonism": AXIS_LABELS[0],
        "closure": AXIS_LABELS[1],
        "cognitive_closure": AXIS_LABELS[1],
        "evidence": AXIS_LABELS[2],
        "evidence_sensitivity": AXIS_LABELS[2],
        "logic": AXIS_LABELS[3],
        "logical_consistency": AXIS_LABELS[3],
        "cooperation": AXIS_LABELS[4],
        "collaboration": AXIS_LABELS[4],
        "correction": AXIS_LABELS[5],
        "revision": AXIS_LABELS[5],
    }

    def normalize(
        self,
        source_payload: dict[str, Any] | None = None,
        analysis_payload: dict[str, Any] | None = None,
        *,
        provider: str = "deepseek",
        model: str = "",
        reasoning_effort: str = "medium",
        raw: str = "",
        retried_compact_prompt: bool = False,
        multiagent: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        source_payload = source_payload if isinstance(source_payload, dict) else {}
        analysis_payload = analysis_payload if isinstance(analysis_payload, dict) else {}
        parsed = self._analysis_from_payload(analysis_payload)
        source_text = "\n".join(DeepSeekAnalysisValidator()._comments_from_payload(source_payload))
        axes = self._normalized_axes(parsed, source_text)
        source_sentences = DeepSeekAnalyzerClient()._split_sentences(source_text)
        sentence_analyses = self._sentence_analyses(parsed, source_sentences)
        overall_payload = parsed.get("overall") if isinstance(parsed.get("overall"), dict) else {}
        result: dict[str, Any] = {
            "ok": True,
            "provider": str(provider or "deepseek"),
            "model": str(model or ""),
            "reasoningEffort": str(reasoning_effort or "medium"),
            "retriedCompactPrompt": bool(retried_compact_prompt),
            "axes": axes,
            "sentenceAnalyses": sentence_analyses,
            "overall": {
                "riskBand": str(overall_payload.get("riskBand") or "混合争辩型").strip(),
                "summary": str(overall_payload.get("summary") or "").strip(),
            },
            "confidence": self._clamp_number(parsed.get("confidence"), minimum=0.45, maximum=0.92, default=0.7),
            "raw": str(raw or ""),
        }
        if isinstance(multiagent, dict):
            result["multiagent"] = multiagent
        return result

    def _analysis_from_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        parsed = payload.get("parsed")
        if isinstance(parsed, dict):
            return parsed
        analysis = payload.get("analysis")
        if isinstance(analysis, dict):
            return analysis
        return payload

    def _normalized_axes(self, parsed: dict[str, Any], source_text: str) -> list[dict[str, Any]]:
        axes_by_label: dict[str, dict[str, Any]] = {
            label: {"axis": label, "score": 50, "evidence": [], "reasoning": ""} for label in self.AXIS_LABELS
        }
        raw_axes = parsed.get("axes") if isinstance(parsed.get("axes"), list) else []
        for axis in raw_axes:
            if not isinstance(axis, dict):
                continue
            label = self._normalize_axis_label(axis.get("axis"))
            if not label:
                continue
            evidence = axis.get("evidence") if isinstance(axis.get("evidence"), list) else []
            evidence = [str(item) for item in evidence[:5]]
            has_evidence = self._axis_has_usable_evidence(label, evidence, axis.get("reasoning"), source_text)
            reasoning = str(axis.get("reasoning") or "")[:500]
            if not has_evidence and "证据不足" not in reasoning:
                reasoning = f"{reasoning}{' ' if reasoning else ''}证据不足，按中性分处理。"
            axes_by_label[label] = {
                "axis": label,
                "score": self._clamp_number(axis.get("score"), minimum=0, maximum=100, default=50) if has_evidence else 50,
                "evidence": evidence,
                "reasoning": reasoning,
            }
        return [axes_by_label[label] for label in self.AXIS_LABELS]

    def _sentence_analyses(self, parsed: dict[str, Any], source_sentences: list[str]) -> list[dict[str, Any]]:
        raw_items = parsed.get("sentenceAnalyses") if isinstance(parsed.get("sentenceAnalyses"), list) else []
        normalized = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            quote = self._ground_sentence_quote(item.get("quote"), source_sentences)[:300]
            if not quote:
                continue
            normalized.append(
                {
                    "quote": quote,
                    "speechAct": str(item.get("speechAct") or "").strip()[:80],
                    "target": str(item.get("target") or "").strip()[:120],
                    "stance": str(item.get("stance") or "").strip()[:120],
                    "contextRole": str(item.get("contextRole") or "").strip()[:180],
                    "risk": str(item.get("risk") or "neutral").strip()[:20],
                    "axisImpacts": self._axis_impacts(item.get("axisImpacts")),
                    "reasoning": str(item.get("reasoning") or "").strip()[:500],
                }
            )
        return self._remove_duplicate_empty_sentence_analyses(normalized)

    def _axis_impacts(self, impacts: Any) -> list[dict[str, Any]]:
        if not isinstance(impacts, list):
            return []
        normalized = []
        for impact in impacts:
            if not isinstance(impact, dict):
                continue
            axis = self._normalize_axis_label(impact.get("axis"))
            if not axis:
                continue
            normalized.append(
                {
                    "axis": axis,
                    "direction": str(impact.get("direction") or "").strip()[:20],
                    "strength": self._clamp_number(impact.get("strength"), minimum=0, maximum=1, default=0.5),
                    "reasoning": str(impact.get("reasoning") or "").strip()[:240],
                }
            )
            if len(normalized) >= 3:
                break
        return normalized

    def _normalize_axis_label(self, axis: Any) -> str:
        text = str(axis or "").strip()
        if not text or "|" in text:
            return ""
        if text in self.AXIS_LABELS:
            return text
        lower = text.lower()
        if lower in self.AXIS_ALIASES:
            return self.AXIS_ALIASES[lower]
        for label in self.AXIS_LABELS:
            if label in text:
                return label
        for alias, label in self.AXIS_ALIASES.items():
            if alias and alias in lower:
                return label
        return ""

    def _axis_has_usable_evidence(self, label: str, evidence: list[str], reasoning: Any, source_text: str) -> bool:
        evidence_text = "\n".join([str(reasoning or ""), *evidence])
        if label == "修正意愿":
            return any(item.strip() for item in evidence) and self._has_explicit_correction_evidence(f"{evidence_text}\n{source_text}")
        return any(item.strip() for item in evidence)

    def _has_explicit_correction_evidence(self, text: str) -> bool:
        text = re.sub(r"\u4fee\u6b63\u610f\u613f|\u4fee\u6b63\u8f74|\u4fee\u6b63\u5206", "", str(text or ""))
        if re.search(r"(?:\u6ca1\u6709|\u672a|\u65e0|\u4e0d)(?:.{0,8})(?:\u627f\u8ba4|\u8ba4\u9519|\u4fee\u6b63|\u66f4\u6b63|\u6539\u7ed3\u8bba|\u63a5\u53d7\u7ea0\u6b63|\u613f\u610f\u6539)", text):
            return False
        return bool(re.search(r"(?:\u627f\u8ba4(?:\u9519\u8bef|\u95ee\u9898|\u8bf4\u9519)?|\u8ba4\u9519|\u9519\u4e86|\u8bf4\u9519|\u8bf4\u91cd|\u6211\u6536\u56de|\u6536\u56de|\u4fee\u6b63|\u66f4\u6b63|\u6539\u7ed3\u8bba|\u6539\u53e3|\u6539\u89c2\u70b9|\u964d\u4f4e\u7ed3\u8bba|\u8865\u5145\u4e00\u4e0b|\u8c22\u8c22\u6307\u6b63|\u611f\u8c22\u6307\u6b63|\u613f\u610f\u6539|\u53ef\u4ee5\u6539|\u63a5\u53d7\u7ea0\u6b63|\u88ab\u6307\u51fa)|\b(?:admit|admitted|mistake|wrong|correct(?:ed|ion)?|revise|revision|update conclusion|change my mind|thanks for correcting)\b", text, re.I))

    def _ground_sentence_quote(self, quote: Any, source_sentences: list[str]) -> str:
        raw_quote = str(quote or "").strip()
        normalized_quote = self._normalize_quote(raw_quote)
        if not normalized_quote:
            return ""
        for sentence in source_sentences:
            if raw_quote in sentence:
                return sentence
        for sentence in source_sentences:
            if normalized_quote in self._normalize_quote(sentence):
                return sentence
        best_sentence = ""
        best_score = 0.0
        for sentence in source_sentences:
            score = self._text_overlap_score(raw_quote, sentence)
            if score > best_score:
                best_score = score
                best_sentence = sentence
        return best_sentence if best_score >= 0.45 else ""

    def _remove_duplicate_empty_sentence_analyses(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        substantive_quotes = {item["quote"] for item in items if item.get("axisImpacts")}
        seen_empty = set()
        result = []
        for item in items:
            if item.get("axisImpacts"):
                result.append(item)
                continue
            if item["quote"] in substantive_quotes or item["quote"] in seen_empty:
                continue
            seen_empty.add(item["quote"])
            result.append(item)
        return result

    def _text_units(self, text: str) -> set[str]:
        normalized = self._normalize_quote(text)
        if len(normalized) <= 1:
            return {normalized} if normalized else set()
        return {normalized[index : index + 2] for index in range(len(normalized) - 1)}

    def _text_overlap_score(self, left: str, right: str) -> float:
        left_units = self._text_units(left)
        right_units = self._text_units(right)
        if not left_units or not right_units:
            return 0.0
        return len(left_units & right_units) / min(len(left_units), len(right_units))

    def _normalize_quote(self, text: str) -> str:
        return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(text or "")).lower())

    def _clamp_number(self, value: Any, *, minimum: float, maximum: float, default: float) -> float | int:
        try:
            number = float(value)
        except (TypeError, ValueError):
            number = default
        number = min(max(number, minimum), maximum)
        return int(number) if number.is_integer() else number


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
        return JsonContractReader().read_object(self.payload_path)


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
        return safe_read_json_object(self.js_plan_path)

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
        return JsonContractReader().read_object(path)


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
        return safe_read_json_object(self.js_report_path)


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


class DeepSeekAnalysisNormalizeRunner:
    """Normalize DeepSeek analysis JSON files into the JS-compatible result contract."""

    def __init__(
        self,
        payload_path: str | Path,
        analysis_path: str | Path,
        *,
        provider: str = "deepseek",
        model: str = "",
        reasoning_effort: str = "medium",
        raw: str = "",
        retried_compact_prompt: bool = False,
    ):
        self.payload_path = Path(payload_path)
        self.analysis_path = Path(analysis_path)
        self.provider = provider
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.raw = raw
        self.retried_compact_prompt = retried_compact_prompt
        self.normalizer = DeepSeekAnalysisNormalizer()

    def run(self) -> dict[str, Any]:
        return self.normalizer.normalize(
            source_payload=JsonContractReader().read_object(self.payload_path),
            analysis_payload=JsonContractReader().read_object(self.analysis_path),
            provider=self.provider,
            model=self.model,
            reasoning_effort=self.reasoning_effort,
            raw=self.raw,
            retried_compact_prompt=self.retried_compact_prompt,
        )


class DeepSeekAnalysisNormalizeCommandRequest:
    """Parse CLI argv for DeepSeek normalized-output JSON contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Normalize DeepSeek analysis JSON into the JS runtime result contract.")
        parser.add_argument("--payload", required=True, help="Path to the original JS-compatible analysis payload.")
        parser.add_argument("--analysis", required=True, help="Path to the DeepSeek analysis JSON or wrapper containing parsed/analysis.")
        parser.add_argument("--provider", default="deepseek")
        parser.add_argument("--model", default="")
        parser.add_argument("--reasoning-effort", default="medium")
        parser.add_argument("--raw", default="")
        parser.add_argument("--retried-compact-prompt", action="store_true")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return DeepSeekAnalysisNormalizeRunner(
            payload_path=args.payload,
            analysis_path=args.analysis,
            provider=args.provider,
            model=args.model,
            reasoning_effort=args.reasoning_effort,
            raw=args.raw,
            retried_compact_prompt=args.retried_compact_prompt,
        ).run()
