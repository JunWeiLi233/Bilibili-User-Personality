from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any


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
