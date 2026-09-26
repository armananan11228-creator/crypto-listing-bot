# crypto-listing-bot
Crypto Listing Scanner

## 📈 اندیکاتور تریدینگ‌ویو
اندیکاتور «AI Liquidity Scanner» (Pine Script v6) در پوشه [`tradingview/`](./tradingview) قرار دارد —
موتور امتیازدهی خودیادگیر + نقشه نقدینگی + داشبورد + هشدار. راهنما: [tradingview/README.md](./tradingview/README.md)

## 🔗 پل وبهوک تریدینگ‌ویو → تلگرام

فایل: `webhook_server.py`

سیگنال‌های اندیکاتورهای تریدینگ‌ویو را می‌گیرد و فرمت‌شده به تلگرام می‌فرستد.

```
TradingView (آلرت) ──POST──► webhook_server.py ──► ربات تلگرام ──► گوشی شما
```

### راه‌اندازی محلی
```bash
pip install -r requirements.txt
export BOT_TOKEN="توکن ربات از BotFather"
export CHAT_ID="آی‌دی عددی چت شما"
export WEBHOOK_SECRET="یک رمز دلخواه"
python3 webhook_server.py
```

### مسیرها
| مسیر | کار |
|---|---|
| `POST /tradingview/<secret>` | دریافت آلرت تریدینگ‌ویو (متن ساده یا JSON) |
| `POST /test` | ارسال یک پیام آزمایشی به تلگرام |
| `GET /health` | بررسی سلامت + آمار |
| `GET /` | صفحه وضعیت با تاریخچه ۳۰ آلرت آخر |

### امکانات
- تشخیص خودکار نوع سیگنال (خرید / فروش / اسکن / حجم) و تیتر مناسب
- پشتیبانی از متن ساده و JSON با `{{ticker}}`، `{{interval}}`، `{{close}}`
- حذف پیام‌های تکراری در بازه ۶۰ ثانیه
- تکه‌کردن خودکار پیام‌های بلندتر از محدودیت تلگرام
- محافظت با رمز (`WEBHOOK_SECRET`) و رد درخواست‌های ناشناس
- ساعت تهران روی هر پیام

### در آلرت تریدینگ‌ویو
- Webhook URL: `https://<دامنه شما>/tradingview/<WEBHOOK_SECRET>`
- Message: `{{strategy.order.alert_message}}` یا متن پیش‌فرض اندیکاتور

## 💎 ربات سیگنال خرید اسپات (نسخه پایتونی اندیکاتور)

فایل: `spot_bot.py`

همان منطق اندیکاتور **Spot Buy Scanner** بدون نیاز به هیچ پلن پولی تریدینگ‌ویو.
دیتا را از بایننس می‌گیرد، امتیاز می‌دهد و سیگنال را مستقیم به تلگرام می‌فرستد.

```bash
pip install -r requirements.txt
BOT_TOKEN=... CHAT_ID=... python3 spot_bot.py        # اجرای دائمی
python3 spot_bot.py --once                            # یک اسکن
python3 spot_bot.py --selftest                        # تست منطق بدون اینترنت
```

### امکانات
- امتیازدهی ۸ عاملی یکسان با اندیکاتور (EMA، MACD، RSI، ADX، ATR، حجم، ساختار، پولبک)
- فیلتر سلامت بازار با بیت‌کوین
- پیام خرید با ورود، دو هدف، حد ضرر و درصد هرکدام
- پیگیری معامله‌های باز در `state.json` و اعلام لحظه‌ی فروش با ذکر دلیل
- انتقال خودکار حد ضرر به نقطه ورود بعد از هدف اول
- خلاصه‌ی دوره‌ای وضعیت بازار

### تنظیمات (متغیر محیطی)
| متغیر | پیش‌فرض | کار |
|---|---|---|
| `SYMBOLS` | ۱۵ ارز | لیست ارزها با کاما |
| `INTERVAL` | `1h` | تایم‌فریم تحلیل |
| `MIN_SCORE` | `65` | حداقل امتیاز خرید |
| `HOLD_HOURS` | `12` | حداکثر ساعت نگهداری |
| `MAX_POSITIONS` | `5` | حداکثر معامله هم‌زمان |
| `NEED_BTC_OK` | `1` | خرید فقط وقتی بیت‌کوین سالم است |

### اجرای رایگان ۲۴ ساعته با GitHub Actions
فایل `.github/workflows/spot-bot.yml` هر ساعت ربات را اجرا می‌کند.
کافی است در `Settings → Secrets and variables → Actions` دو سکرت بسازی:
`BOT_TOKEN` و `CHAT_ID`.
