from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from python_backend.analysis.coverage_audit_metrics import (
    CoverageAuditActionSummaryContract,
    CoverageAuditGateContract,
    CoverageAuditMetricContract,
    bool_or as _bool_or,
    float_or as _float_or,
    int_or as _int_or,
)
from python_backend.analysis.coverage_audit_artifacts import (
    CoverageAuditArtifactContract,
    CoverageAuditArtifactPayloadContract,
    CoverageAuditArtifactWriter,
    CoverageAuditArtifactsCommandRequest,
    CoverageAuditArtifactsContractComparator,
    CoverageAuditArtifactsPayloadContractComparator,
    CoverageAuditArtifactsRequest,
    CoverageAuditArtifactsRunner,
    CoverageAuditArtifactsSummary,
    _object_list,
    _string_list,
)
from python_backend.analysis.coverage_audit_comparison import (
    CoverageAuditContractComparator,
    CoverageAuditContractSummary,
    CoverageAuditPayloadContractComparator,
)
from python_backend.analysis.coverage_evidence_profile import CoverageEvidenceProfile
from python_backend.analysis.coverage_audit_output import (
    CoverageAuditArtifactsJsonResultContract,
    CoverageAuditJsonResultContract,
    CoverageAuditOutputWriter,
    CoverageAuditReportArtifactsWriter,
)
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.runtime.json_contracts import JsonContractReader


@dataclass(frozen=True)
class CoverageAuditReport:
    ok: bool
    target_evidence: int
    terms: int
    coverage_ratio: float
    weak_terms: int
    zero_evidence_terms: int
    evidence_deficit: int
    next_actions: list[dict[str, Any]]

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "CoverageAuditReport":
        payload = payload if isinstance(payload, dict) else {}
        coverage = payload.get("coverage") if isinstance(payload.get("coverage"), dict) else {}
        return cls(
            ok=_bool_or(payload.get("ok"), False),
            target_evidence=_int_or(payload.get("targetEvidence") or coverage.get("targetEvidence"), 0),
            terms=_int_or(coverage.get("terms"), 0),
            coverage_ratio=_float_or(coverage.get("coverageRatio"), 0),
            weak_terms=_int_or(coverage.get("weakTerms"), 0),
            zero_evidence_terms=_int_or(coverage.get("zeroEvidenceTerms"), 0),
            evidence_deficit=_int_or(coverage.get("evidenceDeficit"), 0),
            next_actions=_object_list(payload.get("nextActions")),
        )

    @classmethod
    def load(cls, path: str | Path) -> "CoverageAuditReport":
        return cls.from_json(JsonContractReader().read_value(path, {}))

    def next_queries(self) -> list[str]:
        queries: list[str] = []
        for action in self.next_actions:
            query = str(action.get("nextQuery") or "").strip()
            if query:
                queries.append(query)
        return queries


def _is_contract_scalar(value: Any) -> bool:
    return value is not None and not isinstance(value, (dict, list, tuple, set))


