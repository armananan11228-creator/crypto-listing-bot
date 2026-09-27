/* ═══════════════════════════════════════════════════════════════════
   دستیار ترید — اسکن ۱۰۰ ارز برتر، ثبت خرید، همراهی تا لحظه فروش
   ✍️ طراحی و توسعه توسط آرمان ناصری
   ═══════════════════════════════════════════════════════════════════ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const BASES = [
  'https://api.binance.com', 'https://api-gcp.binance.com',
  'https://api1.binance.com', 'https://data-api.binance.vision',
];
const STABLES = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'EUR', 'TRY', 'BRL', 'AEUR'];

/* ─────────── وضعیت برنامه ─────────── */
const DEFAULTS = {
  tp1: 1.2, tp2: 2.4, sl: 1.6, hold: 12, maxRsi: 68,
  top: 100, amount: 10, minScore: 65, tf: '1h',
  poll: 20, auto: 15, sound: true,
};
let CFG = { ...DEFAULTS, ...load('cfg', {}) };
let positions = load('positions', []);
let history = load('history', []);
let scanRows = [];
let signals = load('signals', {});
let signalLog = load('signalLog', []);
let market = { ok: true, txt: '—', mult: 1, price: 0 };
let demo = false;
let filter = 'buy';
let scanning = false;
let lastScan = 0;
let drawerSym = null, chartTf = load('chartTf', '1h');
const chartCache = {};

function load(k, d) { try { return JSON.parse(localStorage.getItem('at_' + k)) ?? d; } catch { return d; } }
function save(k, v) { localStorage.setItem('at_' + k, JSON.stringify(v)); }

/* ─────────── ابزار ─────────── */
const fmt = p => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 1 })
  : p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(6);
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const money = x => (x >= 0 ? '+' : '−') + '$' + Math.abs(x).toFixed(2);
const clock = t => new Date(t).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
const hoursSince = t => (Date.now() - t) / 36e5;

async function api(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  let err;
  for (const b of BASES) {
    try {
      const r = await fetch(`${b}${path}?${qs}`, { cache: 'no-store' });
      if (r.ok) return await r.json();
      err = r.status;
    } catch (e) { err = e.message; }
  }
  throw new Error('اتصال به بایننس برقرار نشد: ' + err);
}

async function pool(items, worker, size, onStep) {
  const out = [];
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { const r = await worker(items[idx]); if (r) out.push(r); } catch { }
      onStep && onStep(++done, items.length);
    }
  }));
  return out;
}

/* ─────────── اسکن بازار ─────────── */
async function topSymbols(n) {
  const all = await api('/api/v3/ticker/24hr');
  return all
    .filter(t => t.symbol.endsWith('USDT'))
    .filter(t => !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol))
    .filter(t => !STABLES.some(s => t.symbol === s + 'USDT'))
    .filter(t => +t.quoteVolume > 3e6)
    .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
    .slice(0, n)
    .map(t => ({ symbol: t.symbol, chg24: +t.priceChangePercent, qv: +t.quoteVolume }));
}

