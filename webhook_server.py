# -*- coding: utf-8 -*-
"""
🔗 پل وبهوک تریدینگ‌ویو → تلگرام
✍️  طراحی و توسعه توسط آرمان ناصری

TradingView (آلرت)  ──POST──►  این سرور  ──►  ربات تلگرام  ──►  گوشی شما

اجرا:
    BOT_TOKEN=... CHAT_ID=... WEBHOOK_SECRET=... python3 webhook_server.py

آدرسی که در تریدینگ‌ویو وارد می‌کنی:
    https://<دامنه شما>/tradingview/<WEBHOOK_SECRET>
"""

import html
import json
import os
import time
from datetime import datetime, timedelta, timezone

import requests
from flask import Flask, jsonify, request

# ───────────────────────────── تنظیمات ─────────────────────────────
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
CHAT_ID = os.environ.get("CHAT_ID", "")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "arman")
PORT = int(os.environ.get("PORT", "8080"))
DEDUP_SECONDS = int(os.environ.get("DEDUP_SECONDS", "60"))
TEHRAN = timezone(timedelta(hours=3, minutes=30))

app = Flask(__name__)

# آخرین پیام‌ها برای جلوگیری از ارسال تکراری
_recent = {}
# تاریخچه برای نمایش در صفحه وضعیت
_history = []
_stats = {"received": 0, "sent": 0, "failed": 0, "duplicates": 0, "rejected": 0}


