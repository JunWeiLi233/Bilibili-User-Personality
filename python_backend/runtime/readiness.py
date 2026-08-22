from __future__ import annotations

from typing import Any


class ReadinessBlockerDetailsContract:
    """Render stable blocker detail objects for failed readiness gates."""

    def __init__(self, reasons: dict[str, str] | None = None):
        self.reasons = reasons if isinstance(reasons, dict) else {}

    def from_gates(self, gates: list[dict[str, Any]]) -> list[dict[str, str]]:
        return [
            {"gate": str(gate_name), "reason": self.reasons.get(str(gate_name), "readiness gate failed")}
            for gate in gates
            for gate_name in [gate.get("gate") or ""]
            if not gate.get("ok")
        ]


class ReadinessGateContract:
    """Summarize readiness gates into the stable replacement-gate JSON shape."""

    def __init__(self, gates: list[dict[str, Any]] | None = None, reasons: dict[str, str] | None = None):
        self.gates = gates if isinstance(gates, list) else []
        self.reasons = reasons if isinstance(reasons, dict) else {}

    def to_json_contract(self) -> dict[str, Any]:
        blockers = [gate.get("gate") for gate in self.gates if not gate.get("ok")]
        return {
            "ok": not blockers,
            "gates": self.gates,
            "blockers": blockers,
            "blockerDetails": ReadinessBlockerDetailsContract(self.reasons).from_gates(self.gates),
        }


class ReadinessComponentCollectionContract:
    """Collect gates and blocker reasons from ordered readiness components."""

    def __init__(self, components: list[Any] | None = None):
        self.components = components if isinstance(components, list) else []

    def gates(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for component in self.components:
            gates = component.gates() if hasattr(component, "gates") else []
            if isinstance(gates, list):
                result.extend(gates)
        return result

    def blocker_reasons(self) -> dict[str, str]:
        reasons: dict[str, str] = {}
        for component in self.components:
            component_reasons = component.blocker_reasons() if hasattr(component, "blocker_reasons") else {}
            if isinstance(component_reasons, dict):
                reasons.update(component_reasons)
        return reasons
