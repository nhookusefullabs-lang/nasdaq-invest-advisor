#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
나스닥100 데이터 수집 스크립트 (PRD_Nasdaq4 §7)
3년 수집 — 미너비니 트렌드 템플릿(SMA200·52주 고저)과 v9 백테스트 평가 구간 확보용
(PRD_Nasdaq8 §7 US-1 → PRD_Nasdaq9 §3 Should-2 US-9로 2년에서 3년 확대)

- yfinance로 나스닥100 종목의 3년치 일별 OHLCV를 1회 수집한다.
- 지표(RSI/MACD)의 워밍업(~35거래일), 52주 신고가/신저가(252거래일), SMA200 워밍업,
  백테스트 워밍업(252거래일) 제외 후 평가 구간 약 2년 확보 + 보유기간(최대 60거래일)
  여유분까지 감안해 3년치를 받고, 시뮬레이션·화면 표시는 웹앱에서 최근 63거래일만 사용한다.
- 데이터 부족·결측으로 지표 계산이 불안정한 종목은 제외하고 사유를 로그로 남긴다.
- 결과를 public/data/nasdaq100.json 으로 저장한다.

스키마 (고정):
{
  "generatedAt": "YYYY-MM-DD",
  "tickers": [
    { "ticker": "AAPL", "name": "Apple Inc.", "sector": "Technology",
      "series": [ {"date": "YYYY-MM-DD", "open": 0, "high": 0, "low": 0, "close": 0, "volume": 0} ] }
  ]
}

사용법:
    python scripts/collect_data.py
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Windows 콘솔의 기본 코드페이지(cp949 등)는 이 스크립트가 출력하는 한글/특수문자
# (예: em dash '—')를 인코딩하지 못해 UnicodeEncodeError로 죽을 수 있다 — stdout/stderr을
# UTF-8로 강제해 플랫폼 기본 코드페이지와 무관하게 항상 출력되도록 한다.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

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
# 52주 신고가/신저가(252거래일) + 미너비니 SMA200 워밍업(200거래일)에 더해, v9 백테스트의
# 워밍업(252거래일) 제외 후 평가 구간 약 2년(≈504거래일) + 보유기간 최대 60거래일 여유분을
# 확보하기 위해 "3y"(약 756거래일)로 확대한다 (PRD_Nasdaq9 §3 Should-2, US-9).
# 참고: "12mo"(="1y")는 실측상 251거래일만 반환해 252거래일 문턱을 1일 못 채우는 문제가
# 있었다(캘린더 정렬에 따라 250~251로 흔들림) — "2y"/"3y"는 이 문제에서도 안전하게 벗어난다.
PERIOD = "3y"
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
FUNDAMENTALS_OUT_PATH = ROOT / "public" / "data" / "fundamentals.json"
FUNDAMENTALS_SCHEMA_VERSION = 1