# ─────────────────────────── ابزار تلگرام ───────────────────────────
def send_telegram(message: str) -> bool:
    """ارسال پیام به تلگرام؛ پیام‌های بلند تکه‌تکه می‌شوند."""
    if not BOT_TOKEN or not CHAT_ID:
        app.logger.warning("BOT_TOKEN یا CHAT_ID تنظیم نشده — پیام ارسال نشد")
        return False

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    ok = True
    for chunk in _split(message, 3900):
        try:
            resp = requests.post(
                url,
                data={
                    "chat_id": CHAT_ID,
                    "text": chunk,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
                timeout=15,
            )
            if resp.status_code != 200:
                app.logger.error("خطای تلگرام %s: %s", resp.status_code, resp.text[:200])
                ok = False
        except Exception as exc:  # noqa: BLE001
            app.logger.error("ارسال تلگرام شکست خورد: %s", exc)
            ok = False
    return ok


def _split(text: str, size: int):
    """تکه‌کردن پیام بلند روی مرز خطوط (محدودیت ۴۰۹۶ کاراکتری تلگرام)."""
    if len(text) <= size:
        return [text]
    parts, current = [], ""
    for line in text.split("\n"):
        if len(current) + len(line) + 1 > size:
            parts.append(current)
            current = ""
        current += line + "\n"
    if current.strip():
        parts.append(current)
    return parts


# ─────────────────────────── قالب‌بندی پیام ──────────────────────────
def build_message(payload) -> str:
    """ساخت پیام زیبای تلگرام از متن یا JSON آلرت تریدینگ‌ویو."""
    now = datetime.now(TEHRAN).strftime("%Y/%m/%d  %H:%M")

    if isinstance(payload, dict):
        body = payload.get("message") or payload.get("text") or json.dumps(
            payload, ensure_ascii=False, indent=2
        )
        ticker = payload.get("ticker") or payload.get("symbol") or ""
        interval = payload.get("interval") or payload.get("tf") or ""
        price = payload.get("price") or payload.get("close") or ""
    else:
        body = str(payload)
        ticker = interval = price = ""

    body = body.strip()
    low = body.lower()

    if "💎" in body or "خرید" in body or "buy" in low:
        head = "💎 <b>سیگنال خرید اسپات</b>"
    elif "💰" in body or "فروش" in body or "sell" in low:
        head = "💰 <b>سیگنال فروش</b>"
    elif "🌱" in body:
        head = "🌱 <b>حجم تازه بیدار شد</b>"
    elif "🔎" in body:
        head = "🔎 <b>نتیجه اسکن بازار</b>"
    else:
        head = "🔔 <b>هشدار تریدینگ‌ویو</b>"

    lines = [head, "━━━━━━━━━━━━━━", f"<pre>{html.escape(body)}</pre>"]

    meta = []
    if ticker:
        meta.append(f"🪙 {html.escape(str(ticker))}")
    if interval:
        meta.append(f"⏱ {html.escape(str(interval))}")
    if price:
        meta.append(f"💵 {html.escape(str(price))}")
    if meta:
        lines.append("  ·  ".join(meta))

    lines.append(f"🕒 {now}  (تهران)")
    return "\n".join(lines)


def is_duplicate(text: str) -> bool:
    """جلوگیری از ارسال پیام یکسان در بازه کوتاه."""
    now = time.time()
    for key, stamp in list(_recent.items()):
        if now - stamp > DEDUP_SECONDS:
            _recent.pop(key, None)
    if text in _recent:
        return True
    _recent[text] = now
    return False


def remember(status: str, preview: str):
    _history.insert(
        0,
        {
            "time": datetime.now(TEHRAN).strftime("%H:%M:%S"),
            "status": status,
            "preview": preview[:160],
        },
    )
    del _history[30:]


# ───────────────────────────── مسیرها ──────────────────────────────
@app.post("/tradingview/<secret>")
@app.post("/tradingview")
def tradingview(secret: str = ""):
    raw = request.get_data(as_text=True) or ""
    payload = raw
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        pass

    given = secret
    if not given and isinstance(payload, dict):
        given = payload.get("secret", "")
    if not given:
        given = request.args.get("secret", "")

    if WEBHOOK_SECRET and given != WEBHOOK_SECRET:
        _stats["rejected"] += 1
        remember("🚫 رد شد (رمز اشتباه)", raw)
        return jsonify(ok=False, error="bad secret"), 403

    _stats["received"] += 1
    if not raw.strip():
        return jsonify(ok=False, error="empty body"), 400

    message = build_message(payload)

    if is_duplicate(message):
        _stats["duplicates"] += 1
        remember("♻️ تکراری", raw)
        return jsonify(ok=True, skipped="duplicate")

    if send_telegram(message):
        _stats["sent"] += 1
        remember("✅ ارسال شد", raw)
        return jsonify(ok=True)

    _stats["failed"] += 1
    remember("❌ خطای ارسال", raw)
    return jsonify(ok=False, error="telegram failed"), 502


@app.post("/test")
def test():
    msg = build_message(
        "💎 خرید اسپات: SUIUSDT\nامتیاز: 78/100  |  بازار: 🟢 سالم\n"
        "ورود: 3.4120\n🎯 هدف ۱: 3.5280\n🎯 هدف ۲: 3.7010\n🛑 حد ضرر: 3.2880\n"
        "⌛ حداکثر نگهداری: 12 ساعت\n— پیام آزمایشی"
    )
    ok = send_telegram(msg)
    return jsonify(ok=ok, configured=bool(BOT_TOKEN and CHAT_ID))


@app.get("/health")
def health():
    return jsonify(ok=True, configured=bool(BOT_TOKEN and CHAT_ID), stats=_stats)


@app.get("/")
def home():
    rows = "".join(
        f"<tr><td>{h['time']}</td><td>{h['status']}</td>"
        f"<td class='p'>{html.escape(h['preview'])}</td></tr>"
        for h in _history
    ) or "<tr><td colspan='3' class='muted'>هنوز آلرتی نرسیده است</td></tr>"

    configured = "✅ متصل" if BOT_TOKEN and CHAT_ID else "⚠️ BOT_TOKEN / CHAT_ID تنظیم نشده"
    return f"""<!doctype html><html lang="fa" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>پل وبهوک تریدینگ‌ویو → تلگرام</title>
<style>
 body{{font-family:system-ui,'Segoe UI',Tahoma,sans-serif;background:#0e1117;color:#e6edf3;
      margin:0;padding:24px;line-height:1.9}}
 .card{{background:#131722;border:1px solid #2a2f3a;border-radius:14px;padding:18px;
        max-width:820px;margin:0 auto 16px}}
 h1{{font-size:20px;margin:0 0 6px}} h2{{font-size:16px;margin:0 0 10px;color:#9db2d3}}
 code{{background:#1e2430;padding:3px 8px;border-radius:6px;color:#7ee2c4;direction:ltr;
       display:inline-block;font-size:13px}}
 table{{width:100%;border-collapse:collapse;font-size:13px}}
 td,th{{padding:7px 8px;border-bottom:1px solid #222836;text-align:right}}
 .p{{color:#9db2d3;font-size:12px}} .muted{{color:#6b7684;text-align:center}}
 .pill{{display:inline-block;background:#1b2a3f;color:#63b3ff;border-radius:99px;
        padding:3px 12px;font-size:12px}}
 .k{{color:#7ee2c4}}
</style></head><body>
<div class="card">
  <h1>🔗 پل وبهوک تریدینگ‌ویو → تلگرام</h1>
  <span class="pill">{configured}</span>
  <p>آدرس وبهوک را در پنجره آلرت تریدینگ‌ویو وارد کن:</p>
  <p><code>{request.url_root.rstrip('/')}/tradingview/{WEBHOOK_SECRET}</code></p>
</div>
<div class="card">
  <h2>📊 آمار</h2>
  دریافت‌شده <span class="k">{_stats['received']}</span> ·
  ارسال‌شده <span class="k">{_stats['sent']}</span> ·
  تکراری <span class="k">{_stats['duplicates']}</span> ·
  ناموفق <span class="k">{_stats['failed']}</span> ·
  رد‌شده <span class="k">{_stats['rejected']}</span>
</div>
<div class="card">
  <h2>🕒 آخرین آلرت‌ها</h2>
  <table><tr><th>ساعت</th><th>وضعیت</th><th>متن</th></tr>{rows}</table>
</div>
<div class="card muted">✍️ طراحی و توسعه توسط آرمان ناصری</div>
</body></html>"""


if __name__ == "__main__":
    print("🔗 پل وبهوک روی پورت", PORT)
    print("   آدرس وبهوک: /tradingview/" + WEBHOOK_SECRET)
    if not (BOT_TOKEN and CHAT_ID):
        print("   ⚠️ BOT_TOKEN و CHAT_ID را تنظیم کن وگرنه پیامی ارسال نمی‌شود")
    app.run(host="0.0.0.0", port=PORT)