async function klines(symbol, tf, limit = 260) {
  const raw = await api('/api/v3/klines', { symbol, interval: tf, limit });
  return raw.slice(0, -1).map(k => ({
    time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

async function scan() {
  if (scanning) return;
  scanning = true;
  $('#scanBtn').disabled = true;
  $('#progress').hidden = false;
  setProgress(0, 1, 'در حال گرفتن لیست ۱۰۰ ارز برتر…');

  try {
    let list;
    try {
      list = await topSymbols(CFG.top);
      const btc = await klines('BTCUSDT', CFG.tf);
      const h = TA.btcHealth(btc);
      market.price = btc[btc.length - 1].close;
      market.ok = h == null || h >= 40;
      market.txt = h == null ? 'نامشخص' : h >= 70 ? '🟢 سالم' : h >= 40 ? '🟡 خنثی' : '🔴 ضعیف';
      market.mult = market.ok ? 1 : 0.75;
      demo = false;
    } catch (e) {
      demo = true;
      list = demoList(CFG.top);
      market = { ok: true, txt: '🟢 سالم (نمایشی)', mult: 1, price: 64000 };
    }
    $('#demoBanner').hidden = !demo;

    const rows = await pool(list, async t => {
      const k = demo ? TA.demoKlines(hash(t.symbol)) : await klines(t.symbol, CFG.tf);
      const a = TA.analyze(k, CFG);
      if (!a) return null;
      a.score *= market.mult;
      const ob = CFG.tf === '1h' ? TA.orderBlocks(k) : null;
      return { ...t, ...a, ob, state: TA.stateOf(a.score, a.rsi, market.ok, CFG) };
    }, 8, (d, n) => setProgress(d, n, `تحلیل ${d} از ${n} ارز…`));

    rows.sort((a, b) => b.score - a.score);
    scanRows = rows;
    lastScan = Date.now();
    updateSignals(rows);
    renderScan();
    renderHeader();
    evaluatePositions();
  } catch (e) {
    $('#empty').textContent = '❌ ' + e.message;
  } finally {
    scanning = false;
    $('#scanBtn').disabled = false;
    $('#progress').hidden = true;
  }
}

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 9973; return h + 1; }
function demoList(n) {
  const names = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TON', 'TRX',
    'DOT', 'NEAR', 'SUI', 'LTC', 'APT', 'ARB', 'OP', 'INJ', 'SEI', 'RNDR', 'FET', 'TIA', 'PEPE',
    'WIF', 'JUP', 'FIL', 'ATOM', 'ICP', 'IMX'];
  return names.slice(0, Math.min(n, names.length)).map((x, i) => ({
    symbol: x + 'USDT', chg24: (hash(x) % 1600) / 100 - 8, qv: 5e8 - i * 1e7,
  }));
}

function setProgress(d, n, txt) {
  $('#progressBar').style.width = (d / n * 100) + '%';
  $('#progressTxt').textContent = txt;
}

/* ─────────── اردربلاک ۱ ساعته (بارگذاری تنبل) ─────────── */
async function ensureOB() {
  const need = scanRows.filter(r => !r.ob).slice(0, 80);
  if (!need.length) return;
  $('#progress').hidden = false;
  setProgress(0, 1, 'بررسی اردربلاک‌های ۱ ساعته…');
  await pool(need, async r => {
    const key = r.symbol + '_1h';
    let k = chartCache[key];
    if (!k) {
      k = demo ? TA.demoKlines(hash(key)) : await klines(r.symbol, '1h', 260);
      chartCache[key] = k;
    }
    r.ob = TA.orderBlocks(k);
    return true;
  }, 8, (d, n) => setProgress(d, n, `بررسی اردربلاک ${d} از ${n}…`));
  $('#progress').hidden = true;
}

const OBST = {
  inside:   { i: '🧱', t: 'روی اردربلاک',    c: 'in'   },
  near:     { i: '🎯', t: 'چسبیده به اردربلاک', c: 'near' },
  approach: { i: '↘️', t: 'در حال نزدیک‌شدن', c: 'appr' },
};
const OBRANK = { inside: 0, near: 1, approach: 2 };

function obBadge(ob) {
  if (!ob || !ob.at) return '';
  const z = ob.zone, st = OBST[ob.at];
  const d = ob.distPct;
  const dTxt = ob.at === 'inside' ? 'داخل ناحیه' : `${Math.abs(d).toFixed(1)}٪ ${d > 0 ? 'بالاتر' : 'پایین‌تر'}`;
  return `<div class="oblock ${st.c}">
    <div>${st.i} ${st.t} <em>${z.grade}</em> · ${dTxt}</div>
    <span>ناحیه ${fmt(z.bottom)} – ${fmt(z.top)} · ${z.age} کندل پیش · ۱ ساعته</span></div>`;
}

/* ═══════ حافظه‌ی سیگنال — اسکنر پای حرفش می‌ماند ═══════
   وقتی ارزی سیگنال خرید گرفت، تا وقتی یکی از این اتفاق‌ها نیفتد معتبر می‌ماند:
   🎯 هدف دوم بخورد · 🛑 حد ضرر بخورد · ⌛ زمان اعتبار تمام شود ·
   ⚠️ امتیاز دو اسکن پشت‌سرهم خیلی افت کند                                 */
function updateSignals(rows) {
  const now = Date.now();
  const byS = Object.fromEntries(rows.map(r => [r.symbol, r]));

  for (const r of rows) {
    const sg = signals[r.symbol];
    if (!sg) {
      if (r.state.t === '🟢 بخر') {
        signals[r.symbol] = {
          symbol: r.symbol, at: now, entry: r.price, tp1: r.tp1, tp2: r.tp2,
          sl: r.sl, score0: r.score, score: r.score, now: r.price,
          weak: 0, tp1Hit: false, tf: CFG.tf,
        };
      }
      continue;
    }
    sg.now = r.price; sg.score = r.score;
    if (r.price >= sg.tp1) sg.tp1Hit = true;

    let end = null;
    if (r.price <= sg.sl) end = '🛑 حد ضرر خورد';
    else if (r.price >= sg.tp2) end = '🎯 هدف دوم زده شد';
    else if ((now - sg.at) / 36e5 >= CFG.hold) end = '⌛ زمان اعتبار تمام شد';
    else {
      sg.weak = r.score < CFG.minScore - 15 ? sg.weak + 1 : 0;
      if (sg.weak >= 2) end = '⚠️ شرایط ضعیف شد';
    }
    if (end) closeSignal(r.symbol, end);
  }

  // ارزهایی که از لیست ۱۰۰تای برتر بیرون رفته‌اند
  for (const sym of Object.keys(signals))
    if (!byS[sym] && (now - signals[sym].at) / 36e5 >= CFG.hold)
      closeSignal(sym, '⌛ زمان اعتبار تمام شد');

  save('signals', signals);
}

function closeSignal(sym, reason) {
  const sg = signals[sym];
  if (!sg) return;
  const res = (sg.now / sg.entry - 1) * 100;
  signalLog.unshift({ ...sg, closedAt: Date.now(), reason, result: res });
  signalLog = signalLog.slice(0, 60);
  delete signals[sym];
  save('signals', signals); save('signalLog', signalLog);
  if (/هدف/.test(reason)) alarm('🎯 سیگنال به هدف رسید', `${sym.replace('USDT','')} · ${pct(res)}`);
}

function signalCard(sg) {
  const chg = (sg.now / sg.entry - 1) * 100;
  const age = hoursSince(sg.at);
  const left = Math.max(0, CFG.hold - age);
  const prog = TA.clamp((sg.now - sg.sl) / (sg.tp2 - sg.sl) * 100, 0, 100);
  return `<article class="card coin sigcard" data-sym="${sg.symbol}">
    <div class="ribbon">📌 سیگنال فعال</div>
    <div class="top">
      <div><div class="sym">${sg.symbol.replace('USDT','')}</div>
        <div class="pair">${age < 1 ? Math.round(age*60)+' دقیقه' : age.toFixed(1)+' ساعت'} پیش · ${sg.tf}</div></div>
      <div class="score ${chg >= 0 ? 's-hi' : 's-lo'}">${pct(chg)}</div>
    </div>
    <div class="track"><i style="width:${prog}%"></i></div>
    <div class="ticks"><span>🛑 ${fmt(sg.sl)}</span><span>${fmt(sg.now)}</span><span>🎯 ${fmt(sg.tp2)}</span></div>
    <div class="kv"><span>قیمت سیگنال</span><b>${fmt(sg.entry)}</b></div>
    <div class="kv"><span>هدف ۱ ${sg.tp1Hit ? '✅ خورد' : ''}</span><b class="up">${fmt(sg.tp1)}</b></div>
    <div class="kv"><span>امتیاز الان</span><b>${sg.score.toFixed(0)} (شروع ${sg.score0.toFixed(0)})</b></div>
    <div class="kv"><span>اعتبار باقی‌مانده</span><b>${left.toFixed(1)} ساعت</b></div>
  </article>`;
}

/* ═══════ توضیح: چرا این ارز؟ ═══════ */
function reasons(r) {
  const d = r.det, pros = [], cons = [];

  if (d.aboveE50 && d.e50Above200)
    pros.push(['📈', 'روند صعودی کامل', 'قیمت بالای EMA50 است و EMA50 بالای EMA200 — هر سه ساختار روند هم‌جهت‌اند.']);
  else if (d.aboveE50)
    pros.push(['📈', 'روند کوتاه‌مدت مثبت', 'قیمت بالای EMA50 است، ولی روند بلندمدت هنوز کامل تأیید نشده.']);
  else
    cons.push(['📉', 'زیر میانگین‌ها', 'قیمت زیر EMA50 است؛ خرید در روند نزولی ریسک بالایی دارد.']);

  if (d.macdPos && d.macdRising)
    pros.push(['⚡', 'مومنتوم در حال تقویت', 'هیستوگرام MACD مثبت است و دارد بزرگ‌تر می‌شود — قدرت خریدار زیاد می‌شود.']);
  else if (d.macdRising)
    pros.push(['⚡', 'مومنتوم در حال برگشت', 'MACD هنوز منفی است ولی دارد بهبود می‌یابد.']);
  else
    cons.push(['⚡', 'مومنتوم ضعیف', 'MACD در حال تضعیف است؛ فشار خرید کم شده.']);

  if (r.volChg >= 10 && r.volChg <= 110)
    pros.push(['🔊', `حجم ${r.volChg.toFixed(0)}٪ بیشتر شده`, 'پول تازه وارد شده ولی هنوز منفجر نشده — یعنی ابتدای حرکت هستیم.']);
  else if (r.volChg > 110)
    cons.push(['🔊', `حجم ${r.volChg.toFixed(0)}٪ ترکیده`, 'احتمالاً موج اصلی شروع شده و دیر رسیده‌ایم.']);
  else
    cons.push(['🔊', 'حجم رشد نکرده', 'بدون حجم، حرکت قیمت دوام نمی‌آورد.']);

  if (r.rsi >= 45 && r.rsi <= 63)
    pros.push(['🎚', `RSI ${r.rsi.toFixed(0)} — ناحیه سالم`, 'نه اشباع خرید است نه مرده؛ جا برای رشد دارد.']);
  else if (r.rsi > 70)
    cons.push(['🎚', `RSI ${r.rsi.toFixed(0)} — اشباع خرید`, 'احتمال اصلاح کوتاه‌مدت بالاست.']);
  else if (r.rsi < 38)
    cons.push(['🎚', `RSI ${r.rsi.toFixed(0)} — خیلی ضعیف`, 'هنوز نشانه‌ای از برگشت خریدار نیست.']);

  if (r.pos >= 30 && r.pos <= 72)
    pros.push(['🎯', 'در ناحیه ارزش', `قیمت در ${r.pos.toFixed(0)}٪ محدوده ۲۰ کندل اخیر است — نه روی سقف خریدی، نه در حال سقوط.`]);
  else if (r.pos > 88)
    cons.push(['🎯', 'چسبیده به سقف', 'ورود در سقف یعنی حد ضرر دور و ریسک زیاد.']);

  if (r.adx >= 22)
    pros.push(['💪', `قدرت روند ${r.adx.toFixed(0)}`, 'روند جان دارد و احتمال ادامه‌اش بیشتر است.']);
  else
    cons.push(['💪', `قدرت روند فقط ${r.adx.toFixed(0)}`, 'بازار بی‌رمق است؛ حرکت ممکن است کش‌دار شود.']);

  if (r.ob && r.ob.at === 'inside')
    pros.push(['🧱', `روی اردربلاک ${r.ob.zone.grade} (۱ ساعته)`,
      `قیمت داخل ناحیه ${fmt(r.ob.zone.bottom)} تا ${fmt(r.ob.zone.top)} است — جایی که ${r.ob.zone.age} کندل پیش خریدار با حجم بالا وارد شد و قیمت را ${r.ob.zone.strength.toFixed(1)} برابر ATR بالا برد. کم‌ریسک‌ترین نقطه‌ی ورود، با حد ضرر درست زیر همین ناحیه.`]);
  else if (r.ob && r.ob.at === 'near')
    pros.push(['🎯', 'چسبیده به اردربلاک ۱ ساعته',
      `فقط ${Math.abs(r.ob.distPct).toFixed(1)}٪ با ناحیه ${fmt(r.ob.zone.bottom)}–${fmt(r.ob.zone.top)} فاصله دارد؛ یک پولبک کوچک، ورود عالی می‌دهد.`]);
  else if (r.ob && r.ob.at === 'approach')
    cons.push(['↘️', `${Math.abs(r.ob.distPct).toFixed(1)}٪ بالاتر از اردربلاک`,
      `ناحیه‌ی حمایتی ${fmt(r.ob.zone.bottom)}–${fmt(r.ob.zone.top)} پایین‌تر است. اگر عجله نداری، منتظر برگشت قیمت به آن ناحیه بمان تا حد ضررت کوتاه‌تر شود.`]);

  if (d.breakout) pros.push(['🚀', 'شکست سقف ۱۰ کندل', 'قیمت از آخرین مقاومت کوتاه‌مدت رد شده.']);
  if (d.higherLow) pros.push(['🪜', 'کف‌های بالاتر', 'خریداران در هر اصلاح زودتر وارد می‌شوند.']);

  if (r.atrPct > 5) cons.push(['🌪', `نوسان ${r.atrPct.toFixed(1)}٪`, 'خیلی پرنوسان است؛ حجم معامله را کم کن.']);
  else if (r.atrPct < 0.4) cons.push(['😴', 'نوسان خیلی کم', 'ممکن است حرکت معناداری نکند.']);

  if (!market.ok) cons.push(['🌍', 'بازار کلی ضعیف', 'بیت‌کوین شرایط خوبی ندارد و آلت‌ها معمولاً دنبالش می‌روند.']);

  let verdict;
  if (r.state.t === '🟢 بخر')
    verdict = `مجموع ${pros.length} عامل مثبت در برابر ${cons.length} هشدار — شرایط برای خرید و نگهداری چندساعته مناسب است. برنامه‌ی خروج پایین را حتماً رعایت کن.`;
  else if (/نزدیک/.test(r.state.t))
    verdict = 'هنوز کامل نیست؛ یکی دو عامل کم دارد. زیر نظر بگیر و اگر امتیازش بالا رفت وارد شو.';
  else if (/داغ/.test(r.state.t))
    verdict = 'شرایط تکنیکال خوب است ولی دیر رسیده‌ای — منتظر یک اصلاح کوچک بمان.';
  else
    verdict = 'الان دلیل کافی برای خرید وجود ندارد. صبر هم یک معامله است.';

  return { pros, cons, verdict };
}

/* ─────────── نمایش اسکنر ─────────── */
function renderScan() {
  const g = $('#grid');
  let rows = scanRows;
  if (filter === 'buy') rows = rows.filter(r => r.state.t === '🟢 بخر');
  else if (filter === 'near') rows = rows.filter(r => /بخر|نزدیک|داغ/.test(r.state.t));
  else if (filter === 'ob') rows = rows.filter(r => r.ob && r.ob.at)
    .sort((a, b) => OBRANK[a.ob.at] - OBRANK[b.ob.at] ||
      Math.abs(a.ob.distPct) - Math.abs(b.ob.distPct));

  const active = filter === 'ob' ? [] : Object.values(signals).sort((a, b) => b.at - a.at);
  const activeSyms = new Set(active.map(a => a.symbol));
  rows = rows.filter(r => !activeSyms.has(r.symbol));

  $('#empty').hidden = rows.length + active.length > 0;
  if (!rows.length && scanRows.length)
    $('#empty').textContent = filter === 'ob'
      ? 'هیچ ارزی اردربلاک معتبر ۱ ساعته‌ی نزدیک ندارد — کمی بعد دوباره چک کن 🧱'
      : 'الان هیچ ارز جدیدی شرایط خرید ندارد — صبر بهترین معامله است ☕';

  const head = active.length
    ? `<h3 class="sechead">📌 سیگنال‌های فعال (${active.length}) — تا زمان هدف یا حد ضرر معتبرند</h3>`
    : '';
  const tail = rows.length && active.length ? `<h3 class="sechead">🆕 موارد جدید</h3>` : '';

  g.innerHTML = head + active.map(signalCard).join('') + tail + rows.slice(0, 60).map(r => {
    const cls = r.score >= CFG.minScore ? 's-hi' : r.score >= CFG.minScore * .85 ? 's-md' : 's-lo';
    const has = positions.find(p => p.symbol === r.symbol);
    return `<article class="card coin" data-sym="${r.symbol}">
      <div class="top">
        <div><div class="sym">${r.symbol.replace('USDT', '')}${has ? ' 💼' : ''}</div>
          <div class="pair">USDT · ${CFG.tf}</div></div>
        <div class="score ${cls}">${r.score.toFixed(0)}</div>
      </div>
      <div class="state ${r.state.c}">${r.state.t}</div>
      ${obBadge(r.ob)}
      ${spark(r.closes)}
      <div class="kv"><span>قیمت</span><b>${fmt(r.price)}</b></div>
      <div class="kv"><span>۲۴ ساعت</span><b class="${r.chg24 >= 0 ? 'up' : 'dn'}">${pct(r.chg24)}</b></div>
      <div class="kv"><span>رشد حجم</span><b class="${r.volChg >= 0 ? 'up' : 'dn'}">${r.volChg.toFixed(0)}%</b></div>
      <div class="kv"><span>هدف ۱ / ۲</span><b>${fmt(r.tp1)} / ${fmt(r.tp2)}</b></div>
      <div class="kv"><span>حد ضرر</span><b class="dn">${fmt(r.sl)}</b></div>
    </article>`;
  }).join('');

  $$('#grid .coin').forEach(el => el.onclick = () => openDrawer(el.dataset.sym));
}

function spark(closes) {
  if (!closes || closes.length < 2) return '';
  const w = 260, h = 42, mn = Math.min(...closes), mx = Math.max(...closes), r = mx - mn || 1;
  const pts = closes.map((c, i) =>
    `${(i / (closes.length - 1) * w).toFixed(1)},${(h - (c - mn) / r * (h - 4) - 2).toFixed(1)}`).join(' ');
  const up = closes[closes.length - 1] >= closes[0];
  const col = up ? '#22c55e' : '#ef4444';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6"/>
    <polyline points="0,${h} ${pts} ${w},${h}" fill="${col}22" stroke="none"/></svg>`;
}

function renderHeader() {
  $('#btcHealth').textContent = market.txt;
  $('#btcPrice').textContent = market.price ? '$' + fmt(market.price) : '—';
  const obBtn = $('#filterSeg button[data-f="ob"]');
  if (obBtn) {
    const c = scanRows.filter(r => r.ob && r.ob.at).length;
    const hasData = scanRows.some(r => r.ob);
    obBtn.textContent = '🧱 روی اردربلاک' + (hasData ? ` (${c})` : '');
  }
  $('#buyCount').textContent = scanRows.filter(r => r.state.t === '🟢 بخر').length + ' ارز';
  const pnl = positions.reduce((s, p) => s + (p.now ? (p.now / p.entry - 1) * p.amount : 0), 0);
  const el = $('#openPnl');
  el.textContent = positions.length ? money(pnl) : '—';
  el.className = pnl >= 0 ? 'up' : 'dn';
  $('#posCount').textContent = positions.length;
}

/* ─────────── کشوی ارز ─────────── */
function openDrawer(sym) {
  const r = scanRows.find(x => x.symbol === sym);
  if (!r) return;
  $('#drTitle').textContent = r.symbol.replace('USDT', '') + ' / USDT';
  $('#drSub').textContent = `${CFG.tf} · امتیاز ${r.score.toFixed(0)} · ${r.state.t}`;

  const tp1p = (r.tp1 / r.price - 1) * 100, tp2p = (r.tp2 / r.price - 1) * 100,
        slp = (r.sl / r.price - 1) * 100;
  const has = positions.find(p => p.symbol === sym);

  drawerSym = sym;
  const R = reasons(r);
  $('#drBody').innerHTML = `
    <div class="chartbox">
      <div class="chart-top">
        <b>نمودار HARSI</b>
        <span class="muted" id="harsiState">…</span>
      </div>
      <div class="seg tfchart" id="chartTf">
        ${['5m','15m','1h','4h','1d'].map(t =>
          `<button data-ctf="${t}" class="${t === chartTf ? 'on' : ''}">${t}</button>`).join('')}
      </div>
      <div id="harsiBox" class="chart-load">در حال بارگذاری نمودار…</div>
      <div class="chart-legend">
        <span><i style="background:#22c55e"></i> کندل صعودی</span>
        <span><i style="background:#ef4444"></i> کندل نزولی</span>
        <span><i style="background:#60a5fa"></i> خط RSI</span>
      </div>
    </div>
    ${spark(r.closes)}
    <div class="factors">${r.factors.map(f => `
      <div class="f"><span>${f.n}</span>
        <div class="fb"><i style="width:${(f.v * 100).toFixed(0)}%"></i></div>
        <b>${(f.v * f.w * 10).toFixed(0)}</b></div>`).join('')}
    </div>

    <div class="why">
      <h3>🧭 چرا این ارز؟</h3>
      <p class="verdict">${R.verdict}</p>
      ${R.pros.map(([i, t, d]) => `<div class="rz ok"><b>${i} ${t}</b><span>${d}</span></div>`).join('')}
      ${R.cons.length ? `<h4>⚠️ نکات منفی</h4>` : ''}
      ${R.cons.map(([i, t, d]) => `<div class="rz no"><b>${i} ${t}</b><span>${d}</span></div>`).join('')}
    </div>

    ${r.ob && r.ob.zone ? `<div class="plan obplan">
      <div class="kv"><span>🧱 اردربلاک ۱ ساعته</span><b>${r.ob.zone.grade}</b></div>
      <div class="kv"><span>محدوده ناحیه</span><b>${fmt(r.ob.zone.bottom)} – ${fmt(r.ob.zone.top)}</b></div>
      <div class="kv"><span>وضعیت قیمت</span><b class="${r.ob.at === 'inside' ? 'up' : 'wa'}">${
        r.ob.at === 'inside' ? 'داخل ناحیه ✅'
        : r.ob.at === 'near' ? 'چسبیده به ناحیه'
        : r.ob.at === 'approach' ? `${Math.abs(r.ob.distPct).toFixed(1)}٪ تا ناحیه`
        : 'دور از ناحیه'}</b></div>
      <div class="kv"><span>عمر ناحیه</span><b>${r.ob.zone.age} کندل</b></div>
      <div class="kv"><span>حد ضرر پیشنهادی</span><b class="dn">${fmt(r.ob.zone.bottom * 0.997)}</b></div>
    </div>` : ''}

    <div class="plan">
      <div class="kv"><span>قیمت فعلی</span><b>${fmt(r.price)}</b></div>
      <div class="kv"><span>🎯 هدف ۱ (سود جزئی)</span><b class="up">${fmt(r.tp1)} · ${pct(tp1p)}</b></div>
      <div class="kv"><span>🎯 هدف ۲ (فروش کامل)</span><b class="up">${fmt(r.tp2)} · ${pct(tp2p)}</b></div>
      <div class="kv"><span>🛑 حد ضرر</span><b class="dn">${fmt(r.sl)} · ${pct(slp)}</b></div>
      <div class="kv"><span>⌛ حداکثر نگهداری</span><b>${CFG.hold} ساعت</b></div>
      <div class="kv"><span>RSI · نوسان · ADX</span><b>${r.rsi.toFixed(0)} · ${r.atrPct.toFixed(1)}% · ${r.adx.toFixed(0)}</b></div>
    </div>

    ${has ? `<div class="advice ad-hold">💼 این ارز را از قیمت ${fmt(has.entry)} داری — در تب «معامله‌های من» دنبالش کن.</div>`
    : `<div class="buybox">
      <h3 style="font-size:15px;margin-bottom:8px">🛒 ثبت خرید</h3>
      <div class="row"><label>مبلغ خرید ($)</label><input type="number" id="buyAmt" value="${CFG.amount}" step="5"></div>
      <div class="row"><label>قیمت ورود</label><input type="number" id="buyPx" value="${r.price}" step="any"></div>
      <div class="row"><label>مقدار دریافتی</label><b id="buyQty" style="direction:ltr">—</b></div>
      <button class="btn buy" id="doBuy" style="width:100%;margin-top:10px">✅ خریدم — همراهم باش</button>
    </div>`}
  `;

  if (!has) {
    const upd = () => {
      const amt = +$('#buyAmt').value || 0, px = +$('#buyPx').value || r.price;
      $('#buyQty').textContent = (amt / px).toFixed(6) + ' ' + r.symbol.replace('USDT', '');
    };
    $('#buyAmt').oninput = upd; $('#buyPx').oninput = upd; upd();
    $('#doBuy').onclick = () => {
      addPosition(r, +$('#buyAmt').value || CFG.amount, +$('#buyPx').value || r.price);
      closeDrawer();
      switchTab('pos');
    };
  }
  $$('#chartTf button').forEach(b => b.onclick = () => {
    chartTf = b.dataset.ctf; save('chartTf', chartTf);
    $$('#chartTf button').forEach(x => x.classList.toggle('on', x.dataset.ctf === chartTf));
    loadChart(sym, chartTf);
  });
  loadChart(sym, chartTf);

  $('#drawer').classList.add('on');
  $('#scrim').classList.add('on');
}
const closeDrawer = () => { $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); };

/* ─────────── نمودار HARSI ─────────── */
async function loadChart(sym, tf) {
  const box = $('#harsiBox');
  if (!box) return;
  const key = sym + '_' + tf;
  box.className = 'chart-load';
  box.textContent = 'در حال بارگذاری نمودار…';
  try {
    let k = chartCache[key];
    if (!k) {
      k = demo ? TA.demoKlines(hash(key)) : await klines(sym, tf, 260);
      chartCache[key] = k;
    }
    if (drawerSym !== sym) return;               // کاربر ارز را عوض کرده
    const H = TA.harsi(k, 14);
    if (H.length < 10) throw new Error('دیتای کافی نیست');
    box.className = '';
    box.innerHTML = harsiSvg(H.slice(-90));
    const st = TA.harsiState(H[H.length - 1]);
    const el = $('#harsiState');
    if (el) {
      el.textContent = `${st.t} · ${(H[H.length - 1].c + 50).toFixed(0)}`;
      el.className = st.c;
    }
  } catch (e) {
    box.className = 'chart-load';
    box.textContent = '❌ نمودار بارگذاری نشد';
  }
}

function harsiSvg(cs) {
  const W = 340, H = 170, PAD = 22;
  const lo = Math.min(-24, ...cs.map(c => c.l)) - 3;
  const hi = Math.max(24, ...cs.map(c => c.h)) + 3;
  const y = v => PAD + (hi - v) / (hi - lo) * (H - PAD * 2);
  const bw = (W - 26) / cs.length;

  const band = `<rect x="0" y="${y(20)}" width="${W}" height="${Math.max(0, y(-20) - y(20))}"
      fill="#3b82f610"/>`;
  const lines = [20, 0, -20].map(v => `
    <line x1="0" y1="${y(v)}" x2="${W - 26}" y2="${y(v)}"
      stroke="${v === 0 ? '#3d475e' : '#2a3347'}" stroke-width="1"
      stroke-dasharray="${v === 0 ? '0' : '3,3'}"/>
    <text x="${W - 23}" y="${y(v) + 3.5}" font-size="9" fill="#8b98b3">${v + 50}</text>`).join('');

  const candles = cs.map((c, i) => {
    const x = 1 + i * bw, cx = x + bw / 2;
    const up = c.c >= c.o;
    const col = up ? '#22c55e' : '#ef4444';
    const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
    return `<line x1="${cx.toFixed(1)}" y1="${y(c.h).toFixed(1)}" x2="${cx.toFixed(1)}"
        y2="${y(c.l).toFixed(1)}" stroke="${col}" stroke-width="1"/>
      <rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1.2, bw - 1.2).toFixed(1)}"
        height="${Math.max(1, bot - top).toFixed(1)}" fill="${col}" opacity="${up ? .95 : .9}"/>`;
  }).join('');

  const pts = cs.map((c, i) => `${(1 + i * bw + bw / 2).toFixed(1)},${y(c.rsi).toFixed(1)}`).join(' ');

  return `<svg viewBox="0 0 ${W} ${H}" class="harsi" preserveAspectRatio="none">
    ${band}${lines}${candles}
    <polyline points="${pts}" fill="none" stroke="#60a5fa" stroke-width="1.1" opacity=".85"/>
  </svg>`;
}

/* ─────────── معامله‌ها ─────────── */
function addPosition(r, amount, entry) {
  const k = entry / r.price;
  positions.push({
    id: Date.now(), symbol: r.symbol, entry, amount,
    qty: amount / entry,
    tp1: r.tp1 * k, tp2: r.tp2 * k, sl: r.sl * k,
    openedAt: Date.now(), tp1Hit: false, now: entry, score: Math.round(r.score),
    maxPx: entry,
  });
  save('positions', positions);
  notify('💼 خرید ثبت شد', `${r.symbol.replace('USDT', '')} · $${amount} از قیمت ${fmt(entry)}`);
  renderPositions(); renderHeader();
}

function closePosition(id, priceOverride, reason) {
  const i = positions.findIndex(p => p.id === id);
  if (i < 0) return;
  const p = positions[i];
  const px = priceOverride || p.now || p.entry;
  const pnl = (px / p.entry - 1) * p.amount;
  history.unshift({
    ...p, exit: px, closedAt: Date.now(), pnl,
    pnlPct: (px / p.entry - 1) * 100, reason: reason || 'دستی بستم',
  });
  positions.splice(i, 1);
  save('positions', positions); save('history', history);
  renderPositions(); renderHistory(); renderHeader();
}

/* پیشنهاد لحظه‌ای برای هر معامله */
function advise(p) {
  const pnlPct = (p.now / p.entry - 1) * 100;
  const hrs = hoursSince(p.openedAt);
  if (p.now <= p.sl)
    return { c: 'ad-sell', t: `🛑 حد ضرر خورد — همین حالا بفروش و از معامله خارج شو (${pct(pnlPct)})` };
  if (p.now >= p.tp2)
    return { c: 'ad-win', t: `🎯 هدف دوم زده شد — کل پوزیشن را بفروش! سود ${pct(pnlPct)}` };
  if (p.now >= p.tp1 && !p.tp1Hit)
    return { c: 'ad-half', t: `🎯 هدف اول زده شد — نصفش را بفروش و حد ضرر را بیاور روی ${fmt(p.entry)}` };
  if (hrs >= CFG.hold)
    return { c: 'ad-sell', t: `⌛ ${CFG.hold} ساعت گذشت — طبق برنامه خارج شو (${pct(pnlPct)})` };
  if (p.tp1Hit && p.now < p.entry)
    return { c: 'ad-sell', t: '📉 برگشت زیر نقطه ورود بعد از هدف اول — خارج شو' };
  if (hrs >= CFG.hold * 0.75)
    return { c: 'ad-half', t: `⏰ ${(CFG.hold - hrs).toFixed(1)} ساعت تا پایان زمان نگهداری` };
  if (p.tp1Hit)
    return { c: 'ad-win', t: `✅ هدف اول زده شده و ریسک صفر است — تا هدف دوم ${fmt(p.tp2)} نگه دار` };
  return { c: 'ad-hold', t: `🔵 نگه دار — تا هدف اول ${fmt(p.tp1)} صبر کن` };
}

function renderPositions() {
  $('#posEmpty').hidden = positions.length > 0;
  const total = positions.reduce((s, p) => s + p.amount, 0);
  const pnl = positions.reduce((s, p) => s + (p.now / p.entry - 1) * p.amount, 0);
  $('#posSummary').innerHTML = positions.length ? `
    <div><span class="muted">سرمایه درگیر</span><b>$${total.toFixed(2)}</b></div>
    <div><span class="muted">سود/زیان باز</span><b class="${pnl >= 0 ? 'up' : 'dn'}">${money(pnl)}</b></div>
    <div><span class="muted">تعداد</span><b>${positions.length}</b></div>` : '';

  $('#posGrid').innerHTML = positions.map(p => {
    const pnlPct = (p.now / p.entry - 1) * 100;
    const pnlUsd = (p.now / p.entry - 1) * p.amount;
    const a = advise(p);
    const lo = Math.min(p.sl, p.entry), hi = Math.max(p.tp2, p.now);
    const at = TA.clamp((p.now - lo) / (hi - lo) * 100, 0, 100);
    const hrs = hoursSince(p.openedAt);
    return `<article class="card pos" data-id="${p.id}">
      <div class="head">
        <div><div class="sym">${p.symbol.replace('USDT', '')}</div>
          <div class="pair">$${p.amount} · ${clock(p.openedAt)} · ${hrs.toFixed(1)} ساعت</div></div>
        <div class="pnl ${pnlUsd >= 0 ? 'up' : 'dn'}">${money(pnlUsd)}<br>
          <span style="font-size:12px">${pct(pnlPct)}</span></div>
      </div>
      <div class="track"><i style="width:${at}%"></i></div>
      <div class="ticks"><span>🛑 ${fmt(p.sl)}</span><span>${fmt(p.now)}</span><span>🎯 ${fmt(p.tp2)}</span></div>
      <div class="advice ${a.c}">${a.t}</div>
      <div class="kv"><span>ورود</span><b>${fmt(p.entry)}</b></div>
      <div class="kv"><span>هدف ۱ ${p.tp1Hit ? '✅' : ''}</span><b class="up">${fmt(p.tp1)}</b></div>
      <div class="kv"><span>مقدار</span><b>${p.qty.toFixed(6)}</b></div>
      <div class="btnrow">
        <button class="btn danger" data-act="sell" data-id="${p.id}">💰 فروختم</button>
        <button class="btn" data-act="half" data-id="${p.id}">نصفش را فروختم</button>
      </div>
    </article>`;
  }).join('');

  $$('#posGrid [data-act]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const id = +b.dataset.id;
    if (b.dataset.act === 'sell') {
      if (confirm('این معامله بسته شود؟')) closePosition(id, null, 'دستی بستم');
    } else {
      const p = positions.find(x => x.id === id);
      if (!p) return;
      p.amount /= 2; p.qty /= 2; p.tp1Hit = true; p.sl = Math.max(p.sl, p.entry);
      save('positions', positions); renderPositions();
    }
  });
}

function renderHistory() {
  $('#histEmpty').hidden = history.length + signalLog.length > 0;
  const total = history.reduce((s, h) => s + h.pnl, 0);
  const wins = history.filter(h => h.pnl > 0).length;
  $('#histSummary').innerHTML = history.length ? `
    <div><span class="muted">سود کل</span><b class="${total >= 0 ? 'up' : 'dn'}">${money(total)}</b></div>
    <div><span class="muted">معامله‌ها</span><b>${history.length}</b></div>
    <div><span class="muted">برد</span><b>${(wins / history.length * 100).toFixed(0)}%</b></div>` : '';

  const sigHtml = signalLog.length ? `
    <h3 class="sechead">📡 سیگنال‌های بسته‌شده (بدون خرید واقعی)</h3>` +
    signalLog.slice(0, 40).map(s => `
      <div class="row-h">
        <b style="min-width:62px">${s.symbol.replace('USDT', '')}</b>
        <span class="muted" style="font-size:12px">${fmt(s.entry)} → ${fmt(s.now)}</span>
        <span class="muted" style="font-size:12px">${s.reason}</span>
        <span class="pnl ${s.result >= 0 ? 'up' : 'dn'}">${pct(s.result)}</span>
      </div>`).join('') : '';

  $('#histList').innerHTML = (history.length ? '<h3 class="sechead">💼 معامله‌های واقعی</h3>' : '') +
    history.slice(0, 60).map(h => `
    <div class="row-h">
      <b style="min-width:62px">${h.symbol.replace('USDT', '')}</b>
      <span class="muted" style="font-size:12px">${fmt(h.entry)} → ${fmt(h.exit)}</span>
      <span class="muted" style="font-size:12px">${h.reason}</span>
      <span class="pnl ${h.pnl >= 0 ? 'up' : 'dn'}">${money(h.pnl)} · ${pct(h.pnlPct)}</span>
    </div>`).join('') + sigHtml;
}

/* ─────────── قیمت لحظه‌ای + هشدار فروش ─────────── */
async function tick() {
  if (!positions.length) { renderHeader(); return; }
  try {
    let prices = {};
    if (demo) {
      positions.forEach(p => prices[p.symbol] = p.now * (1 + (Math.random() - .48) * .004));
    } else {
      const syms = JSON.stringify(positions.map(p => p.symbol));
      const res = await api('/api/v3/ticker/price', { symbols: syms });
      res.forEach(t => prices[t.symbol] = +t.price);
    }
    positions.forEach(p => {
      const px = prices[p.symbol];
      if (!px) return;
      p.now = px;
      p.maxPx = Math.max(p.maxPx || px, px);
      checkAlerts(p);
    });
    save('positions', positions);
    renderPositions(); renderHeader();
  } catch { /* بی‌صدا رد شو */ }
}

function checkAlerts(p) {
  if (!p.tp1Hit && p.now >= p.tp1) {
    p.tp1Hit = true; p.sl = Math.max(p.sl, p.entry);
    alarm('🎯 هدف اول زده شد!', `${p.symbol.replace('USDT', '')} به ${fmt(p.tp1)} رسید — نصفش را بفروش، حد ضرر روی نقطه ورود رفت.`);
  }
  if (!p.tp2Alerted && p.now >= p.tp2) {
    p.tp2Alerted = true;
    alarm('🎯 هدف دوم — بفروش!', `${p.symbol.replace('USDT', '')} به ${fmt(p.tp2)} رسید. سود ${pct((p.now / p.entry - 1) * 100)}`);
  }
  if (!p.slAlerted && p.now <= p.sl) {
    p.slAlerted = true;
    alarm('🛑 حد ضرر خورد', `${p.symbol.replace('USDT', '')} به ${fmt(p.sl)} رسید — خارج شو.`);
  }
  if (!p.timeAlerted && hoursSince(p.openedAt) >= CFG.hold) {
    p.timeAlerted = true;
    alarm('⌛ زمان نگهداری تمام شد', `${p.symbol.replace('USDT', '')} — طبق برنامه خارج شو. نتیجه ${pct((p.now / p.entry - 1) * 100)}`);
  }
}

function notify(title, body) {
  if (window.Notification && Notification.permission === 'granted')
    new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💎</text></svg>' });
}
function beep() {
  if (!CFG.sound) return;
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(.25, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, c.currentTime + .6);
    o.start(); o.stop(c.currentTime + .6);
  } catch { }
}
function alarm(title, body) { notify(title, body); beep(); }

/* ─────────── تب‌ها و تنظیمات ─────────── */
function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'page-' + name));
}

function bindSettings() {
  const map = {
    s_tp1: 'tp1', s_tp2: 'tp2', s_sl: 'sl', s_hold: 'hold', s_rsi: 'maxRsi',
    s_top: 'top', s_amt: 'amount', s_poll: 'poll', s_auto: 'auto',
  };
  for (const [id, key] of Object.entries(map)) {
    const el = $('#' + id);
    el.value = CFG[key];
    el.onchange = () => { CFG[key] = +el.value; save('cfg', CFG); renderPositions(); };
  }
  $('#s_sound').checked = CFG.sound;
  $('#s_sound').onchange = e => { CFG.sound = e.target.checked; save('cfg', CFG); };

  $('#notifBtn').onclick = async () => {
    if (!window.Notification) return alert('مرورگر شما اعلان را پشتیبانی نمی‌کند');
    const p = await Notification.requestPermission();
    $('#notifBtn').textContent = p === 'granted' ? '✅ فعال است' : 'رد شد';
    if (p === 'granted') notify('✅ اعلان فعال شد', 'از این به بعد لحظه فروش را خبر می‌دهم.');
  };

  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ cfg: CFG, positions, history }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trade-assistant-backup.json';
    a.click();
  };
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (d.cfg) { CFG = { ...DEFAULTS, ...d.cfg }; save('cfg', CFG); }
        if (d.positions) { positions = d.positions; save('positions', positions); }
        if (d.history) { history = d.history; save('history', history); }
        location.reload();
      } catch { alert('فایل معتبر نیست'); }
    };
    rd.readAsText(f);
  };
  $('#resetBtn').onclick = () => {
    if (!confirm('همه معامله‌ها، سیگنال‌ها و تاریخچه پاک شود؟')) return;
    localStorage.clear(); location.reload();
  };
}

/* ─────────── راه‌اندازی ─────────── */
function init() {
  $$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
  $('#scanBtn').onclick = scan;
  $('#closeDrawer').onclick = closeDrawer;
  $('#scrim').onclick = closeDrawer;

  $$('#tfSeg button').forEach(b => b.onclick = () => {
    $$('#tfSeg button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); CFG.tf = b.dataset.tf; save('cfg', CFG); scan();
  });
  $$('#filterSeg button').forEach(b => b.onclick = async () => {
    $$('#filterSeg button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); filter = b.dataset.f;
    if (filter === 'ob') await ensureOB();
    renderScan();
  });
  const ms = $('#minScore');
  ms.value = CFG.minScore; $('#minScoreVal').textContent = CFG.minScore;
  ms.oninput = () => { $('#minScoreVal').textContent = ms.value; };
  ms.onchange = () => {
    CFG.minScore = +ms.value; save('cfg', CFG);
    scanRows.forEach(r => r.state = TA.stateOf(r.score, r.rsi, market.ok, CFG));
    renderScan(); renderHeader();
  };
  $$('#tfSeg button').forEach(b => b.classList.toggle('on', b.dataset.tf === CFG.tf));

  bindSettings();
  renderPositions(); renderHistory(); renderHeader();
  scan();

  setInterval(tick, Math.max(5, CFG.poll) * 1000);
  setInterval(() => {
    if (CFG.auto > 0 && Date.now() - lastScan > CFG.auto * 60000) scan();
  }, 30000);
}

function evaluatePositions() {
  positions.forEach(p => {
    const r = scanRows.find(x => x.symbol === p.symbol);
    if (r) { p.now = r.price; checkAlerts(p); }
  });
  save('positions', positions);
  renderPositions();
}

document.addEventListener('DOMContentLoaded', init);
