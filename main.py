import requests
import time
from datetime import datetime
import os

BOT_TOKEN = os.environ.get('BOT_TOKEN')
CHAT_ID = os.environ.get('CHAT_ID')

def send_telegram(message):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    data = {
        "chat_id": CHAT_ID,
        "text": message,
        "parse_mode": "HTML"
    }
    try:
        requests.post(url, data=data)
    except:
        pass

def get_all_symbols():
    url = "https://api.binance.com/api/v3/exchangeInfo"
    response = requests.get(url)
    data = response.json()
    symbols = [x['symbol'] for x in data['symbols'] if x['status'] == 'TRADING']
    return set(symbols)

def scan_new_listings():
    print("🤖 ربات شروع به کار کرد!")
    send_telegram("🤖 ربات اسکنر ارزهای جدید شروع به کار کرد!")
    
    old_symbols = get_all_symbols()
    print(f"✅ {len(old_symbols)} ارز در لیست بایننس")
    send_telegram(f"✅ {len(old_symbols)} ارز در لیست بایننس")
    
    while True:
        try:
            time.sleep(30)
            new_symbols = get_all_symbols()
            new_listings = new_symbols - old_symbols
            
            if new_listings:
                for symbol in new_listings:
                    try:
                        price_url = f"https://api.binance.com/api/v3/ticker/price?symbol={symbol}"
                        price_response = requests.get(price_url)
                        price_data = price_response.json()
                        price = price_data['price']
                        
                        message = f"""
🚨 ارز جدید لیست شد!
🪙 ارز: {symbol}
💰 قیمت: {price}
⏰ زمان: {datetime.now().strftime('%H:%M:%S')}
"""
                        print(message)
                        send_telegram(message)
                    except:
                        message = f"""
🚨 ارز جدید لیست شد!
🪙 ارز: {symbol}
⏰ زمان: {datetime.now().strftime('%H:%M:%S')}
"""
                        print(message)
                        send_telegram(message)
                
                old_symbols = new_symbols
            else:
                print(f"⏳ {datetime.now().strftime('%H:%M:%S')} - ارز جدیدی نیست...")
                old_symbols = new_symbols
                
        except Exception as e:
            print(f"❌ خطا: {e}")
            time.sleep(10)
            continue

if __name__ == "__main__":
    scan_new_listings()
