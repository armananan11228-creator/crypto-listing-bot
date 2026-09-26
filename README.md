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
