# -*- coding: utf-8 -*-
"""
💎 ربات سیگنال خرید اسپات — نسخه پایتونی اندیکاتور Spot Buy Scanner
✍️  طراحی و توسعه توسط آرمان ناصری

همان منطق اندیکاتور تریدینگ‌ویو، ولی:
  ✅ بدون نیاز به هیچ پلن پولی
  ✅ ۲۴ ساعته روی سرور، حتی وقتی گوشی خاموش است
  ✅ سیگنال خرید و فروش مستقیم در تلگرام
  ✅ معامله‌های باز را به خاطر می‌سپارد و زمان فروش را خبر می‌دهد

اجرا:
    BOT_TOKEN=... CHAT_ID=... python3 spot_bot.py
    python3 spot_bot.py --once       یک اسکن و خروج
    python3 spot_bot.py --selftest   تست منطق بدون اینترنت و بدون تلگرام
"""

from __future__ import annotations

import json
import math
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

# ═══════════════════════════════ تنظیمات ═══════════════════════════════
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
CHAT_ID = os.environ.get("CHAT_ID", "")

SYMBOLS = [s.strip().upper() for s in os.environ.get(
    "SYMBOLS",
    "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,"
    "LINKUSDT,TONUSDT,TRXUSDT,DOTUSDT,NEARUSDT,SUIUSDT,LTCUSDT",
).split(",") if s.strip()]

INTERVAL = os.environ.get("INTERVAL", "1h")          # تایم‌فریم تحلیل
MIN_SCORE = float(os.environ.get("MIN_SCORE", "65"))  # حداقل امتیاز خرید
MAX_RSI_BUY = float(os.environ.get("MAX_RSI_BUY", "68"))
TP1_MULT = float(os.environ.get("TP1_MULT", "1.2"))
TP2_MULT = float(os.environ.get("TP2_MULT", "2.4"))
SL_MULT = float(os.environ.get("SL_MULT", "1.6"))
HOLD_HOURS = float(os.environ.get("HOLD_HOURS", "12"))
EXIT_RSI = float(os.environ.get("EXIT_RSI", "78"))
NEED_BTC_OK = os.environ.get("NEED_BTC_OK", "1") != "0"
MAX_POSITIONS = int(os.environ.get("MAX_POSITIONS", "5"))
SUMMARY_EVERY = int(os.environ.get("SUMMARY_EVERY", "6"))  # هر چند اسکن، خلاصه بازار
STATE_FILE = os.environ.get("STATE_FILE", "state.json")

TEHRAN = timezone(timedelta(hours=3, minutes=30))
SIGN = "✍️ طراحی و توسعه توسط آرمان ناصری"

BASES = [
    "https://api.binance.com",
    "https://api-gcp.binance.com",
    "https://api1.binance.com",
    "https://data-api.binance.vision",
]

TF_SECONDS = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "12h": 43200, "1d": 86400,
}


# ═══════════════════════════ ابزار ریاضی ═══════════════════════════════
def sma(values, length):
    if len(values) < length:
        return None
    return sum(values[-length:]) / length


def ema_series(values, length):
    if len(values) < length:
        return []
    k = 2 / (length + 1)
    out = [sum(values[:length]) / length]
    for v in values[length:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def ema(values, length):
    s = ema_series(values, length)
    return s[-1] if s else None


def rma_series(values, length):
    """میانگین وایلدر — پایه RSI و ATR و ADX"""
    if len(values) < length:
        return []
    out = [sum(values[:length]) / length]
    for v in values[length:]:
        out.append((out[-1] * (length - 1) + v) / length)
    return out


def rsi(closes, length=14):
    if len(closes) < length + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    ag = rma_series(gains, length)
    al = rma_series(losses, length)
    if not ag or not al:
        return None
    if al[-1] == 0:
        return 100.0
    rs = ag[-1] / al[-1]
    return 100 - (100 / (1 + rs))


def macd(closes, fast=12, slow=26, signal=9):
    if len(closes) < slow + signal:
        return None, None, None, None
    fast_s = ema_series(closes, fast)
    slow_s = ema_series(closes, slow)
    offset = len(fast_s) - len(slow_s)
    line = [f - s for f, s in zip(fast_s[offset:], slow_s)]
    sig = ema_series(line, signal)
    if not sig:
        return None, None, None, None
    hist = [l - s for l, s in zip(line[len(line) - len(sig):], sig)]
    prev_hist = hist[-2] if len(hist) > 1 else hist[-1]
    return line[-1], sig[-1], hist[-1], prev_hist


def true_ranges(highs, lows, closes):
    tr = []
    for i in range(1, len(closes)):
        tr.append(max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        ))
    return tr