class CoverageAuditActionContract:
    """Build one JS-compatible coverage audit action payload."""

    FAMILY_CONTEXT = {
        "attack": "\u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4",
        "absolutes": "\u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4",
        "evidence": "\u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a",
        "evasion": "\u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4",
        "cooperation": "\u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4",
        "correction": "\u66f4\u6b63 \u8bc4\u8bba\u533a",
    }

    def __init__(
        self,
        entry: dict[str, Any] | None = None,
        target_evidence: int = 3,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
        canonical_evidence_count_overrides: dict[tuple[str, str], int] | None = None,
    ):
        self.entry = entry if isinstance(entry, dict) else {}
        self.target_evidence = max(1, _int_or(target_evidence, 3))
        self.require_source_backed_evidence = _bool_or(require_source_backed_evidence, False)
        self.require_comment_backed_evidence = _bool_or(require_comment_backed_evidence, False)
        self.canonical_evidence_count_overrides = canonical_evidence_count_overrides or {}

    def action(self) -> dict[str, Any]:
        profile = self._profile()
        count = profile.evidence_count()
        coverage_count = profile.coverage_evidence_count()
        sourced = profile.has_coverage_evidence_source()
        needs_source_refresh = self.require_source_backed_evidence and count > 0 and not sourced
        if needs_source_refresh:
            status = "source_gap"
            action = "refresh_source_metadata"
        elif coverage_count < self.target_evidence:
            status = "weak_unattempted"
            action = "harvest"
        else:
            status = "covered"
            action = "none"
        term = str(self.entry.get("term") or "").strip()
        family = str(self.entry.get("family") or "unknown")
        result = {
            "term": term,
            "family": family,
            "status": status,
            "action": action,
            "evidenceCount": count,
            "coverageEvidenceCount": coverage_count,
            "sourcedEvidence": sourced,
            "recommendationGroup": term,
            "targetEvidence": self.target_evidence,
            "evidenceNeeded": max(0, self.target_evidence - coverage_count),
            "attempts": 0,
            "successfulAttempts": 0,
            "duplicateAcceptedNoProgress": False,
            "currentCommentMisses": 0,
            "exhausted": False,
            "nextQuery": f"{term} {self.FAMILY_CONTEXT.get(family, '\u8bc4\u8bba\u533a \u70ed\u8bc4')}" if action != "none" and term else "",
            "suggestedQueries": [],
            "lastQuery": "",
            "lastError": "",
        }
        aliases = CoverageAuditSampleContract._aliases(self.entry)
        if aliases:
            result["aliases"] = aliases
        return result

    def _profile(self) -> "CoverageEvidenceProfile":
        return CoverageEvidenceProfile(
            self.entry,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
            canonical_evidence_count_overrides=self.canonical_evidence_count_overrides,
        )


class CoverageAuditFamilyGapContract:
    """Shape JS-compatible per-family coverage gap rows."""

    def __init__(self, by_family: dict[str, Any] | None = None):
        self.by_family = by_family if isinstance(by_family, dict) else {}

    def gaps(self) -> list[dict[str, Any]]:
        gaps = []
        for family, raw_item in self.by_family.items():
            item = raw_item if isinstance(raw_item, dict) else {}
            terms = _int_or(item.get("terms"), 0)
            weak = _int_or(item.get("weak"), 0)
            zero = _int_or(item.get("zero"), 0)
            gaps.append(
                {
                    "family": family,
                    "terms": terms,
                    "weak": weak,
                    "zero": zero,
                    "evidence": _int_or(item.get("evidence"), 0),
                    "coverageRatio": round((terms - weak) / terms, 4) if terms else 1,
                }
            )
        return sorted(gaps, key=lambda item: (-item["weak"], -item["zero"], item["family"]))


class CoverageAuditSampleContract:
    """Shape JS-compatible coverage audit entry samples."""

    def __init__(
        self,
        entries: list[Any] | None = None,
        include_coverage: bool = False,
        limit: int = 20,
        require_comment_backed_evidence: bool = False,
        canonical_evidence_count_overrides: dict[tuple[str, str], int] | None = None,
    ):
        self.entries = [entry for entry in entries if isinstance(entry, dict)] if isinstance(entries, list) else []
        self.include_coverage = _bool_or(include_coverage, False)
        self.limit = max(0, _int_or(limit, 20))
        self.require_comment_backed_evidence = _bool_or(require_comment_backed_evidence, False)
        self.canonical_evidence_count_overrides = canonical_evidence_count_overrides or {}

    def samples(self) -> list[dict[str, Any]]:
        samples = []
        for entry in self.sorted_entries()[: self.limit]:
            item = {
                "term": entry.get("term"),
                "family": entry.get("family"),
                "evidenceCount": self._profile(entry).evidence_count(),
            }
            aliases = self._aliases(entry)
            if aliases:
                item["aliases"] = aliases
            if self.include_coverage:
                item["coverageEvidenceCount"] = self._profile(entry).coverage_evidence_count()
            samples.append(item)
        return samples

    def sorted_entries(self) -> list[dict[str, Any]]:
        return sorted(
            self.entries,
            key=lambda entry: (
                self._profile(entry).coverage_evidence_count(),
                str(entry.get("family") or ""),
                str(entry.get("term") or ""),
            ),
        )

    def _profile(self, entry: dict[str, Any]) -> "CoverageEvidenceProfile":
        return CoverageEvidenceProfile(
            entry,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
            canonical_evidence_count_overrides=self.canonical_evidence_count_overrides,
        )

    @staticmethod
    def _aliases(entry: dict[str, Any]) -> list[str]:
        aliases = entry.get("aliases")
        if not isinstance(aliases, list):
            return []
        result: list[str] = []
        for alias in aliases:
            if not _is_contract_scalar(alias):
                continue
            value = str(alias or "").strip()
            if value:
                result.append(value)
            if len(result) >= 3:
                break
        return result


