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

    return {
      score: clamp(raw * 10, 0, 100),
      price, rsi: r, atr: a, atrPct: atrP, volChg: vChg, volRatio: vRat,
      adx: ax, ema20: e20, ema50: e50, ema200: e200, pos,
      tp1: price + a * cfg.tp1,
      tp2: price + a * cfg.tp2,
      sl: Math.min(price - a * cfg.sl, lo10 * 0.998),
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

  function stateOf(score, rsiV, btcOk, cfg) {
    if (score <= 0) return { t: '—', c: 'mu' };
    if (score >= cfg.minScore && rsiV <= cfg.maxRsi && btcOk) return { t: '🟢 بخر', c: 'up' };
    if (score >= cfg.minScore && rsiV > cfg.maxRsi) return { t: '⚠️ داغ / صبر', c: 'wa' };
    if (score >= cfg.minScore && !btcOk) return { t: '🟡 بازار ضعیف', c: 'wa' };
    if (score >= cfg.minScore * .85) return { t: '⏳ نزدیک است', c: 'wa' };
    if (score >= cfg.minScore * .6) return { t: '😐 ضعیف', c: 'mu' };
    return { t: '🚫 نخر', c: 'dn' };
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

  return { sma, ema, rsi, macd, atr, adx, analyze, btcHealth, stateOf, demoKlines, clamp, orderBlocks,
           rsiSeries, harsi, harsiState };
})();