def atr(highs, lows, closes, length=14):
    tr = true_ranges(highs, lows, closes)
    s = rma_series(tr, length)
    return s[-1] if s else None


def adx(highs, lows, closes, length=14):
    if len(closes) < length * 2 + 2:
        return None
    plus_dm, minus_dm = [], []
    for i in range(1, len(closes)):
        up = highs[i] - highs[i - 1]
        dn = lows[i - 1] - lows[i]
        plus_dm.append(up if (up > dn and up > 0) else 0.0)
        minus_dm.append(dn if (dn > up and dn > 0) else 0.0)
    tr = true_ranges(highs, lows, closes)
    tr_s = rma_series(tr, length)
    p_s = rma_series(plus_dm, length)
    m_s = rma_series(minus_dm, length)
    if not tr_s or not p_s or not m_s:
        return None
    dx = []
    for t, p, m in zip(tr_s, p_s, m_s):
        if t == 0:
            continue
        pdi = 100 * p / t
        mdi = 100 * m / t
        if pdi + mdi == 0:
            continue
        dx.append(100 * abs(pdi - mdi) / (pdi + mdi))
    s = rma_series(dx, length)
    return s[-1] if s else None


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


# ═══════════════════════════ دریافت دیتا ═══════════════════════════════
def fetch_klines(symbol, interval=INTERVAL, limit=300):
    """کندل‌های بسته‌شده را برمی‌گرداند (کندل در حال شکل‌گیری حذف می‌شود)."""
    last_err = None
    for base in BASES:
        try:
            r = requests.get(
                base + "/api/v3/klines",
                params={"symbol": symbol, "interval": interval, "limit": limit},
                timeout=15,
            )
            if r.status_code != 200:
                last_err = f"{base} → {r.status_code}"
                continue
            raw = r.json()
            if not isinstance(raw, list) or len(raw) < 60:
                last_err = f"{base} → دیتای ناکافی"
                continue
            return [{
                "time": int(k[0]),
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
            } for k in raw[:-1]]
        except Exception as exc:  # noqa: BLE001
            last_err = f"{base} → {type(exc).__name__}"
    print(f"❌ دریافت دیتای {symbol} شکست خورد ({last_err})")
    return None


# ═══════════ موتور امتیازدهی — دقیقاً مطابق اندیکاتور تریدینگ‌ویو ═══════
def analyze(candles):
    closes = [c["close"] for c in candles]
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]
    vols = [c["volume"] for c in candles]
    if len(closes) < 210:
        return None

    price = closes[-1]
    e20 = ema(closes, 20)
    e50 = ema(closes, 50)
    e200 = ema(closes, 200)
    rsi_v = rsi(closes, 14)
    atr_v = atr(highs, lows, closes, 14)
    adx_v = adx(highs, lows, closes, 14) or 0.0
    m_line, m_sig, m_hist, m_prev = macd(closes)
    if None in (e20, e50, e200, rsi_v, atr_v, m_hist):
        return None

    v_ma = sma(vols, 20) or 0.0
    v_recent = sma(vols, 10) or 0.0
    v_prior = sma(vols[:-10], 10) or 0.0
    hi20 = max(highs[-20:])
    lo20 = min(lows[-20:])
    lo10 = min(lows[-10:])
    hh10 = max(highs[-11:-1])

    # ۱) روند
    trend_s = (0.4 if price > e50 else 0) + (0.4 if e50 > e200 else 0) + \
              (0.2 if price > e200 else 0)

    # ۲) مومنتوم
    momo_s = (0.55 if m_hist > 0 else 0) + (0.30 if m_hist > m_prev else 0) + \
             (0.15 if (m_line - m_sig) > 0 and adx_v > 20 else 0)

    # ۳) RSI سالم
    if 45 <= rsi_v <= 63:
        rsi_s = 1.0
    elif 63 < rsi_v <= 70:
        rsi_s = 0.55
    elif 38 <= rsi_v < 45:
        rsi_s = 0.6
    else:
        rsi_s = 0.1

    # ۴) حجم تازه و افزایشی
    v_chg = ((v_recent - v_prior) / v_prior * 100) if v_prior > 0 else 0.0
    v_rat = (vols[-1] / v_ma) if v_ma > 0 else 1.0
    if 10 <= v_chg <= 110:
        vol_s = clamp(v_chg / 60, 0.35, 1.0)
    elif v_chg > 110:
        vol_s = 0.35
    elif v_chg > 0:
        vol_s = 0.25
    else:
        vol_s = 0.0
    if v_rat > 3.0:
        vol_s *= 0.5

    # ۵) ناحیه ارزش
    rng = hi20 - lo20
    pos = ((price - lo20) / rng * 100) if rng > 0 else 50.0
    if 30 <= pos <= 72:
        pull_s = 1.0
    elif 72 < pos <= 88:
        pull_s = 0.5
    elif 15 <= pos < 30:
        pull_s = 0.55
    else:
        pull_s = 0.15

    # ۶) قدرت روند
    adx_s = clamp((adx_v - 14) / 14, 0.0, 1.0)

    # ۷) ساختار
    str_s = (0.5 if lo10 > lo20 else 0) + (0.5 if price > hh10 else 0)

    # ۸) نوسان منطقی
    atr_p = atr_v / price * 100 if price else 0.0
    vola_s = 1.0 if 0.4 <= atr_p <= 5.0 else (0.3 if atr_p < 0.4 else 0.25)

    raw = (trend_s * 2.0 + momo_s * 1.5 + rsi_s * 1.2 + vol_s * 1.5 +
           pull_s * 1.2 + adx_s * 1.0 + str_s * 0.8 + vola_s * 0.8)
    score = clamp(raw * 10.0, 0.0, 100.0)

    return {
        "score": score, "price": price, "rsi": rsi_v, "atr": atr_v,
        "atr_pct": atr_p, "vol_chg": v_chg, "ema20": e20, "adx": adx_v,
        "tp1": price + atr_v * TP1_MULT,
        "tp2": price + atr_v * TP2_MULT,
        "sl": min(price - atr_v * SL_MULT, lo10 * 0.998),
    }