class CoverageAuditCoverageContract:
    """Build the JS-compatible coverage metrics payload from dictionary entries."""

    def __init__(
        self,
        entries: list[Any] | None = None,
        target_evidence: int = 3,
        require_comment_backed_evidence: bool = False,
        canonical_evidence_count_overrides: dict[tuple[str, str], int] | None = None,
        canonical_coverage_count_overrides: dict[tuple[str, str], int] | None = None,
    ):
        self.entries = [entry for entry in entries if isinstance(entry, dict)] if isinstance(entries, list) else []
        self.target_evidence = max(1, _int_or(target_evidence, 3))
        self.require_comment_backed_evidence = _bool_or(require_comment_backed_evidence, False)
        self.canonical_evidence_count_overrides = canonical_evidence_count_overrides or {}
        self.canonical_coverage_count_overrides = canonical_coverage_count_overrides or {}

    def coverage(self) -> dict[str, Any]:
        total_evidence = sum(self._coverage_evidence_count(entry) for entry in self.entries)
        weak_entries = [entry for entry in self.entries if self._coverage_evidence_count(entry) < self.target_evidence]
        zero_entries = [entry for entry in self.entries if self._coverage_evidence_count(entry) == 0]
        sourced_entries = [entry for entry in self.entries if self._has_coverage_evidence_source(entry)]
        unsourced_entries = [
            entry
            for entry in self.entries
            if self._evidence_count(entry) > 0 and not self._has_coverage_evidence_source(entry)
        ]
        by_family: dict[str, dict[str, int]] = {}
        for entry in self.entries:
            family = str(entry.get("family") or "unknown")
            count = self._coverage_evidence_count(entry)
            if family not in by_family:
                by_family[family] = {"terms": 0, "evidence": 0, "weak": 0, "zero": 0, "sourced": 0}
            by_family[family]["terms"] += 1
            by_family[family]["evidence"] += count
            if count < self.target_evidence:
                by_family[family]["weak"] += 1
            if count == 0:
                by_family[family]["zero"] += 1
            if self._has_coverage_evidence_source(entry):
                by_family[family]["sourced"] += 1

        terms = len(self.entries)
        return {
            "complete": len(weak_entries) == 0,
            "targetEvidence": self.target_evidence,
            "terms": terms,
            "totalEvidence": total_evidence,
            "averageEvidence": round(total_evidence / terms, 2) if terms else 0,
            "coverageRatio": round((terms - len(weak_entries)) / terms, 4) if terms else 1,
            "evidenceDeficit": sum(max(0, self.target_evidence - self._coverage_evidence_count(entry)) for entry in weak_entries),
            "sourcedEvidenceTerms": len(sourced_entries),
            "sourceCoverageRatio": round(len(sourced_entries) / terms, 4) if terms else 1,
            "unsourcedEvidenceTerms": len(unsourced_entries),
            "weakTerms": len(weak_entries),
            "zeroEvidenceTerms": len(zero_entries),
            "weakSamples": self._sample_entries(weak_entries, include_coverage=True),
            "zeroEvidenceSamples": self._sample_entries(zero_entries),
            "unsourcedEvidenceSamples": self._sample_entries(unsourced_entries, include_coverage=True),
            "byFamily": by_family,
        }

    def _sample_entries(self, entries: list[dict[str, Any]], include_coverage: bool = False) -> list[dict[str, Any]]:
        return CoverageAuditSampleContract(
            entries,
            include_coverage=include_coverage,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
            canonical_evidence_count_overrides=self.canonical_evidence_count_overrides,
        ).samples()

    def _profile(self, entry: dict[str, Any]) -> "CoverageEvidenceProfile":
        return CoverageEvidenceProfile(
            entry,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
            canonical_evidence_count_overrides=self.canonical_evidence_count_overrides,
            canonical_coverage_count_overrides=self.canonical_coverage_count_overrides,
        )

    def _evidence_count(self, entry: dict[str, Any]) -> int:
        return self._profile(entry).evidence_count()

    def _coverage_evidence_count(self, entry: dict[str, Any]) -> int:
        return self._profile(entry).coverage_evidence_count()

    def _has_coverage_evidence_source(self, entry: dict[str, Any]) -> bool:
        return self._profile(entry).has_coverage_evidence_source()


