/* ═══════════════════════════════════════════════════════════════════
   🔎 شکارچی سیگنال خرید Multi Kernel Regression — تایم ۱ ساعته
   ✍️ طراحی و توسعه توسط آرمان ناصری
   ═══════════════════════════════════════════════════════════════════ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* چند میزبان جایگزین — اگر یکی بسته بود، بعدی امتحان می‌شود */
const HOSTS = [
  'https://api.binance.com', 'https://data-api.binance.vision',
  'https://api-gcp.binance.com', 'https://api1.binance.com',
  'https://api2.binance.com', 'https://api3.binance.com',
];
let HOST = null;

const CFG = { h: 14, dev: 1.5, fresh: 2, top: 100, minVol: 2e7 };
let results = [], lastRun = 0;

const fa = n => (n || 0).toLocaleString('fa-IR');
const fmt = p => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 1 })
  : p >= 1 ? p.toFixed(4) : p.toFixed(6);
const pc = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '٪';

async function api(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const hosts = HOST ? [HOST, ...HOSTS.filter(h => h !== HOST)] : HOSTS;
  let err;
  for (const b of hosts) {
    try {
      const r = await fetch(`${b}${path}?${qs}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      HOST = b;
      return await r.json();
    } catch (e) { err = e; }
  }
  throw new Error('دسترسی به بایننس ممکن نشد — احتمالاً نیاز به تغییر IP داری. (' + (err && err.message) + ')');
}

async function klines1h(symbol, limit = 300) {
  const raw = await api('/api/v3/klines', { symbol, interval: '1h', limit });
  return raw.slice(0, -1).map(k => ({      // کندل ناقص جاری حذف می‌شود
    time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

async function topSymbols(n) {
  const all = await api('/api/v3/ticker/24hr');
  return all
    .filter(t => t.symbol.endsWith('USDT') && !/UP|DOWN|BULL|BEAR/.test(t.symbol))
    .filter(t => !/^(USDC|FDUSD|TUSD|BUSD|DAI|EURI?|XUSD)USDT$/.test(t.symbol))
    .filter(t => +t.quoteVolume >= CFG.minVol)
    .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
    .slice(0, n)
    .map(t => ({ symbol: t.symbol, chg24: +t.priceChangePercent, qv: +t.quoteVolume }));
}

async function pool(items, fn, size, onTick) {
  const out = []; let i = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { const v = await fn(items[idx]); if (v) out.push(v); } catch (e) { /* رد شو */ }
      onTick && onTick(++done, items.length);
    }
  }));
  return out;
}

const KIND = {
  pullback: { i: '🎯', t: 'پولبک تمام شد', c: 'k-pb',
    d: 'قیمت زیر باند پایین رفت و دوباره بالای آن بسته شد — ورود ارزان در دل روند صعودی. بهترین نوع سیگنال.' },
  cross: { i: '↗️', t: 'عبور از خط کرنل', c: 'k-cr',
    d: 'قیمت از زیر خط رگرسیون به بالای آن عبور کرد، در حالی که روند صعودی تأیید شده بود.' },
  trend: { i: '🟢', t: 'روند تازه تأیید شد', c: 'k-tr',
    d: 'شیب خط و اجماع هسته‌ها تازه صعودی شده‌اند و قیمت بالای خط رگرسیون است.' },
};

function setBar(d, n, txt) {
  $('#bar').style.width = (n ? d / n * 100 : 0) + '%';
  $('#ptxt').textContent = txt;
}

async function hunt() {
  const btn = $('#go');
  btn.disabled = true;
  $('#prog').hidden = false;
  $('#err').hidden = true;
  setBar(0, 1, 'گرفتن لیست ارزهای پرحجم…');

  try {
    const list = await topSymbols(CFG.top);
    if (!list.length) throw new Error('لیستی برنگشت');
    setBar(0, list.length, `تحلیل ۰ از ${list.length} ارز…`);

    const opt = { h: CFG.h, dev: CFG.dev, types: ['gaussian', 'epanechnikov', 'wave'] };
    const rows = await pool(list, async t => {
      const k = await klines1h(t.symbol);
      if (k.length < 120) return null;
      const closes = k.map(x => x.close);
      const sig = TA.kernelSignals(closes, opt, 12);
      const mk = TA.multiKernel(closes, opt);
      if (!mk) return null;
      const highs = k.map(x => x.high), lows = k.map(x => x.low);
      const atrV = TA.atr(highs, lows, closes, 14) || 0;
      const price = closes[closes.length - 1];
      /* حد ضرر ساختاری = باند پایین، ولی هیچ‌وقت نزدیک‌تر از ۱ ATR
         (در نوسان کم، باند می‌چسبد به قیمت و حد ضرر بی‌معنا می‌شود) */
      const sl = Math.min(mk.lower, price - atrV);
      const riskPct = price ? (1 - sl / price) * 100 : 0;
      return {
        ...t, sig, mk, price, sl, riskPct,
        rsi: TA.rsi(closes, 14) || 50,
        atrPct: price ? atrV / price * 100 : 0,
        state: TA.kernelState(mk),
        ok: riskPct >= 0.3 && riskPct <= 6,            // ریسک منطقی برای نگهداری چندساعته
      };
    }, 6, (d, n) => setBar(d, n, `تحلیل ${d} از ${n} ارز…`));

    results = rows;
    lastRun = Date.now();
    render();
  } catch (e) {
    $('#err').hidden = false;
    $('#err').textContent = '❌ ' + e.message;
  } finally {
    btn.disabled = false;
    $('#prog').hidden = true;
  }
}

function card(r) {
  const g = r.sig, K = KIND[g.kind] || KIND.trend;
  const age = g.age === 0 ? 'همین کندل بسته‌شده' : `${fa(g.age)} کندل پیش`;
  const hot = g.age <= CFG.fresh;
  const slPct = -r.riskPct;
  const tp1 = r.price + (r.price - r.sl) * 1.5, tp2 = r.price + (r.price - r.sl) * 3;
  const late = g.chgSince > 1.5;
  const hiRsi = r.rsi > 72;
  return `<article class="card ${hot ? 'hot' : ''}">
    <div class="top">
      <div><b class="sym">${r.symbol.replace('USDT', '')}</b><span class="pair">/USDT · ۱ ساعته</span></div>
      <div class="kind ${K.c}">${K.i} ${K.t}</div>
    </div>
    <div class="agebar"><span class="${hot ? 'hot' : ''}">⏱ ${age}</span>
      <span>اجماع ${fa(g.agree)}/${fa(g.total)} هسته</span>
      <span class="${g.chgSince >= 0 ? 'up' : 'dn'}">از سیگنال ${pc(g.chgSince)}</span></div>
    ${late ? `<div class="warn">⚠️ از لحظه‌ی سیگنال ${pc(g.chgSince)} بالا رفته — احتمالاً جا مانده‌ای. منتظر پولبک بمان.</div>` : ''}
    ${hiRsi ? `<div class="warn">🎚 RSI ${r.rsi.toFixed(0)} — اشباع خرید؛ ریسک اصلاح کوتاه‌مدت بالاست.</div>` : ''}
    ${!r.ok ? `<div class="warn">📐 فاصله‌ی حد ضرر ${r.riskPct.toFixed(2)}٪ است — ${r.riskPct < 0.3 ? 'بیش از حد نزدیک (نوسان خیلی کم)' : 'بیش از حد دور (نوسان خیلی زیاد)'}؛ نسبت ریسک به بازده مطمئن نیست.</div>` : ''}
    <div class="kv"><span>قیمت فعلی</span><b>${fmt(r.price)}</b></div>
    <div class="kv"><span>قیمت لحظه‌ی سیگنال</span><b>${fmt(g.atPrice)}</b></div>
    <div class="kv"><span>خط رگرسیون</span><b>${fmt(g.center)}</b></div>
    <div class="kv"><span>باند پایین (حد ضرر)</span><b class="dn">${fmt(r.sl)} · ${pc(slPct)}</b></div>
    <div class="kv"><span>🎯 هدف ۱.۵R / ۳R</span><b class="up">${fmt(tp1)} / ${fmt(tp2)}</b></div>
    <div class="kv"><span>📐 ریسک تا حد ضرر</span><b class="${r.ok ? '' : 'dn'}">${r.riskPct.toFixed(2)}٪</b></div>
    <div class="kv"><span>RSI · نوسان · z</span><b>${r.rsi.toFixed(0)} · ${r.atrPct.toFixed(1)}٪ · ${g.z.toFixed(1)}</b></div>
    <div class="kv"><span>۲۴ ساعت · حجم</span><b class="${r.chg24 >= 0 ? 'up' : 'dn'}">${pc(r.chg24)} · $${fa(Math.round(r.qv / 1e6))}M</b></div>
    <p class="why">${K.d}</p>
  </article>`;
}

function render() {
  const onlyFresh = $('#onlyFresh').checked;
  const withSig = results.filter(r => r.sig);
  const rows = (onlyFresh ? withSig.filter(r => r.sig.age <= CFG.fresh) : withSig)
    .sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0) ||
      a.sig.age - b.sig.age ||
      b.sig.agree - a.sig.agree ||
      (a.sig.kind === 'pullback' ? -1 : 0) - (b.sig.kind === 'pullback' ? -1 : 0));

  $('#sum').innerHTML = results.length
    ? `<b>${fa(results.length)}</b> ارز بررسی شد · <b class="up">${fa(withSig.filter(r => r.sig.age <= CFG.fresh).length)}</b> سیگنال تازه
       · ${fa(withSig.length)} سیگنال در ۱۲ کندل اخیر
       · ${new Date(lastRun).toLocaleTimeString('fa-IR')}`
    : '';

  $('#out').innerHTML = rows.length
    ? rows.map(card).join('')
    : results.length
      ? `<div class="empty">هیچ ارزی ${onlyFresh ? `در ${fa(CFG.fresh + 1)} کندل اخیر` : 'در ۱۲ کندل اخیر'} سیگنال خرید کرنل نگرفته.<br>
         <small>این خودش یک پیام است: بازار الان نقطه‌ی ورود تازه نساخته. صبر هم یک معامله است ☕</small></div>`
      : '';
  $('#copy').hidden = !rows.length;
}

function copySummary() {
  const onlyFresh = $('#onlyFresh').checked;
  const rows = results.filter(r => r.sig && (!onlyFresh || r.sig.age <= CFG.fresh))
    .sort((a, b) => a.sig.age - b.sig.age);
  const txt = ['نتیجه‌ی شکار سیگنال MKR — تایم ۱ ساعته',
    `زمان: ${new Date(lastRun).toLocaleString('fa-IR')} · ${results.length} ارز بررسی شد`, '']
    .concat(rows.map(r => {
      const g = r.sig;
      return `${r.symbol} | ${(KIND[g.kind] || KIND.trend).t} | ${g.age} کندل پیش | اجماع ${g.agree}/${g.total} | قیمت ${fmt(r.price)} | از سیگنال ${pc(g.chgSince)} | RSI ${r.rsi.toFixed(0)} | z ${g.z.toFixed(1)} | ریسک ${r.riskPct.toFixed(2)}٪${r.ok ? '' : ' (مشکوک)'}`;
    })).join('\n');
  navigator.clipboard.writeText(txt).then(() => {
    const b = $('#copy'); const o = b.textContent;
    b.textContent = '✅ کپی شد — برای دستیار بفرست';
    setTimeout(() => b.textContent = o, 2200);
  });
}

function init() {
  $('#go').onclick = hunt;
  $('#copy').onclick = copySummary;
  $('#onlyFresh').onchange = render;
  ['h', 'dev', 'fresh', 'top'].forEach(k => {
    const el = $('#c_' + k);
    el.value = CFG[k];
    el.onchange = () => { CFG[k] = +el.value || CFG[k]; if (results.length) render(); };
  });
}
document.addEventListener('DOMContentLoaded', init);