def btc_health(candles):
    closes = [c["close"] for c in candles]
    e50, e200, r = ema(closes, 50), ema(closes, 200), rsi(closes, 14)
    if None in (e50, e200, r):
        return None
    return (40 if closes[-1] > e50 else 0) + (30 if e50 > e200 else 0) + \
           (30 if r > 45 else 0)


def state_of(score, rsi_v, btc_ok):
    if score <= 0:
        return "—"
    if score >= MIN_SCORE and rsi_v <= MAX_RSI_BUY and (btc_ok or not NEED_BTC_OK):
        return "🟢 بخر"
    if score >= MIN_SCORE and rsi_v > MAX_RSI_BUY:
        return "⚠️ داغ / صبر"
    if score >= MIN_SCORE * 0.85:
        return "⏳ نزدیک است"
    if score >= MIN_SCORE * 0.6:
        return "😐 ضعیف"
    return "🚫 نخر"


# ═══════════════════════════ تلگرام ════════════════════════════════════
def send(text):
    print(text.replace("<b>", "").replace("</b>", "").replace("<pre>", "")
              .replace("</pre>", ""))
    if not BOT_TOKEN or not CHAT_ID:
        return False
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            data={"chat_id": CHAT_ID, "text": text[:4000], "parse_mode": "HTML",
                  "disable_web_page_preview": True},
            timeout=15,
        )
        return r.status_code == 200
    except Exception as exc:  # noqa: BLE001
        print("❌ خطای تلگرام:", exc)
        return False


def fmt(p):
    if p >= 1000:
        return f"{p:,.1f}"
    if p >= 100:
        return f"{p:.2f}"
    if p >= 1:
        return f"{p:.4f}"
    return f"{p:.6f}"


def now_str():
    return datetime.now(TEHRAN).strftime("%Y/%m/%d  %H:%M")


# ═══════════════════════════ ذخیره وضعیت ═══════════════════════════════
def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {"positions": {}, "scans": 0}


def save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as exc:  # noqa: BLE001
        print("❌ ذخیره وضعیت نشد:", exc)


# ═══════════════════════════ پیام‌ها ═══════════════════════════════════
def buy_message(symbol, a, btc_txt):
    return (
        f"💎 <b>خرید اسپات: {symbol}</b>\n"
        f"━━━━━━━━━━━━━━\n"
        f"📊 امتیاز: <b>{a['score']:.0f}/100</b>   |   بازار: {btc_txt}\n"
        f"💵 ورود: <code>{fmt(a['price'])}</code>\n"
        f"🎯 هدف ۱: <code>{fmt(a['tp1'])}</code>  "
        f"(+{(a['tp1'] / a['price'] - 1) * 100:.1f}%)  ← سود جزئی\n"
        f"🎯 هدف ۲: <code>{fmt(a['tp2'])}</code>  "
        f"(+{(a['tp2'] / a['price'] - 1) * 100:.1f}%)  ← فروش کامل\n"
        f"🛑 حد ضرر: <code>{fmt(a['sl'])}</code>  "
        f"({(a['sl'] / a['price'] - 1) * 100:.1f}%)\n"
        f"━━━━━━━━━━━━━━\n"
        f"RSI {a['rsi']:.0f}  ·  حجم {a['vol_chg']:+.0f}%  ·  نوسان {a['atr_pct']:.1f}%\n"
        f"⌛ حداکثر نگهداری: {HOLD_HOURS:.0f} ساعت\n"
        f"🕒 {now_str()}\n{SIGN}"
    )