# --- NGX(Nasdaq Next Gen 100) 파일럿 (PRD_Nasdaq10 §4.1, US-1) ---
# 측정 전용 별도 유니버스: QQQJ(Invesco NASDAQ Next Gen 100 ETF) 보유 종목 기반.
NGX_OUT_PATH = ROOT / "public" / "data" / "ngx100.json"
NGX_FUNDAMENTALS_OUT_PATH = ROOT / "public" / "data" / "fundamentals_ngx.json"
# 기본 소스는 로컬 CSV 경로 (운영자가 QQQJ 보유종목 공시 CSV를 내려받아 배치) — CLI로 교체 가능.
NGX_DEFAULT_SOURCE = ROOT / "scripts" / "ngx_holdings.csv"
# 유동성 가드레일 (미너비니 스크리닝 관례): 주가 최소치, 20일 평균 거래대금 최소치.
NGX_MIN_PRICE = 10.0
NGX_MIN_DOLLAR_VOL = 20_000_000.0
NGX_DOLLAR_VOL_WINDOW = 20
# hasFullYearData(client)의 252거래일 문턱 — NGX는 이 미만이어도 수집 자체는 제외하지 않고
# (기존 MIN_TRADING_DAYS=200 floor만 적용), 신규상장이 많을 것으로 예상되는 만큼 집계만 남긴다.
NGX_FULL_YEAR_THRESHOLD = 252
# 나스닥 라인으로 인정하는 거래소 표기 (이중상장 종목의 비-나스닥 라인은 이 목록 밖)
NGX_NASDAQ_EXCHANGE_TOKENS = {"", "NASDAQ", "NASDAQ GS", "NASDAQ GM", "NASDAQ CM", "NAS", "NASDAQGS", "NASDAQGM", "NASDAQCM"}
# 펀더멘털 허들 판정에 최소 필요한 분기 수 (전년 동기 비교에 4분기 전 데이터가 필요하므로
# 5개 미만이면 F1/F3 성장률은 계산 불가하지만, 종목 자체를 제외하는 하한은 2개로 낮게 둔다
# — PRD_Nasdaq8 §4.4 "missing[]" 결측 처리 원칙: 계산 불가 항목은 판정불가로만 표시하고
# 종목 전체를 배제하지 않는다).
FUNDAMENTALS_MIN_QUARTERS = 2


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
    # "open"(시가)은 PRD_Nasdaq10 §4.5 US-8의 진입 변형 체결가(= max(트리거가, 당일 시가))
    # 계산에 필요해 v10에서 추가됐다 — 기존 지표는 전부 close/high/low/volume만 쓰므로
    # 이 필드 추가가 기존 로직에 영향을 주지 않는다(순수 추가).
    cols = ["Open", "High", "Low", "Close", "Volume"]
    for c in cols:
        if c not in df.columns:
            return None, f"컬럼 누락: {c}"

    sub = df[cols].dropna(how="all")

    series: list[dict] = []
    missing_rows = 0
    for idx, row in sub.iterrows():
        open_, high, low, close, vol = row["Open"], row["High"], row["Low"], row["Close"], row["Volume"]
        if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in (open_, high, low, close, vol)):
            missing_rows += 1
            continue
        date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
        series.append({
            "date": date_str,
            "open": round(float(open_), 4),
            "high": round(float(high), 4),
            "low": round(float(low), 4),
            "close": round(float(close), 4),
            "volume": int(vol),
        })

    if len(series) < MIN_TRADING_DAYS:
        return None, f"거래일 부족: {len(series)}일 < 최소 {MIN_TRADING_DAYS}일 (결측 {missing_rows}행)"

    return series, None


# ---------------------------------------------------------------------------
# 펀더멘털 수집 (PRD_Nasdaq8 §3 Must-2, §7, US-2)
# 가격 수집과 같은 스크립트에서, 같은 주기(토요일 1회)로 동시 수집한다 — 운영 단순화.
# ---------------------------------------------------------------------------

def _row_value(row, col):
    """pandas Series에서 col 위치 값을 안전하게 float로. 결측/미존재면 None."""
    if row is None or col not in row.index:
        return None
    v = row[col]
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return float(v)