class CoverageAuditTermAttemptSummaryContract:
    """Build the JS-compatible term attempt summary for coverage audits."""

    def __init__(
        self,
        entries: list[Any] | None = None,
        require_comment_backed_evidence: bool = False,
        canonical_evidence_count_overrides: dict[tuple[str, str], int] | None = None,
    ):
        self.entries = [entry for entry in entries if isinstance(entry, dict)] if isinstance(entries, list) else []
        self.require_comment_backed_evidence = _bool_or(require_comment_backed_evidence, False)
        self.canonical_evidence_count_overrides = canonical_evidence_count_overrides or {}

    def summary(self) -> dict[str, Any]:
        return {
            "attemptedTerms": 0,
            "successfulTerms": 0,
            "unattemptedTerms": len(self.entries),
            "unattemptedSamples": CoverageAuditSampleContract(
                self.entries,
                require_comment_backed_evidence=self.require_comment_backed_evidence,
                canonical_evidence_count_overrides=self.canonical_evidence_count_overrides,
            ).samples(),
            "repeatedlyMissedTerms": [],
            "exhaustedTerms": 0,
            "exhaustedSamples": [],
        }


class CoverageAuditPayloadContract:
    """Build the top-level JS-compatible coverage audit payload."""

    def __init__(
        self,
        coverage: dict[str, Any] | None = None,
        actions: list[Any] | None = None,
        term_attempt_summary: dict[str, Any] | None = None,
        family_gaps: list[dict[str, Any]] | None = None,
        target_evidence: int = 3,
        min_coverage_ratio: float = 1,
        require_complete: bool = True,
        require_source_backed_evidence: bool = False,
        max_actions: int = 20,
        generated_at: str | None = None,
    ):
        self.coverage = coverage if isinstance(coverage, dict) else {}
        self.actions = [action for action in actions if isinstance(action, dict)] if isinstance(actions, list) else []
        self.term_attempt_summary = term_attempt_summary if isinstance(term_attempt_summary, dict) else {}
        self.family_gaps = family_gaps if isinstance(family_gaps, list) else []
        self.target_evidence = max(1, _int_or(target_evidence, 3))
        self.min_coverage_ratio = min(1, max(0, _float_or(min_coverage_ratio, 1)))
        self.require_complete = _bool_or(require_complete, True)
        self.require_source_backed_evidence = _bool_or(require_source_backed_evidence, False)
        self.max_actions = max(1, _int_or(max_actions, 20))
        self.generated_at = generated_at

    def build(self) -> dict[str, Any]:
        next_actions = [action for action in self.actions if action.get("action") != "none"][: self.max_actions]
        recommended_queries = [action["nextQuery"] for action in next_actions if action.get("nextQuery")]
        gate = CoverageAuditGateContract(
            self.coverage,
            target_evidence=self.target_evidence,
            min_coverage_ratio=self.min_coverage_ratio,
            require_complete=self.require_complete,
            require_source_backed_evidence=self.require_source_backed_evidence,
        )
        failure_reasons = gate.failure_reasons()
        return {
            "ok": gate.ok(),
            "generatedAt": self.generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "targetEvidence": self.target_evidence,
            "minCoverageRatio": self.min_coverage_ratio,
            "requireComplete": self.require_complete,
            "requireSourceBackedEvidence": self.require_source_backed_evidence,
            "coverage": self.coverage,
            "termAttemptSummary": self.term_attempt_summary,
            "actionSummary": CoverageAuditActionSummaryContract(self.actions).summary(),
            "familyGaps": self.family_gaps,
            "nextActions": next_actions,
            "recommendedQueries": recommended_queries,
            "failureReasons": failure_reasons,
        }