def sell_message(symbol, pos, price, reason, hours):
    pnl = (price / pos["entry"] - 1) * 100
    face = "🟢" if pnl >= 0 else "🔴"
    return (
        f"💰 <b>فروش {symbol}</b> — {reason}\n"
        f"━━━━━━━━━━━━━━\n"
        f"ورود: <code>{fmt(pos['entry'])}</code>  →  خروج: <code>{fmt(price)}</code>\n"
        f"{face} نتیجه: <b>{pnl:+.2f}%</b>\n"
        f"⌛ مدت نگهداری: {hours:.1f} ساعت\n"
        f"🕒 {now_str()}\n{SIGN}"
    )


def summary_message(rows, btc_txt, positions):
    lines = [f"🔎 <b>وضعیت بازار</b>  |  {btc_txt}", "━━━━━━━━━━━━━━"]
    for sym, a, st in rows[:8]:
        lines.append(f"{a['score']:>3.0f} · {sym.replace('USDT', ''):<6} {st}")
    if not rows:
        lines.append("دیتایی دریافت نشد")
    lines.append("━━━━━━━━━━━━━━")
    if positions:
        lines.append("📌 <b>معامله‌های باز:</b>")
        for sym, p in positions.items():
            lines.append(f"   {sym.replace('USDT', '')}  از {fmt(p['entry'])}"
                         f"  🎯 {fmt(p['tp1'])} / {fmt(p['tp2'])}  🛑 {fmt(p['sl'])}")
    else:
        lines.append("📭 معامله‌ی بازی نیست")
    lines.append(f"🕒 {now_str()}\n{SIGN}")
    return "\n".join(lines)


# ═══════════════════════════ یک دور اسکن ══════════════════════════════
def scan_once(state):
    # ── سلامت بازار ──
    btc = fetch_klines("BTCUSDT", INTERVAL, 300)
    health = btc_health(btc) if btc else None
    btc_ok = health is None or health >= 40
    btc_txt = ("نامشخص" if health is None else
               "🟢 سالم" if health >= 70 else
               "🟡 خنثی" if health >= 40 else "🔴 ضعیف")
    mkt_mult = 1.0 if btc_ok else (0.75 if NEED_BTC_OK else 0.9)

    positions = state.setdefault("positions", {})
    rows = []

    for symbol in SYMBOLS:
        candles = fetch_klines(symbol, INTERVAL, 300)
        if not candles:
            continue
        a = analyze(candles)
        if not a:
            continue
        a["score"] *= mkt_mult
        st = state_of(a["score"], a["rsi"], btc_ok)
        rows.append((symbol, a, st))
        last = candles[-1]

        # ── مدیریت معامله باز ──
        pos = positions.get(symbol)
        if pos:
            hours = (time.time() - pos["time"]) / 3600
            reason = None
            if last["low"] <= pos["sl"]:
                reason = "🛑 حد ضرر خورد"
                exit_px = pos["sl"]
            elif last["high"] >= pos["tp2"]:
                reason = "🎯 هدف دوم — کامل فروخته شد"
                exit_px = pos["tp2"]
            elif a["rsi"] >= EXIT_RSI:
                reason = "🔥 اشباع خرید — سود بگیر"
                exit_px = a["price"]
            elif pos.get("tp1_hit") and a["price"] < a["ema20"]:
                reason = "📉 روند کوتاه‌مدت شکست"
                exit_px = a["price"]
            elif hours >= HOLD_HOURS:
                reason = "⌛ زمان نگهداری تمام شد"
                exit_px = a["price"]

            if reason:
                send(sell_message(symbol, pos, exit_px, reason, hours))
                positions.pop(symbol, None)
            else:
                if not pos.get("tp1_hit") and last["high"] >= pos["tp1"]:
                    pos["tp1_hit"] = True
                    send(f"🎯 <b>{symbol}</b> به هدف اول رسید "
                         f"(<code>{fmt(pos['tp1'])}</code>)\n"
                         f"نیمی از پوزیشن را بفروش، بقیه تا هدف دوم بماند.\n"
                         f"🛑 حد ضرر را به نقطه ورود منتقل کن: "
                         f"<code>{fmt(pos['entry'])}</code>\n{SIGN}")
                    pos["sl"] = max(pos["sl"], pos["entry"])
            continue

        # ── سیگنال خرید جدید ──
        if st == "🟢 بخر" and len(positions) < MAX_POSITIONS:
            send(buy_message(symbol, a, btc_txt))
            positions[symbol] = {
                "entry": a["price"], "tp1": a["tp1"], "tp2": a["tp2"],
                "sl": a["sl"], "time": time.time(), "tp1_hit": False,
                "score": round(a["score"]),
            }

    rows.sort(key=lambda r: r[1]["score"], reverse=True)
    state["scans"] = state.get("scans", 0) + 1
    if SUMMARY_EVERY > 0 and state["scans"] % SUMMARY_EVERY == 1:
        send(summary_message(rows, btc_txt, positions))
    save_state(state)
    return rows