def fetch_fundamentals(ticker: str) -> tuple[dict | None, str | None]:
    """단일 티커의 펀더멘털 스냅샷 계산. 실패 시 (None, 사유)."""
    try:
        tk = yf.Ticker(ticker)
        qf = tk.quarterly_financials  # DataFrame: index=계정과목, columns=분기말 날짜(내림차순)
        info = tk.info or {}
    except Exception as e:
        return None, f"yfinance 조회 실패: {e}"

    if qf is None or qf.empty:
        return None, "분기 재무제표 없음"

    cols = sorted(qf.columns, reverse=True)  # 최신 분기가 먼저
    if len(cols) < FUNDAMENTALS_MIN_QUARTERS:
        return None, f"분기 데이터 부족: {len(cols)}개 < 최소 {FUNDAMENTALS_MIN_QUARTERS}개"

    revenue_row = qf.loc["Total Revenue"] if "Total Revenue" in qf.index else None
    net_income_row = qf.loc["Net Income"] if "Net Income" in qf.index else None
    operating_income_row = qf.loc["Operating Income"] if "Operating Income" in qf.index else None
    shares_outstanding = info.get("sharesOutstanding")

    quarters: list[dict] = []
    for col in cols[:5]:
        period_label = f"{col.year}-Q{(col.month - 1) // 3 + 1}"
        revenue = _row_value(revenue_row, col)
        operating_income = _row_value(operating_income_row, col)
        operating_margin = (operating_income / revenue) if (operating_income is not None and revenue) else None

        # yfinance의 quarterly_financials에는 분기 EPS가 직접 없어, 순이익/발행주식수로 근사한다
        # (§7 스키마의 eps는 "근사 EPS"임을 명시 — 정밀 EPS가 필요하면 v9에서 별도 소스 검토).
        net_income = _row_value(net_income_row, col)
        eps = (net_income / shares_outstanding) if (net_income is not None and shares_outstanding) else None

        quarters.append({
            "period": period_label,
            "eps": round(eps, 4) if eps is not None else None,
            "revenue": round(revenue, 2) if revenue is not None else None,
            "operatingMargin": round(operating_margin, 4) if operating_margin is not None else None,
        })

    missing: list[str] = []

    # F1: 분기 EPS 성장률(전년 동기 대비, 4분기 전과 비교)
    eps_growth_yoy = None
    if len(quarters) >= 5 and quarters[0]["eps"] is not None and quarters[4]["eps"]:
        eps_growth_yoy = (quarters[0]["eps"] / quarters[4]["eps"] - 1) * 100
    if eps_growth_yoy is None:
        missing.append("F1")

    # F2: EPS 성장 가속 (최근 분기 EPS가 직전 분기보다 큼 — 간이 근사)
    eps_accelerating = None
    if len(quarters) >= 2 and quarters[0]["eps"] is not None and quarters[1]["eps"] is not None:
        eps_accelerating = quarters[0]["eps"] > quarters[1]["eps"]
    if eps_accelerating is None:
        missing.append("F2")

    # F3: 분기 매출 성장률(전년 동기 대비)
    revenue_growth_yoy = None
    if len(quarters) >= 5 and quarters[0]["revenue"] is not None and quarters[4]["revenue"]:
        revenue_growth_yoy = (quarters[0]["revenue"] / quarters[4]["revenue"] - 1) * 100
    if revenue_growth_yoy is None:
        missing.append("F3")

    # F4: 영업마진 개선 추세 (최근 분기 >= 직전 분기)
    margin_improving = None
    if len(quarters) >= 2 and quarters[0]["operatingMargin"] is not None and quarters[1]["operatingMargin"] is not None:
        margin_improving = quarters[0]["operatingMargin"] >= quarters[1]["operatingMargin"]
    if margin_improving is None:
        missing.append("F4")

    # F5: ROE
    roe = info.get("returnOnEquity")
    if roe is None:
        missing.append("F5")

    return {
        "ticker": ticker,
        "epsGrowthQoQ_yoy": round(eps_growth_yoy, 2) if eps_growth_yoy is not None else None,
        "epsAccelerating": eps_accelerating,
        "revenueGrowthQoQ_yoy": round(revenue_growth_yoy, 2) if revenue_growth_yoy is not None else None,
        "marginImproving": margin_improving,
        "roe": round(float(roe), 4) if roe is not None else None,
        "quarters": quarters,
        "missing": missing,
    }, None


