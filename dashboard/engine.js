/* ═══════════════════════════════════════════════════════════════════
   موتور تحلیل — همان منطق ۸ عاملی اندیکاتور Spot Buy Scanner
   ✍️ طراحی و توسعه توسط آرمان ناصری
   ═══════════════════════════════════════════════════════════════════ */
const TA = (() => {

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function sma(v, n) {
    if (v.length < n) return null;
    let s = 0;
    for (let i = v.length - n; i < v.length; i++) s += v[i];
    return s / n;
  }

  function emaSeries(v, n) {
    if (v.length < n) return [];
    const k = 2 / (n + 1);
    let seed = 0;
    for (let i = 0; i < n; i++) seed += v[i];
    const out = [seed / n];
    for (let i = n; i < v.length; i++) out.push(v[i] * k + out[out.length - 1] * (1 - k));
    return out;
  }
  const ema = (v, n) => { const s = emaSeries(v, n); return s.length ? s[s.length - 1] : null; };

  /* میانگین وایلدر — پایه RSI و ATR و ADX */
  function rmaSeries(v, n) {
    if (v.length < n) return [];
    let seed = 0;
    for (let i = 0; i < n; i++) seed += v[i];
    const out = [seed / n];
    for (let i = n; i < v.length; i++) out.push((out[out.length - 1] * (n - 1) + v[i]) / n);
    return out;
  }

  function rsi(closes, n = 14) {
    if (closes.length < n + 1) return null;
    const g = [], l = [];
    for (let i = 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      g.push(Math.max(d, 0)); l.push(Math.max(-d, 0));
    }
    const ag = rmaSeries(g, n), al = rmaSeries(l, n);
    if (!ag.length || !al.length) return null;
    const A = ag[ag.length - 1], L = al[al.length - 1];
    if (L === 0) return 100;
    return 100 - 100 / (1 + A / L);
  }

  function macd(closes, f = 12, s = 26, sig = 9) {
    if (closes.length < s + sig) return null;
    const fs = emaSeries(closes, f), ss = emaSeries(closes, s);
    const off = fs.length - ss.length;
    const line = ss.map((v, i) => fs[i + off] - v);
    const sl = emaSeries(line, sig);
    if (!sl.length) return null;
    const hoff = line.length - sl.length;
    const hist = sl.map((v, i) => line[i + hoff] - v);
    return {
      line: line[line.length - 1],
      signal: sl[sl.length - 1],
      hist: hist[hist.length - 1],
      prev: hist.length > 1 ? hist[hist.length - 2] : hist[hist.length - 1],
    };
  }

  function trueRanges(h, l, c) {
    const tr = [];
    for (let i = 1; i < c.length; i++)
      tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    return tr;
  }

  function atr(h, l, c, n = 14) {
    const s = rmaSeries(trueRanges(h, l, c), n);
    return s.length ? s[s.length - 1] : null;
  }

  function adx(h, l, c, n = 14) {
    if (c.length < n * 2 + 2) return null;
    const pdm = [], mdm = [];
    for (let i = 1; i < c.length; i++) {
      const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
      pdm.push(up > dn && up > 0 ? up : 0);
      mdm.push(dn > up && dn > 0 ? dn : 0);
    }
    const trS = rmaSeries(trueRanges(h, l, c), n);
    const pS = rmaSeries(pdm, n), mS = rmaSeries(mdm, n);
    if (!trS.length) return null;
    const dx = [];
    for (let i = 0; i < trS.length; i++) {
      if (!trS[i]) continue;
      const p = 100 * pS[i] / trS[i], m = 100 * mS[i] / trS[i];
      if (p + m === 0) continue;
      dx.push(100 * Math.abs(p - m) / (p + m));
    }
    const s = rmaSeries(dx, n);
    return s.length ? s[s.length - 1] : null;
  }

  /* ─────────── امتیازدهی ۸ عاملی ─────────── */
  const TFMIN = { '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '1d': 1440 };

  function analyze(k, cfg) {
    const c = k.map(x => x.close), h = k.map(x => x.high),
          l = k.map(x => x.low), v = k.map(x => x.volume);
    if (c.length < 210) return null;

    const price = c[c.length - 1];
    const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
    const r = rsi(c, 14), a = atr(h, l, c, 14), ax = adx(h, l, c, 14) || 0;
    const m = macd(c);
    if ([e20, e50, e200, r, a].some(x => x == null) || !m) return null;

    const vMA = sma(v, 20) || 0;
    const vRecent = sma(v, 10) || 0;
    const vPrior = sma(v.slice(0, -10), 10) || 0;
    const hi20 = Math.max(...h.slice(-20)), lo20 = Math.min(...l.slice(-20));
    const lo10 = Math.min(...l.slice(-10)), hh10 = Math.max(...h.slice(-11, -1));

    /* ۱ روند */
    const trend = (price > e50 ? .4 : 0) + (e50 > e200 ? .4 : 0) + (price > e200 ? .2 : 0);
    /* ۲ مومنتوم */
    const momo = (m.hist > 0 ? .55 : 0) + (m.hist > m.prev ? .30 : 0) +
                 ((m.line - m.signal) > 0 && ax > 20 ? .15 : 0);
    /* ۳ RSI سالم */
    const rs = (r >= 45 && r <= 63) ? 1 : (r > 63 && r <= 70) ? .55 :
               (r >= 38 && r < 45) ? .6 : .1;
    /* ۴ حجم تازه */
    const vChg = vPrior > 0 ? (vRecent - vPrior) / vPrior * 100 : 0;
    const vRat = vMA > 0 ? v[v.length - 1] / vMA : 1;
    let vol = (vChg >= 10 && vChg <= 110) ? clamp(vChg / 60, .35, 1) :
              vChg > 110 ? .35 : vChg > 0 ? .25 : 0;
    if (vRat > 3) vol *= .5;
    /* ۵ ناحیه ارزش */
    const rng = hi20 - lo20;
    const pos = rng > 0 ? (price - lo20) / rng * 100 : 50;
    const pull = (pos >= 30 && pos <= 72) ? 1 : (pos > 72 && pos <= 88) ? .5 :
                 (pos >= 15 && pos < 30) ? .55 : .15;
    /* ۶ قدرت روند */
    const adxS = clamp((ax - 14) / 14, 0, 1);
    /* ۷ ساختار */
    const str = (lo10 > lo20 ? .5 : 0) + (price > hh10 ? .5 : 0);
    /* ۸ نوسان منطقی */
    const atrP = a / price * 100;
    const vola = (atrP >= .4 && atrP <= 5) ? 1 : atrP < .4 ? .3 : .25;

    const raw = trend * 2 + momo * 1.5 + rs * 1.2 + vol * 1.5 +
                pull * 1.2 + adxS * 1 + str * .8 + vola * .8;

    /* ─── ریسک ساختاری: اول حد ضرر از ساختار، بعد هدف‌ها ضریبی از همان ریسک ─── */
    const maxRiskPct = cfg.maxRisk || 3.5;
    const r1 = cfg.r1 || 1.5, r2 = cfg.r2 || 3;
    let sl = Math.min(lo10 * 0.997, price - a * 0.9);
    let risk = price - sl;
    if (risk < a * 0.8) { risk = a * 0.8; sl = price - risk; }   // حد ضرر بیش از حد تنگ = استاپ‌هانت
    const riskPct = risk / price * 100;
    const fee = price * 0.002;                                    // کارمزد رفت‌وبرگشت ۰.۲٪
    const tp1 = price + risk * r1, tp2 = price + risk * r2;
    const rr1 = (risk * r1 - fee) / risk, rr2 = (risk * r2 - fee) / risk;
    const riskOk = riskPct <= maxRiskPct && rr1 >= 1.2;

    /* ─── مومنتوم چند دوره‌ای (برای رتبه‌بندی بین ارزها) ─── */
    const tfMin = TFMIN[cfg.tf] || 60;
    const bars = Math.max(1, Math.round(1440 / tfMin));
    const back = d => c[Math.max(0, c.length - 1 - bars * d)];
    const mom3 = price / back(3) - 1, mom7 = price / back(7) - 1, mom14 = price / back(14) - 1;

    return {
      score: clamp(raw * 10, 0, 100),
      price, rsi: r, atr: a, atrPct: atrP, volChg: vChg, volRatio: vRat,
      adx: ax, ema20: e20, ema50: e50, ema200: e200, pos,
      tp1, tp2, sl, risk, riskPct, rr1, rr2, riskOk,
      mom3, mom7, mom14,
      det: {
        aboveE50: price > e50, e50Above200: e50 > e200, aboveE200: price > e200,
        macdPos: m.hist > 0, macdRising: m.hist > m.prev,
        hh10, lo10, lo20, hi20, vRat,
        breakout: price > hh10, higherLow: lo10 > lo20,
        distE20: (price / e20 - 1) * 100,
      },
      factors: [
        { n: 'روند', v: trend, w: 2 },
        { n: 'مومنتوم', v: momo, w: 1.5 },
        { n: 'حجم تازه', v: vol, w: 1.5 },
        { n: 'RSI سالم', v: rs, w: 1.2 },
        { n: 'ناحیه ارزش', v: pull, w: 1.2 },
        { n: 'قدرت روند', v: adxS, w: 1 },
        { n: 'ساختار', v: str, w: .8 },
        { n: 'نوسان', v: vola, w: .8 },
      ],
      closes: c.slice(-120),
    };
  }

  function btcHealth(k) {
    const c = k.map(x => x.close);
    const e50 = ema(c, 50), e200 = ema(c, 200), r = rsi(c, 14);
    if ([e50, e200, r].some(x => x == null)) return null;
    return (c[c.length - 1] > e50 ? 40 : 0) + (e50 > e200 ? 30 : 0) + (r > 45 ? 30 : 0);
  }

  function stateOf(score, rsiV, btcOk, cfg, ex) {
    if (score <= 0) return { t: '—', c: 'mu' };
    const good = score >= cfg.minScore;
    // گیت‌های سخت — هیچ‌کدام نباشد، «بخر» صادر نمی‌شود
    if (good && ex && ex.riskOk === false)
      return { t: '📐 ریسک/سود ضعیف', c: 'mu' };
    if (good && !btcOk) return { t: '🟡 بازار ضعیف', c: 'wa' };
    if (good && rsiV > cfg.maxRsi) return { t: '⚠️ داغ / صبر', c: 'wa' };
    if (good && ex && ex.rankOk === false)
      return { t: '🐢 ضعیف‌تر از بازار', c: 'mu' };
    if (good) return { t: '🟢 بخر', c: 'up' };
    if (score >= cfg.minScore * .85) return { t: '⏳ نزدیک است', c: 'wa' };
    if (score >= cfg.minScore * .6) return { t: '😐 ضعیف', c: 'mu' };
    return { t: '🚫 نخر', c: 'dn' };
  }

  /* رژیم بازار: BTC بالای EMA200 باشد + سلامت کافی */
  function regime(btcK) {
    const c = btcK.map(x => x.close);
    const e200 = ema(c, 200), e50 = ema(c, 50);
    const price = c[c.length - 1];
    const h = btcHealth(btcK);
    const above200 = e200 == null ? true : price > e200;
    const above50 = e50 == null ? true : price > e50;
    const ok = above200 && (h == null || h >= 40);
    return {
      ok, health: h, price, above200, above50,
      txt: !above200 ? '🔴 نزولی (زیر EMA200)'
         : h != null && h >= 70 ? '🟢 صعودی و سالم'
         : h != null && h < 40 ? '🟡 بالای EMA200 ولی ضعیف'
         : '🟢 صعودی',
      mult: ok ? 1 : 0.7,
    };
  }

  /* دیتای ساختگی برای حالت نمایشی (وقتی بایننس در دسترس نیست) */
  function demoKlines(seed = 1, n = 260) {
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const trend = (rnd() - .35) * 0.004;
    let p = 10 + rnd() * 200;
    const out = [];
    for (let i = 0; i < n; i++) {
      const open = p;
      p *= 1 + trend + (rnd() - .5) * 0.02;
      const hi = Math.max(open, p) * (1 + rnd() * .006);
      const lo = Math.min(open, p) * (1 - rnd() * .006);
      out.push({
        time: Date.now() - (n - i) * 3600e3,
        open, high: hi, low: lo, close: p,
        volume: 1000 * (.6 + rnd() * 1.2) * (i > n - 14 ? 1.2 + rnd() : 1),
      });
    }
    return out;
  }


  /* ─────────── HARSI — Heikin-Ashi RSI ───────────
     RSI روی open/high/low/close حساب و بعد با روش هایکن‌اشی صاف می‌شود.
     مقادیر حول صفر نوسان می‌کنند: صفر = RSI 50 ، +20 = RSI 70 ، −20 = RSI 30 */
  function rsiSeries(v, n = 14) {
    const out = new Array(v.length).fill(null);
    if (v.length < n + 1) return out;
    const g = [], l = [];
    for (let i = 1; i < v.length; i++) {
      const d = v[i] - v[i - 1];
      g.push(Math.max(d, 0)); l.push(Math.max(-d, 0));
    }
    const ag = rmaSeries(g, n), al = rmaSeries(l, n);
    for (let i = 0; i < ag.length; i++) {
      const A = ag[i], L = al[i];
      out[i + n] = L === 0 ? 100 : 100 - 100 / (1 + A / L);
    }
    return out;
  }

  function harsi(k, len = 14, smooth = 1) {
    const c = k.map(x => x.close), h = k.map(x => x.high),
          l = k.map(x => x.low), t = k.map(x => x.time);
    const zc = rsiSeries(c, len).map(x => x == null ? null : x - 50);
    const zh = rsiSeries(h, len).map(x => x == null ? null : x - 50);
    const zl = rsiSeries(l, len).map(x => x == null ? null : x - 50);

    const out = [];
    let pO = null, pC = null;
    for (let i = 1; i < zc.length; i++) {
      if (zc[i] == null || zh[i] == null || zl[i] == null) continue;
      const closeRSI = zc[i];
      const openRSI = zc[i - 1] == null ? closeRSI : zc[i - 1];
      const hiR = Math.max(zh[i], zl[i]), loR = Math.min(zh[i], zl[i]);
      const cc = (openRSI + hiR + loR + closeRSI) / 4;
      const oo = pO == null ? (openRSI + closeRSI) / 2 : (pO + pC) / 2;
      out.push({
        time: t[i], o: oo, c: cc,
        h: Math.max(hiR, oo, cc), l: Math.min(loR, oo, cc),
        rsi: closeRSI,
      });
      pO = oo; pC = cc;
    }
    if (smooth > 1) {
      for (const key of ['o', 'h', 'l', 'c']) {
        const src = out.map(x => x[key]);
        const sm = emaSeries(src, smooth);
        const off = out.length - sm.length;
        sm.forEach((v, i) => out[i + off][key] = v);
      }
    }
    return out;
  }

  function harsiState(last) {
    if (!last) return { t: '—', c: 'mu' };
    if (last.c >= 20) return { t: '🔥 اشباع خرید', c: 'wa' };
    if (last.c >= 8) return { t: '🟢 قدرت خریدار', c: 'up' };
    if (last.c > 0) return { t: '🔵 کمی مثبت', c: 'up' };
    if (last.c <= -20) return { t: '🧊 اشباع فروش', c: 'wa' };
    if (last.c <= -8) return { t: '🔴 قدرت فروشنده', c: 'dn' };
    return { t: '⚪ خنثی', c: 'mu' };
  }


  /* ─────────── اردربلاک صعودی (تایم ۱ ساعته) ───────────
     آخرین کندل نزولی پیش از یک حرکت صعودی قوی که ساختار را شکسته است.
     شرط‌های اعتبار:  حرکت ≥ ۱.۵×ATR  ·  حجم ≥ میانگین  ·  شکست سقف قبلی (BOS)
     و تا الان قیمت با بسته‌شدن کندل زیر آن نرفته باشد.                      */
  function orderBlocks(k, look = 140) {
    const c = k.map(x => x.close), h = k.map(x => x.high),
          l = k.map(x => x.low), o = k.map(x => x.open), v = k.map(x => x.volume);
    const n = c.length;
    if (n < 60) return { zones: [], at: false };

    const atrV = atr(h, l, c, 14) || 0;
    const vAvg = sma(v, 20) || 0;
    const price = c[n - 1];
    const zones = [];
    const start = Math.max(12, n - look);

    for (let i = start; i < n - 4; i++) {
      if (c[i] >= o[i]) continue;                       // باید کندل نزولی باشد
      if (vAvg > 0 && v[i] < vAvg * 0.9) continue;      // حجم کافی

      const hi3 = Math.max(h[i + 1], h[i + 2], h[i + 3]);
      const move = hi3 - c[i];
      if (move < atrV * 1.5) continue;                  // حرکت باید قوی باشد

      let prevHigh = -Infinity;
      for (let j = Math.max(0, i - 10); j < i; j++) prevHigh = Math.max(prevHigh, h[j]);
      if (hi3 <= prevHigh) continue;                    // شکست ساختار (BOS)

      const top = Math.max(o[i], h[i] * 0.999), bottom = l[i];

      let broken = false;                               // بعداً باطل نشده باشد
      for (let j = i + 1; j < n; j++) if (c[j] < bottom) { broken = true; break; }
      if (broken) continue;

      const strength = move / (atrV || 1);
      zones.push({
        idx: i, top, bottom, mid: (top + bottom) / 2,
        age: n - 1 - i, strength,
        volRatio: vAvg > 0 ? v[i] / vAvg : 1,
        grade: strength >= 3 ? 'قوی' : strength >= 2 ? 'متوسط' : 'ضعیف',
      });
    }

    // فقط ناحیه‌هایی که زیر یا روی قیمت فعلی‌اند و نزدیک‌ترین‌ها
    const valid = zones
      .filter(z => z.bottom <= price * 1.02)
      .sort((a, b) => b.idx - a.idx)
      .slice(0, 4);

    // نزدیک‌ترین ناحیه به قیمت فعلی
    let near = null, bestD = Infinity, inside = false;
    for (const z of valid) {
      const ins = price <= z.top * 1.004 && price >= z.bottom * 0.996;
      const d = ins ? 0 : Math.abs(price - z.top) / price;
      if (d < bestD) { bestD = d; near = z; inside = ins; }
    }

    let at = false;
    if (near) {
      const tol = Math.max(0.012, (atrV / price) * 1.2);   // «نزدیک» = ~۱.۲٪ یا ۱.۲ برابر ATR
      at = inside ? 'inside' : bestD <= tol ? 'near' : bestD <= 0.045 ? 'approach' : false;
    }

    return {
      zones: valid, at, zone: near, atrV,
      distPct: near ? (price / near.top - 1) * 100 : null,
      belowPct: near ? (price / near.bottom - 1) * 100 : null,
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     رگرسیون چندهسته‌ای — Multi Kernel Regression
     برآوردگر نادارایا–واتسون یک‌طرفه (فقط گذشته ⇒ بازترسیم نمی‌شود)
       ŷ(t) = Σ K(i/h)·price(t−i) ⁄ Σ K(i/h)
     هر هسته شکل وزن‌دهی متفاوتی به کندل‌های گذشته می‌دهد.
     ═══════════════════════════════════════════════════════════════ */
  const KERNELS = {
    gaussian:     { t: 'گاوسی',       inf: true,  f: u => Math.exp(-0.5 * u * u) },
    laplace:      { t: 'لاپلاس',      inf: true,  f: u => Math.exp(-Math.abs(u)) / 2 },
    logistic:     { t: 'لجستیک',      inf: true,  f: u => 1 / (Math.exp(u) + 2 + Math.exp(-u)) },
    epanechnikov: { t: 'اپانچنیکوف',  inf: false, f: u => Math.abs(u) <= 1 ? 0.75 * (1 - u * u) : 0 },
    triangular:   { t: 'مثلثی',       inf: false, f: u => Math.abs(u) <= 1 ? 1 - Math.abs(u) : 0 },
    tricube:      { t: 'سه‌مکعبی',    inf: false, f: u => Math.abs(u) <= 1 ? Math.pow(1 - Math.pow(Math.abs(u), 3), 3) : 0 },
    quartic:      { t: 'کوارتیک',     inf: false, f: u => Math.abs(u) <= 1 ? Math.pow(1 - u * u, 2) * 15 / 16 : 0 },
    cosine:       { t: 'کسینوسی',     inf: false, f: u => Math.abs(u) <= 1 ? Math.PI / 4 * Math.cos(Math.PI / 2 * u) : 0 },
    wave:         { t: 'موجی',        inf: false, f: u => Math.abs(u) <= 1 ? (1 - Math.abs(u)) * Math.cos(Math.PI * u) : 0 },
  };
  const kernelList = () => Object.entries(KERNELS).map(([k, v]) => ({ k, t: v.t }));

  /* یک سری کامل از خط رگرسیون؛ خروجی هم‌طول ورودی (ابتدای آن null) */
  function kernelReg(src, h = 14, type = 'gaussian') {
    const K = KERNELS[type] || KERNELS.gaussian;
    const bw = Math.max(2, h);
    const depth = Math.max(3, Math.ceil(K.inf ? bw * 3 : bw));   // دم بی‌نهایت تا ۳ برابر پهنا
    const w = [];
    for (let i = 0; i < depth; i++) w.push(K.f(i / bw));
    const out = new Array(src.length).fill(null);
    for (let t = 0; t < src.length; t++) {
      if (t < Math.min(depth, 5) - 1) continue;
      let num = 0, den = 0;
      for (let i = 0; i < depth && t - i >= 0; i++) {
        const k = w[i];
        if (k <= 0) continue;
        num += k * src[t - i];
        den += k;
      }
      if (den > 0) out[t] = num / den;
    }
    return out;
  }

  /* ترکیب چند هسته + باندهای انحراف باقیمانده + وضعیت روند */
  function multiKernel(src, opt = {}) {
    const h = opt.h || 14;
    const dev = opt.dev == null ? 1.5 : opt.dev;
    const types = opt.types && opt.types.length ? opt.types
      : ['gaussian', 'epanechnikov', 'wave'];      // سه‌گانه‌ی تأیید متقاطع
    const n = src.length;
    if (n < 20) return null;

    const lines = {};
    types.forEach(ty => { lines[ty] = kernelReg(src, h, ty); });

    // میانگین بدون سوگیری سه هسته
    const avg = new Array(n).fill(null);
    for (let t = 0; t < n; t++) {
      let s = 0, c = 0;
      for (const ty of types) { const v = lines[ty][t]; if (v != null) { s += v; c++; } }
      if (c === types.length) avg[t] = s / c;
    }

    // انحراف معیار باقیمانده‌ها (نه قیمت) ⇒ باند در روند پهن نمی‌شود
    const win = Math.max(10, Math.round(h * 2));
    const res = [];
    for (let t = Math.max(0, n - win); t < n; t++)
      if (avg[t] != null) res.push(src[t] - avg[t]);
    const mean = res.length ? res.reduce((a, b) => a + b, 0) / res.length : 0;
    const sigma = res.length > 2
      ? Math.sqrt(res.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (res.length - 1)) : 0;

    const last = avg[n - 1], prev = avg[n - 2];
    if (last == null || prev == null) return null;

    /* برآوردگر یک‌طرفه ذاتاً عقب‌تر از قیمت است؛ این سوگیری ثابت را
       از باندها جدا می‌کنیم تا باند واقعاً دور قیمت بنشیند، نه عقب آن. */
    const bias = mean;
    const center = last + bias;
    const price = src[n - 1];
    const upper = center + sigma * dev, lower = center - sigma * dev;

    const back = Math.max(2, Math.round(h / 2));        // مرجع شیب: نیم‌پهنای باند
    const ref = avg[n - 1 - back] != null ? avg[n - 1 - back] : prev;
    const slopePct = prev ? (last / prev - 1) * 100 : 0;
    const slope3 = ref ? (last / ref - 1) * 100 : slopePct;
    const volPct = center > 0 ? (sigma / center) * 100 : 0;
    const slopeSig = volPct > 0 ? slope3 / volPct : slope3;   // شیب بر حسب نوسان

    // چند هسته هم‌جهت‌اند؟ (قدرت اجماع)
    let agree = 0;
    for (const ty of types) {
      const L = lines[ty];
      if (L[n - 1] != null && L[n - 1 - back] != null && L[n - 1] > L[n - 1 - back]) agree++;
    }

    const z = sigma > 0 ? (price - center) / sigma : 0;
    const above = price > last;
    const wasBelow = avg[n - 2] != null && src[n - 2] <= avg[n - 2];
    const wasAbove = avg[n - 2] != null && src[n - 2] >= avg[n - 2];

    let cross = null;                                   // لحظه‌ی عبور از خط
    if (above && wasBelow) cross = 'up';
    else if (!above && wasAbove) cross = 'down';

    let touch = null;                                   // برخورد به باندها
    if (sigma > 0) {
      if (price <= lower) touch = 'lower';
      else if (price >= upper) touch = 'upper';
    }

    const trendUp = slopeSig > 0.5 && agree >= Math.ceil(types.length / 2);
    const trendDn = slopeSig < -0.5 && agree <= Math.floor(types.length / 2);

    // امتیاز ۰..۱ برای استفاده در موتور امتیازدهی
    let score = 0.5;
    score += (agree / types.length - 0.5) * 0.5;        // اجماع هسته‌ها
    score += clamp(slopeSig / 8, -0.25, 0.25);          // شیب نرمال‌شده با نوسان
    if (above) score += 0.08; else score -= 0.08;
    if (z > 2) score -= 0.15;                           // خیلی دور از میانگین = کشیده
    if (trendUp && touch === 'lower') score += 0.15;    // پولبک به باند پایین در روند صعودی
    score = clamp(score, 0, 1);

    return {
      types, h, dev, lines, avg, sigma, score, bias, center,
      value: last, upper, lower, price, z, slopePct, slope3, slopeSig, volPct,
      agree, total: types.length, above, cross, touch, trendUp, trendDn,
      distPct: (price / last - 1) * 100,
    };
  }

  /* ═══ شکار سیگنال تازه ═══
     همان شرط‌های Pine، ولی روی چند کندل آخر اجرا می‌شود تا بفهمیم
     سیگنال خرید دقیقاً چند کندل پیش صادر شده است.
       الف) عبور قیمت به بالای خط رگرسیون در روند صعودی
       ب)  پایان پولبک: قیمت از زیر باند پایین برگشته بالا          */
  function kernelSignals(src, opt = {}, look = 10) {
    const h = opt.h || 14;
    const dev = opt.dev == null ? 1.5 : opt.dev;
    const types = opt.types && opt.types.length ? opt.types
      : ['gaussian', 'epanechnikov', 'wave'];
    const n = src.length;
    const win = Math.max(10, Math.round(h * 2));
    const back = Math.max(2, Math.round(h / 2));
    if (n < win + back + look + 5) return null;

    const lines = {};
    types.forEach(ty => { lines[ty] = kernelReg(src, h, ty); });
    const avg = new Array(n).fill(null);
    for (let t = 0; t < n; t++) {
      let s = 0, c = 0;
      for (const ty of types) { const v = lines[ty][t]; if (v != null) { s += v; c++; } }
      if (c === types.length) avg[t] = s / c;
    }

    /* وضعیت کامل یک کندل مشخص (فقط با داده‌ی تا همان کندل) */
    const at = t => {
      if (avg[t] == null || avg[t - back] == null) return null;
      const res = [];
      for (let i = Math.max(0, t - win + 1); i <= t; i++)
        if (avg[i] != null) res.push(src[i] - avg[i]);
      if (res.length < 5) return null;
      const mean = res.reduce((a, b) => a + b, 0) / res.length;
      const sigma = Math.sqrt(res.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (res.length - 1));
      const center = avg[t] + mean;
      const volPct = center > 0 ? sigma / center * 100 : 0;
      const slopePct = avg[t - back] ? (avg[t] / avg[t - back] - 1) * 100 : 0;
      const slopeSig = volPct > 0 ? slopePct / volPct : slopePct;
      let agree = 0;
      for (const ty of types) {
        const L = lines[ty];
        if (L[t] != null && L[t - back] != null && L[t] > L[t - back]) agree++;
      }
      const need = Math.ceil(types.length / 2);
      return {
        center, sigma, slopeSig, agree,
        upper: center + sigma * dev, lower: center - sigma * dev,
        trendUp: slopeSig > 0.5 && agree >= need,
        trendDn: slopeSig < -0.5 && agree <= Math.floor(types.length / 2),
        z: sigma > 0 ? (src[t] - center) / sigma : 0,
      };
    };

    let fired = null;
    for (let t = n - 1; t >= n - look && t > back + win; t--) {
      const c = at(t), p = at(t - 1);
      if (!c || !p) continue;
      if (!c.trendUp) continue;
      const crossUp = src[t] > c.center && src[t - 1] <= p.center;
      // پولبک تمام شد: زیر باند پایین بوده و حالا بالای آن بسته شده
      const pullEnd = src[t] > c.lower && src[t - 1] <= p.lower;
      // روند تازه تأیید شد (قیمت از قبل بالای خط بوده ولی روند هنوز تأیید نشده بود)
      const flip = !p.trendUp && src[t] > c.center;
      if (crossUp || pullEnd || flip) {
        fired = {
          age: n - 1 - t,                        // ۰ = همین کندل بسته‌شده
          kind: pullEnd ? 'pullback' : crossUp ? 'cross' : 'trend',
          z: c.z, agree: c.agree, total: types.length,
          slopeSig: c.slopeSig, center: c.center, lower: c.lower, upper: c.upper,
          price: src[n - 1], atPrice: src[t],
          chgSince: src[t] ? (src[n - 1] / src[t] - 1) * 100 : 0,
        };
        break;
      }
    }
    return fired;
  }

  /* وضعیت خوانا برای نمایش */
  function kernelState(mk) {
    if (!mk) return { t: 'بدون داده', c: 'muted', i: '◻️' };
    if (mk.trendUp && mk.touch === 'lower')
      return { t: 'پولبک به باند پایین', c: 'wa', i: '🎯' };
    if (mk.touch === 'upper' && mk.z > mk.dev * 1.5)
      return { t: 'کشیده بالای باند', c: 'wa', i: '⚠️' };
    if (mk.agree === mk.total && mk.trendUp && mk.above)
      return { t: 'روند صعودی تأییدشده', c: 'up', i: '🟢' };
    if (mk.agree === 0 && mk.trendDn && !mk.above)
      return { t: 'روند نزولی تأییدشده', c: 'dn', i: '🔴' };
    if (mk.touch === 'upper')
      return { t: 'کشیده بالای باند', c: 'wa', i: '⚠️' };
    if (mk.cross === 'up') return { t: 'عبور رو به بالا', c: 'up', i: '↗️' };
    if (mk.cross === 'down') return { t: 'عبور رو به پایین', c: 'dn', i: '↘️' };
    if (mk.trendUp) return { t: 'صعودی ضعیف', c: 'up', i: '🟡' };
    if (mk.trendDn) return { t: 'نزولی ضعیف', c: 'dn', i: '🟠' };
    return { t: 'بدون جهت (رِنج)', c: 'muted', i: '⚪' };
  }

  return { sma, ema, rsi, macd, atr, adx, analyze, btcHealth, stateOf, regime, demoKlines, clamp, orderBlocks,
           rsiSeries, harsi, harsiState, kernelReg, multiKernel, kernelSignals, kernelState, kernelList, KERNELS };
})();