def seconds_to_next_candle():
    step = TF_SECONDS.get(INTERVAL, 3600)
    now = time.time()
    return step - (now % step) + 20  # ۲۰ ثانیه بعد از بسته‌شدن کندل


def run():
    send(f"🤖 <b>ربات سیگنال اسپات روشن شد</b>\n"
         f"ارزها: {len(SYMBOLS)}  ·  تایم: {INTERVAL}  ·  حداقل امتیاز: {MIN_SCORE:.0f}\n"
         f"⌛ نگهداری تا {HOLD_HOURS:.0f} ساعت  ·  حداکثر {MAX_POSITIONS} معامله هم‌زمان\n"
         f"🕒 {now_str()}\n{SIGN}")
    state = load_state()
    while True:
        try:
            scan_once(state)
        except Exception as exc:  # noqa: BLE001
            print("❌ خطا در اسکن:", exc)
        wait = seconds_to_next_candle()
        print(f"⏳ اسکن بعدی تا {wait / 60:.1f} دقیقه دیگر...")
        time.sleep(wait)


# ═══════════════════════════ تست بدون اینترنت ═════════════════════════
def _fake_candles(trend=0.0015, noise=0.006, vol_boost=1.6, n=320, seed=7):
    random.seed(seed)
    price, out, t = 100.0, [], int(time.time()) - n * 3600
    for i in range(n):
        price *= 1 + trend + random.uniform(-noise, noise)
        hi = price * (1 + abs(random.gauss(0, 0.003)))
        lo = price * (1 - abs(random.gauss(0, 0.003)))
        vol = 1000 * random.uniform(0.8, 1.2) * (vol_boost if i > n - 12 else 1.0)
        out.append({"time": (t + i * 3600) * 1000, "open": price, "high": hi,
                    "low": lo, "close": price, "volume": vol})
    return out


def selftest():
    print("🧪 تست منطق با دیتای ساختگی (بدون اینترنت، بدون تلگرام)\n")
    cases = [
        ("روند صعودی سالم با حجم تازه", 0.0016, 0.006, 1.7),
        ("بازار خنثی و بی‌حجم", 0.0000, 0.004, 1.0),
        ("ریزش", -0.0020, 0.008, 0.8),
    ]
    ok = True
    for name, tr, ns, vb in cases:
        a = analyze(_fake_candles(tr, ns, vb))
        if not a:
            print(f"❌ {name}: تحلیل برنگشت")
            ok = False
            continue
        st = state_of(a["score"], a["rsi"], True)
        print(f"• {name}")
        print(f"   امتیاز {a['score']:.0f}  RSI {a['rsi']:.0f}  "
              f"حجم {a['vol_chg']:+.0f}%  نوسان {a['atr_pct']:.2f}%  → {st}")
        print(f"   ورود {fmt(a['price'])}  🎯 {fmt(a['tp1'])} / {fmt(a['tp2'])}  "
              f"🛑 {fmt(a['sl'])}\n")
        for key in ("score", "price", "tp1", "tp2", "sl", "rsi"):
            if a[key] is None or math.isnan(a[key]):
                ok = False
        if not (a["sl"] < a["price"] < a["tp1"] < a["tp2"]):
            print("❌ ترتیب حد ضرر/ورود/اهداف درست نیست")
            ok = False
    print("✅ همه تست‌ها سالم" if ok else "❌ تست شکست خورد")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    if "--once" in sys.argv:
        st = load_state()
        scan_once(st)
        sys.exit(0)
    run()