def collect_fundamentals(tickers: list[str], out_path: Path = FUNDAMENTALS_OUT_PATH) -> None:
    """가격 수집과 동일 실행에서 펀더멘털 스냅샷을 수집해 원자적으로 저장한다."""
    log("-" * 60)
    log(f"펀더멘털 수집 시작: 후보 {len(tickers)}종목 → {out_path.relative_to(ROOT)}")

    included: list[dict] = []
    excluded: list[dict] = []
    for t in tickers:
        data, reason = fetch_fundamentals(t)
        if data is None:
            excluded.append({"ticker": t, "reason": reason})
            log(f"[펀더멘털 제외] {t}: {reason}")
        else:
            included.append(data)
        time.sleep(0.3)

    payload = {
        "schemaVersion": FUNDAMENTALS_SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "tickers": included,
        "excluded": excluded,
    }

    # 원자적 쓰기: 임시 파일에 먼저 쓰고 rename — 도중 실패해도 기존 fundamentals.json은
    # 훼손되지 않는다 (v6 research.json atomicWriteResearch 패턴 재사용, PRD_Nasdaq8 US-2).
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(out_path)

    log(f"펀더멘털 수집 완료: 포함 {len(included)}종목 / 제외 {len(excluded)}종목")
    log(f"저장: {out_path.relative_to(ROOT)}")


# ---------------------------------------------------------------------------
# NGX(Nasdaq Next Gen 100) 파일럿 — 순수 함수 (PRD_Nasdaq10 §4.1, US-1)
# ---------------------------------------------------------------------------

def normalize_ticker(raw: str) -> str:
    """CSV 원본 티커 표기 → yfinance 조회 가능한 정규 티커.
    공백 제거·대문자화, 괄호 각주(예: '(W/I)')와 말미 '*' 각주 표기를 제거한다.
    """
    t = raw.strip().upper()
    t = re.sub(r"\s*\([^)]*\)\s*$", "", t).strip()
    t = t.rstrip("*").strip()
    return t


def is_non_nasdaq_line(row: dict) -> bool:
    """이중상장 종목의 비-나스닥 라인(해외 1차 상장 등) 여부."""
    exch = str(row.get("Exchange") or row.get("exchange") or "").strip().upper()
    return exch not in NGX_NASDAQ_EXCHANGE_TOKENS


def load_ngx_ticker_source(path: Path) -> tuple[list[tuple[str, str, str]], list[dict]]:
    """QQQJ 보유종목 공시 CSV → (포함 (ticker,name,sector) 목록, 제외 사유 목록).
    CSV 컬럼: Ticker,Name,Sector,Exchange (Exchange는 선택 — 없으면 나스닥 라인으로 간주).
    """
    included: list[tuple[str, str, str]] = []
    excluded: list[dict] = []
    seen: set[str] = set()

    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw_ticker = str(row.get("Ticker") or row.get("ticker") or "")
            if not raw_ticker.strip():
                continue
            if is_non_nasdaq_line(row):
                excluded.append({
                    "ticker": raw_ticker.strip(),
                    "reason": f"이중상장 비-나스닥 라인 제외 (거래소: {row.get('Exchange', '')})",
                })
                continue
            ticker = normalize_ticker(raw_ticker)
            if not ticker or ticker in seen:
                continue
            seen.add(ticker)
            name = str(row.get("Name") or row.get("name") or ticker).strip()
            sector = str(row.get("Sector") or row.get("sector") or "Unknown").strip()
            included.append((ticker, name, sector))

    return included, excluded


def passes_liquidity_guardrail(series: list[dict]) -> tuple[bool, str | None]:
    """NGX 유동성 가드레일: 최근 종가 ≥ $10, 최근 20일 평균 거래대금 ≥ $20M.
    미달 시 (False, 사유) — 종가/거래대금 중 먼저 걸리는 조건의 사유를 반환한다.
    """
    if not series:
        return False, "데이터 없음"

    last_close = series[-1]["close"]
    if last_close < NGX_MIN_PRICE:
        return False, f"주가 미달 (${last_close:.2f} < ${NGX_MIN_PRICE:.2f})"

    window = series[-NGX_DOLLAR_VOL_WINDOW:]
    avg_dollar_vol = sum(b["close"] * b["volume"] for b in window) / len(window)
    if avg_dollar_vol < NGX_MIN_DOLLAR_VOL:
        return False, (
            f"{NGX_DOLLAR_VOL_WINDOW}일 평균 거래대금 미달 "
            f"(${avg_dollar_vol:,.0f} < ${NGX_MIN_DOLLAR_VOL:,.0f})"
        )

    return True, None


