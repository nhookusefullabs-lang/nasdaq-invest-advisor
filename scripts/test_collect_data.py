#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NGX(Nasdaq Next Gen 100) 파일럿 순수 함수 단위 테스트 (PRD_Nasdaq10 §4.1, US-1).

이 저장소는 npm(vitest)만 CI 품질 게이트로 쓰고 Python은 pytest 등 별도 테스트 프레임워크가
없다 — 새 의존성을 추가하지 않기 위해 표준 라이브러리 unittest만으로 작성한다.

실행:
    python -m unittest scripts/test_collect_data.py -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import collect_data as cd  # noqa: E402


def make_series(close: float, volume: int, days: int = 20) -> list[dict]:
    return [
        {"date": f"2026-01-{(i % 28) + 1:02d}", "high": close, "low": close, "close": close, "volume": volume}
        for i in range(days)
    ]


class TestLiquidityGuardrail(unittest.TestCase):
    def test_passes_at_exact_price_and_dollar_volume_boundary(self):
        # close=$10.00 정확, 거래량 2,000,000 → 평균거래대금 정확히 $20,000,000
        series = make_series(10.0, 2_000_000)
        ok, reason = cd.passes_liquidity_guardrail(series)
        self.assertTrue(ok)
        self.assertIsNone(reason)

    def test_fails_just_below_price_boundary(self):
        series = make_series(9.99, 5_000_000)
        ok, reason = cd.passes_liquidity_guardrail(series)
        self.assertFalse(ok)
        self.assertIn("주가", reason)

    def test_fails_just_below_dollar_volume_boundary(self):
        # 15.0 * 1,000,000 = 15,000,000 < 20,000,000
        series = make_series(15.0, 1_000_000)
        ok, reason = cd.passes_liquidity_guardrail(series)
        self.assertFalse(ok)
        self.assertIn("거래대금", reason)

    def test_empty_series_fails(self):
        ok, reason = cd.passes_liquidity_guardrail([])
        self.assertFalse(ok)
        self.assertEqual(reason, "데이터 없음")

    def test_uses_only_last_20_days_for_dollar_volume(self):
        # 앞쪽 40일은 저유동(가드레일 통과 불가 수준)이지만 최근 20일만 고유동이면 통과해야 한다
        stale_low = make_series(15.0, 100_000, days=40)
        recent_high = make_series(15.0, 2_000_000, days=20)
        series = stale_low + recent_high
        ok, reason = cd.passes_liquidity_guardrail(series)
        self.assertTrue(ok)


class TestTickerNormalization(unittest.TestCase):
    def test_strips_whitespace_and_uppercases(self):
        self.assertEqual(cd.normalize_ticker(" abcd "), "ABCD")

    def test_strips_trailing_asterisk_footnote(self):
        self.assertEqual(cd.normalize_ticker("ABCD*"), "ABCD")

    def test_strips_parenthetical_footnote(self):
        self.assertEqual(cd.normalize_ticker("ABCD (W/I)"), "ABCD")


class TestDualListingExclusion(unittest.TestCase):
    def test_non_nasdaq_exchange_is_excluded(self):
        self.assertTrue(cd.is_non_nasdaq_line({"Exchange": "LSE"}))

    def test_nasdaq_exchange_is_not_excluded(self):
        self.assertFalse(cd.is_non_nasdaq_line({"Exchange": "NASDAQ"}))

    def test_missing_exchange_defaults_to_nasdaq(self):
        self.assertFalse(cd.is_non_nasdaq_line({}))


class TestLoadNgxTickerSource(unittest.TestCase):
    def _write_csv(self, tmp_path: Path, text: str) -> Path:
        p = tmp_path / "ngx_holdings.csv"
        p.write_text(text, encoding="utf-8")
        return p

    def test_loads_and_normalizes_included_rows(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            csv_path = self._write_csv(
                Path(td),
                "Ticker,Name,Sector,Exchange\n"
                " abcd ,Example Corp,Technology,NASDAQ\n",
            )
            included, excluded = cd.load_ngx_ticker_source(csv_path)
            self.assertEqual(included, [("ABCD", "Example Corp", "Technology")])
            self.assertEqual(excluded, [])

    def test_excludes_non_nasdaq_dual_listed_line(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            csv_path = self._write_csv(
                Path(td),
                "Ticker,Name,Sector,Exchange\n"
                "EFGH,Dual Listed Co,Technology,LSE\n",
            )
            included, excluded = cd.load_ngx_ticker_source(csv_path)
            self.assertEqual(included, [])
            self.assertEqual(len(excluded), 1)
            self.assertEqual(excluded[0]["ticker"], "EFGH")

    def test_deduplicates_repeated_ticker(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            csv_path = self._write_csv(
                Path(td),
                "Ticker,Name,Sector,Exchange\n"
                "IJKL,Foo,Technology,NASDAQ\n"
                "ijkl,Foo,Technology,NASDAQ\n",
            )
            included, _ = cd.load_ngx_ticker_source(csv_path)
            self.assertEqual(included, [("IJKL", "Foo", "Technology")])


if __name__ == "__main__":
    unittest.main()
