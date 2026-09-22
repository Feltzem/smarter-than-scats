"""Synthetic regression tests for the Site 36 raw-data builder."""

from __future__ import annotations

import unittest

from build_site36_dataset import phase_events_for_period, phase_rows, signal_transitions


def status(group: int, value: str) -> dict:
    return {
        "sgNumber": group,
        "off": value == "off",
        "green": value == "green",
        "yellow": value == "yellow",
        "red": value == "red",
    }


def event(timestamp: int, *statuses: dict) -> dict:
    return {"timestamp": timestamp, "signalGroupStatuses": list(statuses)}


class PhaseBuilderTests(unittest.TestCase):
    def test_interval_belongs_to_phase_terminated_at_its_end(self) -> None:
        rows = phase_rows([
            {"timestamp": 100, "terminatedPhase": 1},
            {"timestamp": 130, "terminatedPhase": 3},
            {"timestamp": 150, "terminatedPhase": 2},
        ])

        self.assertEqual(rows, [
            {"phase": "C", "start": 100, "end": 130, "duration": 30},
            {"phase": "B", "start": 130, "end": 150, "duration": 20},
        ])

    def test_boundary_spanning_phases_are_clipped_into_period(self) -> None:
        events = phase_events_for_period([
            {"phase": "A", "start": 90, "end": 120, "duration": 30},
            {"phase": "B", "start": 120, "end": 180, "duration": 60},
            {"phase": "C", "start": 180, "end": 220, "duration": 40},
        ], 100, 200)

        self.assertEqual(events, [
            {"phase": "A", "phaseIndex": 0, "startTime": 0, "duration": 20},
            {"phase": "B", "phaseIndex": 1, "startTime": 20, "duration": 60},
            {"phase": "C", "phaseIndex": 2, "startTime": 80, "duration": 20},
        ])


class SignalTransitionTests(unittest.TestCase):
    def test_initial_state_uses_boundary_snapshot_and_deduplicates(self) -> None:
        transitions = signal_transitions([
            event(90, status(1, "green")),
            event(100, status(2, "red")),
            event(110, status(1, "green")),
            event(120, status(1, "yellow")),
            event(130, status(1, "yellow")),
            event(140, status(1, "red")),
            event(200, status(1, "off")),
        ], 100, 200)

        group_one = [row for row in transitions if row["signalGroup"] == 1]
        self.assertEqual(group_one, [
            {"time": 0, "signalGroup": 1, "aspect": "green"},
            {"time": 20, "signalGroup": 1, "aspect": "yellow"},
            {"time": 40, "signalGroup": 1, "aspect": "red"},
        ])
        self.assertEqual(
            next(row for row in transitions if row["signalGroup"] == 2),
            {"time": 0, "signalGroup": 2, "aspect": "red"},
        )
        self.assertEqual(sum(row["time"] == 0 for row in transitions), 16)


if __name__ == "__main__":
    unittest.main()