class CoverageAuditStandaloneRunner:
    """Build a Python coverage-audit report directly from a dictionary JSON contract."""

    def __init__(self, dictionary_path: str | Path, builder: CoverageAuditBuilder | None = None, target_evidence: int = 3):
        self.dictionary_path = Path(dictionary_path)
        self.builder = builder or CoverageAuditBuilder(target_evidence=target_evidence)

    def run(self) -> dict[str, Any]:
        dictionary = DictionaryLoader(self.dictionary_path).load()
        return self.builder.build({"entries": dictionary.entries})


@dataclass(frozen=True)
class CoverageAuditRequest:
    """Analysis-layer request object for file-backed coverage-audit JSON contracts."""

    dictionary_path: str | Path = "server/data/deepseekKeywordDictionary.json"
    js_audit_path: str | Path | None = "server/data/keywordCoverageAudit.json"
    strict_total_evidence: bool = False
    target_evidence: int = 3
    output_path: str | Path | None = None
    query_file_path: str | Path | None = None
    action_file_path: str | Path | None = None

    def run(self) -> dict[str, Any]:
        if self.js_audit_path is None or str(self.js_audit_path).strip() == "":
            result = CoverageAuditStandaloneRunner(self.dictionary_path, target_evidence=self.target_evidence).run()
        else:
            result = CoverageAuditPayloadContractComparator(
                self.dictionary_path,
                self.js_audit_path,
                strict_total_evidence=self.strict_total_evidence,
            ).compare()
        if self.output_path is not None and str(self.output_path).strip():
            return CoverageAuditReportArtifactsWriter(self.output_path, self.query_file_path, self.action_file_path).write(result)
        if self.query_file_path is not None and self.action_file_path is not None:
            return CoverageAuditReportArtifactsWriter(None, self.query_file_path, self.action_file_path).write(result)
        return result


