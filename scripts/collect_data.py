#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
나스닥100 데이터 수집 스크립트 (PRD_Nasdaq4 §7)
2년 수집 — 미너비니 트렌드 템플릿(SMA200·52주 고저)과 v9 백테스트용 (PRD_Nasdaq8 §7, US-1)

- yfinance로 나스닥100 종목의 2년치 일별 OHLCV를 1회 수집한다.
- 지표(RSI/MACD)의 워밍업(~35거래일), 52주 신고가/신저가(252거래일), SMA200 워밍업,
  v9 백테스트 대비 여유 기간을 확보하기 위해 2년치를 받고, 시뮬레이션·화면 표시는
  웹앱에서 최근 63거래일만 사용한다.
- 데이터 부족·결측으로 지표 계산이 불안정한 종목은 제외하고 사유를 로그로 남긴다.
- 결과를 public/data/nasdaq100.json 으로 저장한다.

스키마 (고정):
{
  "generatedAt": "YYYY-MM-DD",
  "tickers": [
    { "ticker": "AAPL", "name": "Apple Inc.", "sector": "Technology",
      "series": [ {"date": "YYYY-MM-DD", "high": 0, "low": 0, "close": 0, "volume": 0} ] }
  ]
}

사용법:
    python scripts/collect_data.py