def collect_ngx(source_path: Path) -> int:
    """NGX 유니버스를 나스닥100과 동일 품질로 수집한다 (측정 전용, UI 미노출)."""
    if not source_path.exists():
        log(f"[ERROR] NGX 티커 소스 CSV를 찾을 수 없습니다: {source_path}")
        log("        QQQJ 보유종목 공시 CSV를 준비해 --ngx-source로 경로를 지정하세요.")
        return 1

    candidates, source_excluded = load_ngx_ticker_source(source_path)
    log(f"NGX 수집 시작: 소스={source_path.relative_to(ROOT) if source_path.is_relative_to(ROOT) else source_path}, "
        f"후보 {len(candidates)}종목 (소스 단계 제외 {len(source_excluded)}종목)")

    meta = {t: (name, sector) for (t, name, sector) in candidates}
    all_tickers = [t for (t, _, _) in candidates]

    raw: dict[str, pd.DataFrame] = {}
    for batch in chunked(all_tickers, BATCH_SIZE):
        log(f"[NGX] 다운로드 배치: {', '.join(batch)}")
        try:
            raw.update(download_batch(batch))
        except Exception as e:
            log(f"[WARN][NGX] 배치 다운로드 실패({batch}): {e} — 개별 재시도")
            for t in batch:
                try:
                    raw.update(download_batch([t]))
                except Exception as e2:
                    log(f"[WARN][NGX] 개별 다운로드 실패({t}): {e2}")
        time.sleep(BATCH_SLEEP_SEC)

    included: list[dict] = []
    excluded: list[dict] = list(source_excluded)
    full_year_short_count = 0

    for t in all_tickers:
        name, sector = meta[t]
        series, reason = build_series(raw.get(t))
        if series is None:
            excluded.append({"ticker": t, "reason": reason})
            log(f"[제외][NGX] {t} ({name}): {reason}")
            continue

        ok, guard_reason = passes_liquidity_guardrail(series)
        if not ok:
            excluded.append({"ticker": t, "reason": guard_reason})
            log(f"[제외][NGX] {t} ({name}): {guard_reason}")
            continue

        if len(series) < NGX_FULL_YEAR_THRESHOLD:
            full_year_short_count += 1

        included.append({"ticker": t, "name": name, "sector": sector, "series": series})

    latest_date = None
    for tk in included:
        d = tk["series"][-1]["date"]
        if latest_date is None or d > latest_date:
            latest_date = d
    generated_at = latest_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    payload = {
        "generatedAt": generated_at,
        "tickers": included,
        "excluded": excluded,
    }

    NGX_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    NGX_OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    log("-" * 60)
    log(f"[NGX] 수집 완료: 포함 {len(included)}종목 / 제외 {len(excluded)}종목 "
        f"(252거래일 미만 {full_year_short_count}종목 — hasFullYearData가 판정)")
    log(f"[NGX] 데이터 기준일(generatedAt): {generated_at}")
    log(f"[NGX] 저장: {NGX_OUT_PATH.relative_to(ROOT)}")

    collect_fundamentals(all_tickers, out_path=NGX_FUNDAMENTALS_OUT_PATH)

    flush_log()
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--universe", choices=["ndx", "ngx"], default="ndx",
        help="수집할 유니버스 (기본 ndx — 나스닥100, 기존 동작 불변). ngx=Nasdaq Next Gen 100 파일럿",
    )
    parser.add_argument(
        "--ngx-source", default=str(NGX_DEFAULT_SOURCE),
        help="NGX(QQQJ 보유종목) 티커 소스 CSV 경로",
    )
    return parser.parse_args(argv)


def collect_ndx() -> int:
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

    # 가격 수집과 같은 실행에서 펀더멘털도 동시 수집한다 (PRD_Nasdaq8 §3 Must-2, US-2)
    collect_fundamentals(all_tickers)

    flush_log()
    return 0


def main() -> int:
    args = parse_args()
    if args.universe == "ngx":
        return collect_ngx(Path(args.ngx_source))
    return collect_ndx()


if __name__ == "__main__":
    sys.exit(main())