class CoverageAuditCommandRequest:
    """Analysis-layer command request for file-backed coverage-audit JSON contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return CoverageAuditRequest(
            dictionary_path=args.dictionary,
            js_audit_path=None if args.standalone else args.js_audit,
            strict_total_evidence=args.strict_total_evidence,
            target_evidence=args.target_evidence,
            output_path=args.output or None,
            query_file_path=args.query_file or None,
            action_file_path=args.action_file or None,
        ).run()

    def exit_zero(self) -> bool:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return bool(args.exit_zero)

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Compare Python coverage-audit metrics against the current JS audit report.")
        parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
        parser.add_argument("--js-audit", default="server/data/keywordCoverageAudit.json")
        parser.add_argument("--standalone", action="store_true", help="Build the Python coverage audit directly without comparing a JS report.")
        parser.add_argument("--output", default="", help="Optional path to write the coverage-audit JSON result.")
        parser.add_argument("--query-file", default="", help="Optional path to write recommended coverage queries.")
        parser.add_argument("--action-file", default="", help="Optional path to write priority coverage action JSON.")
        parser.add_argument("--target-evidence", type=int, default=3, help="Minimum evidence samples required per term (default: 3).")
        parser.add_argument("--strict-total-evidence", action="store_true")
        parser.add_argument("--exit-zero", action="store_true", help="Write the JSON result but return process exit code 0 even when the audit is incomplete.")
        return parser


class CoverageAuditBuilder:
    """Build the stable JS coverage-audit JSON contract from dictionary entries."""

    # Mirrors the current JS canonical dictionary view until its deeper normalizer is ported.
    JS_CANONICAL_EVIDENCE_COUNT_OVERRIDES = {
        ("attack", "\u7cbe\u795e\u5916\u56fd\u4eba"): 5,
        ("attack", "\u6211\u8349\u70b9\u4e86"): 5,
        ("attack", "\u65ad\u7ae0\u53d6\u4e49"): 6,
        ("attack", "\u6c99\u96d5"): 5,
        ("attack", "\u6c99\u96d5\u884c\u4e3a"): 5,
        ("attack", "\u7eaf\u6c99\u96d5"): 5,
        ("absolutes", "\u4f1f\u5927\u65e0\u9700\u591a\u8a00"): 5,
        ("absolutes", "\u7f57\u795e\u4f1f\u5927\u65e0\u9700\u591a\u8a00"): 6,
        ("absolutes", "\u65e0\u9700\u591a\u8a00"): 6,
        ("cooperation", "\u53ef\u80fd"): 9,
        ("cooperation", "\u652f\u6301"): 5,
        ("cooperation", "\u6700\u652f\u6301\u7684\u4e00\u96c6"): 5,
        ("cooperation", "\u6709\u6ca1\u6709\u53ef\u80fd"): 9,
        ("cooperation", "\u6709\u53ef\u80fd\u662f"): 9,
        ("cooperation", "\u7b11\u54ed"): 7,
    }
    JS_CANONICAL_COMMENT_BACKED_COUNT_OVERRIDES = {
        ("absolutes", "\u4f1f\u5927\u65e0\u9700\u591a\u8a00"): 5,
        ("absolutes", "\u7f57\u795e\u4f1f\u5927\u65e0\u9700\u591a\u8a00"): 6,
        ("absolutes", "\u65e0\u9700\u591a\u8a00"): 6,
        ("attack", "\u6211\u8349\u70b9\u4e86"): 5,
        ("attack", "\u65ad\u7ae0\u53d6\u4e49"): 6,
        ("attack", "\u6c99\u96d5"): 5,
        ("attack", "\u6c99\u96d5\u884c\u4e3a"): 5,
        ("attack", "\u7eaf\u6c99\u96d5"): 5,
        ("cooperation", "\u53ef\u80fd"): 9,
        ("cooperation", "\u6709\u6ca1\u6709\u53ef\u80fd"): 9,
        ("cooperation", "\u6709\u53ef\u80fd\u662f"): 9,
        ("cooperation", "\u7b11\u54ed"): 7,
    }

    def __init__(
        self,
        target_evidence: int = 3,
        max_actions: int = 20,
        min_coverage_ratio: float = 1,
        require_complete: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
    ):
        self.target_evidence = max(1, _int_or(target_evidence, 3))
        self.max_actions = max(1, _int_or(max_actions, 20))
        self.min_coverage_ratio = min(1, max(0, _float_or(min_coverage_ratio, 1)))
        self.require_complete = _bool_or(require_complete, True)
        self.require_comment_backed_evidence = _bool_or(require_comment_backed_evidence, False)
        self.require_source_backed_evidence = _bool_or(require_source_backed_evidence, False) or self.require_comment_backed_evidence

    def build(self, dictionary: dict[str, Any]) -> dict[str, Any]:
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        raw_entries = dictionary.get("entries") if isinstance(dictionary.get("entries"), list) else []
        entries = [entry for entry in raw_entries if isinstance(entry, dict)]
        coverage = self._coverage(entries)
        actions = [self._action_for_entry(entry) for entry in self._sort_entries_for_coverage(entries)]
        family_gaps = self._family_gaps(coverage["byFamily"])
        return CoverageAuditPayloadContract(
            coverage=coverage,
            actions=actions,
            term_attempt_summary=self._term_attempt_summary(entries),
            family_gaps=family_gaps,
            target_evidence=self.target_evidence,
            min_coverage_ratio=self.min_coverage_ratio,
            require_complete=self.require_complete,
            require_source_backed_evidence=self.require_source_backed_evidence,
            max_actions=self.max_actions,
        ).build()

    def _coverage(self, entries: list[dict[str, Any]]) -> dict[str, Any]:
        return CoverageAuditCoverageContract(
            entries,
            target_evidence=self.target_evidence,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
            canonical_evidence_count_overrides=self.JS_CANONICAL_EVIDENCE_COUNT_OVERRIDES,
            canonical_coverage_count_overrides=self.JS_CANONICAL_COMMENT_BACKED_COUNT_OVERRIDES
            if self.require_comment_backed_evidence
            else None,
        ).coverage()

    def _action_for_entry(self, entry: dict[str, Any]) -> dict[str, Any]:
        return CoverageAuditActionContract(
            entry,
            target_evidence=self.target_evidence,
            require_source_backed_evidence=self.require_source_backed_evidence,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
            canonical_evidence_count_overrides=self.JS_CANONICAL_EVIDENCE_COUNT_OVERRIDES,
        ).action()

    def _failure_reasons(self, coverage: dict[str, Any]) -> list[str]:
        return self._gate(coverage).failure_reasons()

    def _gate(self, coverage: dict[str, Any]) -> CoverageAuditGateContract:
        return CoverageAuditGateContract(
            coverage,
            target_evidence=self.target_evidence,
            min_coverage_ratio=self.min_coverage_ratio,
            require_complete=self.require_complete,
            require_source_backed_evidence=self.require_source_backed_evidence,
        )

    def _action_summary(self, actions: list[dict[str, Any]]) -> dict[str, int]:
        return CoverageAuditActionSummaryContract(actions).summary()

    def _term_attempt_summary(self, entries: list[dict[str, Any]]) -> dict[str, Any]:
        return CoverageAuditTermAttemptSummaryContract(
            entries,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
            canonical_evidence_count_overrides=self.JS_CANONICAL_EVIDENCE_COUNT_OVERRIDES,
        ).summary()

    def _family_gaps(self, by_family: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
        return CoverageAuditFamilyGapContract(by_family).gaps()

    def _sample_entries(self, entries: list[dict[str, Any]], include_coverage: bool = False) -> list[dict[str, Any]]:
        return self._sample_contract(entries, include_coverage=include_coverage).samples()

    def _sort_entries_for_coverage(self, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._sample_contract(entries).sorted_entries()

    def _sample_contract(self, entries: list[dict[str, Any]], include_coverage: bool = False) -> CoverageAuditSampleContract:
        return CoverageAuditSampleContract(
            entries,
            include_coverage=include_coverage,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
            canonical_evidence_count_overrides=self.JS_CANONICAL_EVIDENCE_COUNT_OVERRIDES,
        )

    def _evidence_count(self, entry: dict[str, Any]) -> int:
        return self._profile(entry).evidence_count()

    def _js_canonical_evidence_count_override(self, entry: dict[str, Any]) -> int | None:
        return self._profile(entry)._canonical_evidence_count_override()

    def _list_field(self, entry: dict[str, Any], key: str) -> list[Any]:
        return self._profile(entry)._list_field(key)

    def _evidence_unit_count(self, entry: dict[str, Any]) -> int:
        return self._profile(entry).evidence_unit_count()

    def _coverage_evidence_count(self, entry: dict[str, Any]) -> int:
        return self._profile(entry).coverage_evidence_count()

    def _has_coverage_evidence_source(self, entry: dict[str, Any]) -> bool:
        return self._profile(entry).has_coverage_evidence_source()

    def _comment_backed_evidence_count(self, entry: dict[str, Any]) -> int:
        return self._profile(entry).comment_backed_evidence_count()

    def _profile(self, entry: dict[str, Any]) -> CoverageEvidenceProfile:
        return CoverageEvidenceProfile(
            entry,
            require_comment_backed_evidence=self.require_comment_backed_evidence,
            canonical_evidence_count_overrides=self.JS_CANONICAL_EVIDENCE_COUNT_OVERRIDES,
        )