"""

from __future__ import annotations

import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import yfinance as yf
    import pandas as pd
except ImportError as e:  # pragma: no cover
    print(f"[ERROR] 필수 패키지가 없습니다: {e}\n"
          f"        설치: python -m pip install yfinance pandas", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------

# 수집 기간: MACD(26 EMA)+시그널(9 EMA) 워밍업(~35거래일) + 최근 63거래일 표시분 +
# 52주 신고가/신저가(252거래일) + 미너비니 SMA200 워밍업(200거래일) + v9 백테스트 여유분
# 확보를 위해 "2y"(약 504거래일)로 확대한다 (PRD_Nasdaq8 §7, US-1).
# 참고: "12mo"(="1y")는 실측상 251거래일만 반환해 252거래일 문턱을 1일 못 채우는 문제가
# 있었다(캘린더 정렬에 따라 250~251로 흔들림) — "2y"는 이 문제에서도 안전하게 벗어난다.
PERIOD = "2y"
INTERVAL = "1d"

# 지표 계산이 안정적으로 가능한 최소 거래일 수 — v7과 동일하게 유지한다 (PRD_Nasdaq8 US-1:
# "수집 제외 기준은 v7과 동일하게 유지". 미너비니 모드가 요구하는 252거래일 미만 판정은
# 수집 단계에서 종목을 제외하지 않고, 클라이언트의 hasFullYearData()가 개별 처리한다).
MIN_TRADING_DAYS = 200

# 배치 다운로드 크기 (yfinance rate-limit 완화)
BATCH_SIZE = 25
BATCH_SLEEP_SEC = 1.0

# 출력 경로
ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "public" / "data" / "nasdaq100.json"
LOG_PATH = ROOT / "scripts" / "collect_data.log"


# ---------------------------------------------------------------------------
# 나스닥100 종목 리스트 (티커·종목명·섹터) — 정적 하드코딩 (PRD §7-2)
# 섹터는 GICS 기준. 실제 편입/편출로 일부가 조회 실패할 수 있으며,
# 그 경우 수집 단계에서 제외되고 사유가 로그에 남는다.
# ---------------------------------------------------------------------------

NASDAQ100 = [
    # --- Information Technology ---
    ("AAPL", "Apple Inc.", "Technology"),
    ("MSFT", "Microsoft Corporation", "Technology"),
    ("NVDA", "NVIDIA Corporation", "Technology"),
    ("AVGO", "Broadcom Inc.", "Technology"),
    ("AMD", "Advanced Micro Devices, Inc.", "Technology"),
    ("ADBE", "Adobe Inc.", "Technology"),
    ("CSCO", "Cisco Systems, Inc.", "Technology"),
    ("INTC", "Intel Corporation", "Technology"),
    ("QCOM", "QUALCOMM Incorporated", "Technology"),
    ("TXN", "Texas Instruments Incorporated", "Technology"),
    ("AMAT", "Applied Materials, Inc.", "Technology"),
    ("MU", "Micron Technology, Inc.", "Technology"),
    ("INTU", "Intuit Inc.", "Technology"),
    ("LRCX", "Lam Research Corporation", "Technology"),
    ("ADI", "Analog Devices, Inc.", "Technology"),
    ("KLAC", "KLA Corporation", "Technology"),
    ("SNPS", "Synopsys, Inc.", "Technology"),
    ("CDNS", "Cadence Design Systems, Inc.", "Technology"),
    ("NXPI", "NXP Semiconductors N.V.", "Technology"),
    ("MRVL", "Marvell Technology, Inc.", "Technology"),
    ("CRWD", "CrowdStrike Holdings, Inc.", "Technology"),
    ("PANW", "Palo Alto Networks, Inc.", "Technology"),
    ("FTNT", "Fortinet, Inc.", "Technology"),
    ("ADSK", "Autodesk, Inc.", "Technology"),
    ("MCHP", "Microchip Technology Incorporated", "Technology"),
    ("ASML", "ASML Holding N.V.", "Technology"),
    ("TEAM", "Atlassian Corporation", "Technology"),
    ("WDAY", "Workday, Inc.", "Technology"),
    ("ZS", "Zscaler, Inc.", "Technology"),
    ("CDW", "CDW Corporation", "Technology"),
    ("ON", "ON Semiconductor Corporation", "Technology"),
    ("GFS", "GlobalFoundries Inc.", "Technology"),
    ("TTD", "The Trade Desk, Inc.", "Technology"),
    ("DDOG", "Datadog, Inc.", "Technology"),
    ("MDB", "MongoDB, Inc.", "Technology"),
    ("ROP", "Roper Technologies, Inc.", "Technology"),
    ("APP", "AppLovin Corporation", "Technology"),
    ("PLTR", "Palantir Technologies Inc.", "Technology"),
    ("ARM", "Arm Holdings plc", "Technology"),
    ("MSTR", "Strategy Inc. (MicroStrategy)", "Technology"),

    # --- Communication Services ---
    ("GOOGL", "Alphabet Inc. (Class A)", "Communication Services"),
    ("GOOG", "Alphabet Inc. (Class C)", "Communication Services"),
    ("META", "Meta Platforms, Inc.", "Communication Services"),
    ("NFLX", "Netflix, Inc.", "Communication Services"),
    ("CMCSA", "Comcast Corporation", "Communication Services"),
    ("TMUS", "T-Mobile US, Inc.", "Communication Services"),
    ("CHTR", "Charter Communications, Inc.", "Communication Services"),
    ("WBD", "Warner Bros. Discovery, Inc.", "Communication Services"),
    ("EA", "Electronic Arts Inc.", "Communication Services"),
    ("TTWO", "Take-Two Interactive Software, Inc.", "Communication Services"),

    # --- Consumer Discretionary ---
    ("AMZN", "Amazon.com, Inc.", "Consumer Discretionary"),
    ("TSLA", "Tesla, Inc.", "Consumer Discretionary"),
    ("BKNG", "Booking Holdings Inc.", "Consumer Discretionary"),
    ("MELI", "MercadoLibre, Inc.", "Consumer Discretionary"),
    ("ABNB", "Airbnb, Inc.", "Consumer Discretionary"),
    ("ORLY", "O'Reilly Automotive, Inc.", "Consumer Discretionary"),
    ("MAR", "Marriott International, Inc.", "Consumer Discretionary"),
    ("LULU", "Lululemon Athletica Inc.", "Consumer Discretionary"),
    ("ROST", "Ross Stores, Inc.", "Consumer Discretionary"),
    ("DASH", "DoorDash, Inc.", "Consumer Discretionary"),
    ("PDD", "PDD Holdings Inc.", "Consumer Discretionary"),
    ("SBUX", "Starbucks Corporation", "Consumer Discretionary"),

    # --- Consumer Staples ---
    ("COST", "Costco Wholesale Corporation", "Consumer Staples"),
    ("PEP", "PepsiCo, Inc.", "Consumer Staples"),
    ("MDLZ", "Mondelez International, Inc.", "Consumer Staples"),
    ("KHC", "The Kraft Heinz Company", "Consumer Staples"),
    ("MNST", "Monster Beverage Corporation", "Consumer Staples"),
    ("KDP", "Keurig Dr Pepper Inc.", "Consumer Staples"),
    ("CCEP", "Coca-Cola Europacific Partners PLC", "Consumer Staples"),

    # --- Health Care ---
    ("AMGN", "Amgen Inc.", "Health Care"),
    ("GILD", "Gilead Sciences, Inc.", "Health Care"),
    ("VRTX", "Vertex Pharmaceuticals Incorporated", "Health Care"),
    ("REGN", "Regeneron Pharmaceuticals, Inc.", "Health Care"),
    ("ISRG", "Intuitive Surgical, Inc.", "Health Care"),
    ("MRNA", "Moderna, Inc.", "Health Care"),
    ("IDXX", "IDEXX Laboratories, Inc.", "Health Care"),
    ("DXCM", "DexCom, Inc.", "Health Care"),
    ("BIIB", "Biogen Inc.", "Health Care"),
    ("GEHC", "GE HealthCare Technologies Inc.", "Health Care"),
    ("AZN", "AstraZeneca PLC", "Health Care"),

    # --- Industrials ---
    ("HON", "Honeywell International Inc.", "Industrials"),
    ("CSX", "CSX Corporation", "Industrials"),
    ("CTAS", "Cintas Corporation", "Industrials"),
    ("PCAR", "PACCAR Inc", "Industrials"),
    ("ODFL", "Old Dominion Freight Line, Inc.", "Industrials"),
    ("FAST", "Fastenal Company", "Industrials"),
    ("CPRT", "Copart, Inc.", "Industrials"),
    ("VRSK", "Verisk Analytics, Inc.", "Industrials"),
    ("PAYX", "Paychex, Inc.", "Industrials"),
    ("ADP", "Automatic Data Processing, Inc.", "Industrials"),
    ("AXON", "Axon Enterprise, Inc.", "Industrials"),

    # --- Financials ---
    ("PYPL", "PayPal Holdings, Inc.", "Financials"),
    ("FISV", "Fiserv, Inc.", "Financials"),

    # --- Real Estate ---
    ("CSGP", "CoStar Group, Inc.", "Real Estate"),

    # --- Utilities ---
    ("XEL", "Xcel Energy Inc.", "Utilities"),
    ("AEP", "American Electric Power Company, Inc.", "Utilities"),
    ("CEG", "Constellation Energy Corporation", "Utilities"),

    # --- Energy ---
    ("FANG", "Diamondback Energy, Inc.", "Energy"),
    ("BKR", "Baker Hughes Company", "Energy"),

    # --- Materials ---
    ("LIN", "Linde plc", "Materials"),
]


# ---------------------------------------------------------------------------
# 로깅
# ---------------------------------------------------------------------------

_log_lines: list[str] = []


def log(msg: str) -> None:
    line = f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')}] {msg}"
    print(line)
    _log_lines.append(line)


def flush_log() -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text("\n".join(_log_lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# 수집
# ---------------------------------------------------------------------------

def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def download_batch(tickers: list[str]) -> dict[str, pd.DataFrame]:
    """티커 배치를 다운로드해 {ticker: DataFrame(OHLCV)} 로 반환."""
    data = yf.download(
        tickers=tickers,
        period=PERIOD,
        interval=INTERVAL,
        auto_adjust=True,       # 배당·분할 반영 (지표 일관성)
        group_by="ticker",
        threads=True,
        progress=False,
    )

    result: dict[str, pd.DataFrame] = {}
    if len(tickers) == 1:
        # 단일 티커는 컬럼이 평탄(non-MultiIndex)하게 온다
        t = tickers[0]
        if not data.empty:
            result[t] = data
        return result

    # 다중 티커: 최상위 컬럼 레벨이 티커
    available = set(data.columns.get_level_values(0)) if isinstance(data.columns, pd.MultiIndex) else set()
    for t in tickers:
        if t in available:
            df = data[t]
            result[t] = df
    return result


def build_series(df: pd.DataFrame) -> tuple[list[dict] | None, str | None]:
    """DataFrame → series 리스트. 실패 시 (None, 사유)."""
    if df is None or df.empty:
        return None, "빈 데이터 (조회 결과 없음)"

    # 필요한 컬럼만, 전부 결측인 행 제거
    cols = ["High", "Low", "Close", "Volume"]
    for c in cols:
        if c not in df.columns:
            return None, f"컬럼 누락: {c}"

    sub = df[cols].dropna(how="all")

    series: list[dict] = []
    missing_rows = 0
    for idx, row in sub.iterrows():
        high, low, close, vol = row["High"], row["Low"], row["Close"], row["Volume"]
        if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in (high, low, close, vol)):
            missing_rows += 1
            continue
        date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
        series.append({
            "date": date_str,
            "high": round(float(high), 4),
            "low": round(float(low), 4),
            "close": round(float(close), 4),
            "volume": int(vol),
        })

    if len(series) < MIN_TRADING_DAYS:
        return None, f"거래일 부족: {len(series)}일 < 최소 {MIN_TRADING_DAYS}일 (결측 {missing_rows}행)"

    return series, None


def main() -> int:
    log(f"수집 시작: 나스닥100 후보 {len(NASDAQ100)}종목, 기간={PERIOD}, 간격={INTERVAL}")

    meta = {t: (name, sector) for (t, name, sector) in NASDAQ100}
    all_tickers = [t for (t, _, _) in NASDAQ100]

    raw: dict[str, pd.DataFrame] = {}
    for batch in chunked(all_tickers, BATCH_SIZE):
        log(f"다운로드 배치: {', '.join(batch)}")
        try:
            raw.update(download_batch(batch))
        except Exception as e:
            log(f"[WARN] 배치 다운로드 실패({batch}): {e} — 개별 재시도")
            for t in batch:
                try:
                    raw.update(download_batch([t]))
                except Exception as e2:
                    log(f"[WARN] 개별 다운로드 실패({t}): {e2}")
        time.sleep(BATCH_SLEEP_SEC)

    # 1차 빌드
    built: dict[str, list[dict]] = {}
    failed: dict[str, str] = {}
    for t in all_tickers:
        series, reason = build_series(raw.get(t))
        if series is None:
            failed[t] = reason
        else:
            built[t] = series

    # 전송/캐시 경합('database is locked' 등)으로 인한 일시적 실패는 개별 재시도
    RETRIES = 2
    for attempt in range(1, RETRIES + 1):
        if not failed:
            break
        retry_targets = list(failed.keys())
        log(f"재시도 {attempt}/{RETRIES}: {', '.join(retry_targets)}")
        for t in retry_targets:
            time.sleep(0.5)
            try:
                one = download_batch([t])
            except Exception as e:
                log(f"[WARN] 재시도 다운로드 실패({t}): {e}")
                continue
            series, reason = build_series(one.get(t))
            if series is not None:
                built[t] = series
                del failed[t]
            else:
                failed[t] = reason

    included: list[dict] = []
    excluded: list[tuple[str, str]] = []

    for t in all_tickers:
        name, sector = meta[t]
        if t not in built:
            reason = failed.get(t, "알 수 없는 사유")
            excluded.append((t, reason))
            log(f"[제외] {t} ({name}): {reason}")
            continue
        series = built[t]
        included.append({
            "ticker": t,
            "name": name,
            "sector": sector,
            "series": series,
        })

    # generatedAt = 수집된 데이터 중 가장 최근 거래일 (없으면 오늘 UTC)
    latest_date = None
    for tk in included:
        d = tk["series"][-1]["date"]
        if latest_date is None or d > latest_date:
            latest_date = d
    generated_at = latest_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    payload = {
        "generatedAt": generated_at,
        "tickers": included,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    log("-" * 60)
    log(f"수집 완료: 포함 {len(included)}종목 / 제외 {len(excluded)}종목")
    if excluded:
        log("제외 목록: " + ", ".join(f"{t}({r.split(':')[0]})" for t, r in excluded))
    log(f"데이터 기준일(generatedAt): {generated_at}")
    out_size_bytes = OUT_PATH.stat().st_size
    out_size_mb = out_size_bytes / (1024 * 1024)
    log(f"저장: {OUT_PATH.relative_to(ROOT)}  (크기 {out_size_bytes:,} bytes, {out_size_mb:.2f} MB)")
    if out_size_mb > 10:
        log(f"[WARN] 파일 크기가 10MB를 초과했습니다 ({out_size_mb:.2f} MB) — GitHub Pages 전송량 확인 필요")
    flush_log()
    return 0


if __name__ == "__main__":
    sys.exit(main())
