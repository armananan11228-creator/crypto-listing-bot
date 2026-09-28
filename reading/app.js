/* ═══════════════════════════════════════════════════════════════════
   📚 کتابخانه‌ی من — پیگیری مطالعه، پیشرفت و یادداشت‌برداری
   ✍️ طراحی و توسعه توسط آرمان ناصری
   ═══════════════════════════════════════════════════════════════════ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const load = (k, d) => { try { return JSON.parse(localStorage.getItem('rd_' + k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem('rd_' + k, JSON.stringify(v));

let books = load('books', []);
let notes = load('notes', []);
let sessions = load('sessions', []);
let CFG = { goal: 20, ...load('cfg', {}) };

let filter = 'all', noteFilter = 'all', query = '', noteQuery = '', openId = null;

const EMOJIS = ['📕', '📗', '📘', '📙', '📔', '📓', '🧠', '💼', '🔮', '⚔️', '🧪', '🪐'];
const COLORS = ['#7c3aed', '#a855f7', '#2563eb', '#059669', '#d97706', '#dc2626', '#0891b2', '#4b5563'];
const STATUS = {
  reading: { t: 'در حال خواندن', c: 'st-reading' },
  done: { t: 'تمام شد', c: 'st-done' },
  want: { t: 'می‌خواهم بخوانم', c: 'st-want' },
  drop: { t: 'رها کردم', c: 'st-drop' },
};
const NTYPE = {
  quote: { t: 'نقل‌قول', i: '❝' },
  idea: { t: 'ایده', i: '💡' },
  question: { t: 'سؤال', i: '❓' },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fa = n => (n || 0).toLocaleString('fa-IR');
const dayKey = t => new Date(t).toDateString();
const faDate = t => new Date(t).toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' });

/* ─────────── آمار پایه ─────────── */
function pagesOn(day) {
  return sessions.filter(s => dayKey(s.t) === day).reduce((a, s) => a + s.pages, 0);
}
function weekPages() {
  const from = Date.now() - 7 * 864e5;
  return sessions.filter(s => s.t >= from).reduce((a, s) => a + s.pages, 0);
}
/* روزهای پیاپی مطالعه — امروز یا دیروز شروع می‌شود تا نیمه‌شب رشته را نشکند */
function streak() {
  const days = new Set(sessions.map(s => dayKey(s.t)));
  let n = 0, d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderHeader() {
  $('#hReading').textContent = fa(books.filter(b => b.status === 'reading').length);
  $('#hDone').textContent = fa(books.filter(b => b.status === 'done').length);
  $('#hWeek').textContent = fa(weekPages()) + ' ص';
  const s = streak();
  $('#hStreak').textContent = s ? fa(s) + ' روز 🔥' : '—';
  $('#noteCount').textContent = fa(notes.length);
}

/* ─────────── کتاب‌ها ─────────── */
function pct(b) {
  if (!b.pages) return 0;
  return Math.min(100, Math.round(b.page / b.pages * 100));
}

function bookCard(b) {
  const p = pct(b), st = STATUS[b.status] || STATUS.want;
  const nn = notes.filter(n => n.bookId === b.id).length;
  return `<article class="card book" data-id="${b.id}">
    <div class="cover" style="background:linear-gradient(145deg,${b.color},#11091f)">${b.emoji}</div>
    <div class="bmeta">
      <h4>${esc(b.title)}</h4>
      <div class="au">${esc(b.author || '—')}</div>
      <div class="tags">
        <span class="tag ${st.c}">${st.t}</span>
        ${b.format ? `<span class="tag">${b.format}</span>` : ''}
        ${nn ? `<span class="tag">✍️ ${fa(nn)}</span>` : ''}
      </div>
      <div class="pbar"><i style="width:${p}%"></i></div>
      <div class="pnum"><span>${fa(b.page)} از ${fa(b.pages)} صفحه</span><b>${fa(p)}٪</b></div>
    </div>
  </article>`;
}

function renderBooks() {
  let list = books.slice();
  if (filter !== 'all') list = list.filter(b => b.status === filter);
  if (query) {
    const q = query.trim().toLowerCase();
    list = list.filter(b => (b.title + ' ' + (b.author || '')).toLowerCase().includes(q));
  }
  const rank = { reading: 0, want: 1, done: 2, drop: 3 };
  list.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.touched || 0) - (a.touched || 0));

  $('#bookGrid').innerHTML = list.map(bookCard).join('');
  $('#booksEmpty').hidden = list.length > 0;
  if (!list.length && books.length)
    $('#booksEmpty').textContent = 'کتابی با این فیلتر پیدا نشد.';
  $$('.book').forEach(el => el.onclick = () => openBook(el.dataset.id));
  renderHeader();
}

/* ─────────── کشو: فرم افزودن/ویرایش ─────────── */
function bookForm(b) {
  const isNew = !b;
  b = b || { emoji: '📘', color: COLORS[0], status: 'reading', format: 'کاغذی', pages: 200, page: 0 };
  $('#drTitle').textContent = isNew ? 'کتاب جدید' : 'ویرایش کتاب';
  $('#drSub').textContent = isNew ? 'اطلاعات پایه را وارد کن' : b.title;
  $('#drBody').innerHTML = `
    <div class="field"><label>عنوان کتاب *</label>
      <input id="f_title" value="${esc(b.title || '')}" placeholder="مثلاً: اثر مرکب"></div>
    <div class="field"><label>نویسنده</label>
      <input id="f_author" value="${esc(b.author || '')}" placeholder="مثلاً: دارن هاردی"></div>
    <div class="f2">
      <div class="field"><label>تعداد کل صفحات</label>
        <input type="number" id="f_pages" value="${b.pages || 200}" min="1"></div>
      <div class="field"><label>الان صفحه‌ی چندم؟</label>
        <input type="number" id="f_page" value="${b.page || 0}" min="0"></div>
    </div>
    <div class="f2">
      <div class="field"><label>وضعیت</label>
        <select id="f_status">${Object.entries(STATUS).map(([k, v]) =>
          `<option value="${k}" ${b.status === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select></div>
      <div class="field"><label>قالب</label>
        <select id="f_format">${['کاغذی', 'PDF', 'EPUB', 'TXT', 'صوتی'].map(f =>
          `<option ${b.format === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>دسته‌بندی</label>
      <input id="f_cat" value="${esc(b.cat || '')}" placeholder="مثلاً: مالی، روان‌شناسی، رمان"></div>
    <div class="field"><label>جلد</label>
      <div class="emojis" id="f_emoji">${EMOJIS.map(e =>
        `<button data-e="${e}" class="${b.emoji === e ? 'on' : ''}">${e}</button>`).join('')}</div></div>
    <div class="field"><label>رنگ جلد</label>
      <div class="colors" id="f_color">${COLORS.map(c =>
        `<button data-c="${c}" style="background:linear-gradient(145deg,${c},#11091f)"
          class="${b.color === c ? 'on' : ''}"></button>`).join('')}</div></div>
    <div class="btnrow">
      <button class="btn primary" id="f_save" style="flex:1">${isNew ? '➕ افزودن' : '💾 ذخیره'}</button>
      ${isNew ? '' : '<button class="btn danger" id="f_del">🗑 حذف</button>'}
    </div>`;

  let emoji = b.emoji, color = b.color;
  $$('#f_emoji button').forEach(x => x.onclick = () => {
    emoji = x.dataset.e;
    $$('#f_emoji button').forEach(y => y.classList.toggle('on', y === x));
  });
  $$('#f_color button').forEach(x => x.onclick = () => {
    color = x.dataset.c;
    $$('#f_color button').forEach(y => y.classList.toggle('on', y === x));
  });
  $('#f_save').onclick = () => {
    const title = $('#f_title').value.trim();
    if (!title) return alert('عنوان کتاب را وارد کن');
    const data = {
      title, author: $('#f_author').value.trim(),
      pages: Math.max(1, +$('#f_pages').value || 1),
      page: Math.max(0, +$('#f_page').value || 0),
      status: $('#f_status').value, format: $('#f_format').value,
      cat: $('#f_cat').value.trim(), emoji, color, touched: Date.now(),
    };
    if (isNew) books.push({ id: uid(), added: Date.now(), ...data });
    else Object.assign(books.find(x => x.id === b.id), data);
    save('books', books); renderBooks(); renderNotes(); renderStats();
    if (isNew) closeDrawer(); else openBook(b.id);
  };
  if (!isNew) $('#f_del').onclick = () => {
    if (!confirm(`«${b.title}» و همه‌ی یادداشت‌هایش حذف شود؟`)) return;
    books = books.filter(x => x.id !== b.id);
    notes = notes.filter(n => n.bookId !== b.id);
    sessions = sessions.filter(s => s.bookId !== b.id);
    save('books', books); save('notes', notes); save('sessions', sessions);
    closeDrawer(); renderBooks(); renderNotes(); renderStats();
  };
  openDrawer();
}

/* ─────────── کشو: صفحه‌ی کتاب ─────────── */
function openBook(id) {
  const b = books.find(x => x.id === id);
  if (!b) return;
  openId = id;
  const p = pct(b), st = STATUS[b.status] || STATUS.want;
  const my = notes.filter(n => n.bookId === id).sort((a, b2) => b2.t - a.t);
  const ss = sessions.filter(s => s.bookId === id);
  const total = ss.reduce((a, s) => a + s.pages, 0);
  const days = new Set(ss.map(s => dayKey(s.t))).size;
  const left = Math.max(0, b.pages - b.page);
  const rate = days ? total / days : 0;
  const eta = rate > 0 && left > 0 ? Math.ceil(left / rate) : null;

  $('#drTitle').textContent = b.emoji + ' ' + b.title;
  $('#drSub').textContent = `${b.author || '—'} · ${st.t}`;
  $('#drBody').innerHTML = `
    <div class="prog">
      <div class="pbar"><i style="width:${p}%"></i></div>
      <div class="pnum"><span>${fa(b.page)} از ${fa(b.pages)} صفحه</span><b>${fa(p)}٪</b></div>
      <div class="quick">
        <button class="btn sm" data-add="5">+۵ صفحه</button>
        <button class="btn sm" data-add="10">+۱۰</button>
        <button class="btn sm" data-add="20">+۲۰</button>
        <button class="btn sm" data-add="50">+۵۰</button>
        <input type="number" id="q_page" placeholder="صفحه‌ی فعلی" style="width:120px">
        <button class="btn sm" id="q_set">ثبت</button>
      </div>
      ${b.status !== 'done' ? '<button class="btn buy" id="q_done" style="width:100%;margin-top:9px">✅ تمامش کردم</button>' : ''}
    </div>

    <div class="prog">
      <div class="kv"><span>باقی‌مانده</span><b>${fa(left)} صفحه</b></div>
      <div class="kv"><span>روزهای مطالعه</span><b>${fa(days)} روز</b></div>
      <div class="kv"><span>میانگین روزانه</span><b>${fa(Math.round(rate))} صفحه</b></div>
      <div class="kv"><span>تخمین پایان</span><b>${eta ? `حدود ${fa(eta)} روز دیگر` : '—'}</b></div>
      ${b.cat ? `<div class="kv"><span>دسته</span><b>${esc(b.cat)}</b></div>` : ''}
    </div>

    <h3 style="font-size:15px;margin:16px 0 8px">✍️ یادداشت جدید</h3>
    <div class="field">
      <textarea id="n_text" rows="3" placeholder="جمله یا نقل‌قولی که می‌خواهی یادت بماند…"></textarea>
    </div>
    <div class="field">
      <textarea id="n_note" rows="2" placeholder="برداشت خودت (اختیاری)…"></textarea>
    </div>
    <div class="f2">
      <div class="field"><label>نوع</label>
        <select id="n_type">${Object.entries(NTYPE).map(([k, v]) =>
          `<option value="${k}">${v.i} ${v.t}</option>`).join('')}</select></div>
      <div class="field"><label>صفحه</label>
        <input type="number" id="n_page" value="${b.page}"></div>
    </div>
    <button class="btn primary" id="n_save" style="width:100%">💾 ذخیره‌ی یادداشت</button>

    <h3 style="font-size:15px;margin:18px 0 8px">📝 یادداشت‌های این کتاب (${fa(my.length)})</h3>
    <div id="bookNotes">${my.map(noteCard).join('') || '<p class="muted">هنوز یادداشتی نداری.</p>'}</div>

    <button class="btn" id="b_edit" style="width:100%;margin-top:16px">✏️ ویرایش اطلاعات کتاب</button>`;

  $$('[data-add]').forEach(x => x.onclick = () => addPages(id, +x.dataset.add));
  $('#q_set').onclick = () => {
    const v = +$('#q_page').value;
    if (!(v >= 0)) return;
    const diff = v - b.page;
    if (diff > 0) logSession(id, diff);
    b.page = Math.min(v, b.pages); b.touched = Date.now();
    if (b.page >= b.pages) b.status = 'done';
    save('books', books); renderBooks(); renderStats(); openBook(id);
  };
  if ($('#q_done')) $('#q_done').onclick = () => {
    const diff = b.pages - b.page;
    if (diff > 0) logSession(id, diff);
    b.page = b.pages; b.status = 'done'; b.finished = Date.now(); b.touched = Date.now();
    save('books', books); renderBooks(); renderStats(); openBook(id);
  };
  $('#n_save').onclick = () => {
    const text = $('#n_text').value.trim();
    if (!text) return alert('متن یادداشت خالی است');
    notes.unshift({
      id: uid(), bookId: id, t: Date.now(), text,
      note: $('#n_note').value.trim(), type: $('#n_type').value,
      page: +$('#n_page').value || 0, fav: false,
    });
    save('notes', notes); renderNotes(); openBook(id);
  };
  $('#b_edit').onclick = () => bookForm(b);
  bindNoteActions();
  openDrawer();
}

function addPages(id, n) {
  const b = books.find(x => x.id === id);
  if (!b) return;
  const inc = Math.min(n, b.pages - b.page);
  if (inc <= 0) return;
  b.page += inc; b.touched = Date.now();
  if (b.page >= b.pages) { b.status = 'done'; b.finished = Date.now(); }
  logSession(id, inc);
  save('books', books);
  renderBooks(); renderStats(); openBook(id);
}

function logSession(bookId, pages) {
  sessions.push({ id: uid(), bookId, t: Date.now(), pages });
  save('sessions', sessions);
}

/* ─────────── یادداشت‌ها ─────────── */
function noteCard(n) {
  const b = books.find(x => x.id === n.bookId);
  const ty = NTYPE[n.type] || NTYPE.quote;
  return `<div class="note t-${n.type}" data-nid="${n.id}">
    <p class="q">${esc(n.text)}</p>
    ${n.note ? `<div class="cm">🧠 ${esc(n.note)}</div>` : ''}
    <div class="nfoot">
      <span>${ty.i} ${ty.t}</span>
      ${b ? `<span>${b.emoji} ${esc(b.title)}</span>` : ''}
      ${n.page ? `<span>ص ${fa(n.page)}</span>` : ''}
      <span>${faDate(n.t)}</span>
      <span class="sp"></span>
      <button class="star" data-fav="${n.id}" title="نشان‌کردن">${n.fav ? '⭐' : '☆'}</button>
      <button class="btn sm" data-copy="${n.id}">کپی</button>
      <button class="btn sm" data-ndel="${n.id}">حذف</button>
    </div>
  </div>`;
}

function bindNoteActions() {
  $$('[data-fav]').forEach(x => x.onclick = e => {
    e.stopPropagation();
    const n = notes.find(v => v.id === x.dataset.fav);
    n.fav = !n.fav; save('notes', notes);
    renderNotes(); if (openId) openBook(openId);
  });
  $$('[data-copy]').forEach(x => x.onclick = e => {
    e.stopPropagation();
    const n = notes.find(v => v.id === x.dataset.copy);
    const b = books.find(v => v.id === n.bookId);
    const txt = `«${n.text}»${n.note ? `\n— ${n.note}` : ''}\n📖 ${b ? b.title : ''}${n.page ? ` · ص ${n.page}` : ''}`;
    navigator.clipboard?.writeText(txt);
    x.textContent = '✓ کپی شد';
    setTimeout(() => { x.textContent = 'کپی'; }, 1400);
  });
  $$('[data-ndel]').forEach(x => x.onclick = e => {
    e.stopPropagation();
    if (!confirm('این یادداشت حذف شود؟')) return;
    notes = notes.filter(v => v.id !== x.dataset.ndel);
    save('notes', notes); renderNotes(); if (openId) openBook(openId);
  });
}

function renderNotes() {
  let list = notes.slice();
  if (noteFilter === 'fav') list = list.filter(n => n.fav);
  else if (noteFilter !== 'all') list = list.filter(n => n.type === noteFilter);
  if (noteQuery) {
    const q = noteQuery.trim().toLowerCase();
    list = list.filter(n => {
      const b = books.find(x => x.id === n.bookId);
      return (n.text + ' ' + (n.note || '') + ' ' + (b ? b.title : '')).toLowerCase().includes(q);
    });
  }
  $('#noteList').innerHTML = list.map(noteCard).join('');
  $('#notesEmpty').hidden = list.length > 0;
  if (!list.length && notes.length) $('#notesEmpty').textContent = 'یادداشتی با این فیلتر پیدا نشد.';
  bindNoteActions();
  renderHeader();
}

/* ─────────── آمار ─────────── */
function renderStats() {
  const done = books.filter(b => b.status === 'done');
  const totalPages = sessions.reduce((a, s) => a + s.pages, 0);
  const today = pagesOn(new Date().toDateString());
  const days = new Set(sessions.map(s => dayKey(s.t))).size;
  const avg = days ? Math.round(totalPages / days) : 0;

  $('#statCards').innerHTML = `<div class="scgrid">
    <div><span>کل کتاب‌ها</span><b>${fa(books.length)}</b></div>
    <div><span>تمام‌شده</span><b class="up">${fa(done.length)}</b></div>
    <div><span>امروز</span><b class="${today >= CFG.goal ? 'up' : ''}">${fa(today)}</b></div>
    <div><span>هدف روزانه</span><b>${fa(CFG.goal)}</b></div>
    <div><span>این هفته</span><b>${fa(weekPages())}</b></div>
    <div><span>کل صفحات</span><b>${fa(totalPages)}</b></div>
    <div><span>میانگین روزانه</span><b>${fa(avg)}</b></div>
    <div><span>روزهای پیاپی</span><b class="${streak() ? 'up' : ''}">${fa(streak())} 🔥</b></div>
  </div>`;

  // نمودار ۳۰ روز
  const arr = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    arr.push({ d, v: pagesOn(d.toDateString()) });
  }
  const max = Math.max(CFG.goal, ...arr.map(x => x.v)) || 1;
  $('#chart30').innerHTML = `
    <div class="bars">${arr.map(x => `<i class="${x.v === 0 ? 'zero' : x.v >= CFG.goal ? 'goal' : ''}"
      style="height:${Math.max(2, x.v / max * 100)}%"
      title="${x.d.toLocaleDateString('fa-IR')} — ${fa(x.v)} صفحه"></i>`).join('')}</div>
    <div class="barlbl"><span>${faDate(arr[0].d)}</span>
      <span>سبز = به هدف رسیدی</span><span>امروز</span></div>`;

  // پرخوانده‌ترین‌ها
  const by = {};
  sessions.forEach(s => { by[s.bookId] = (by[s.bookId] || 0) + s.pages; });
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mx = top.length ? top[0][1] : 1;
  $('#topBooks').innerHTML = top.length ? top.map(([id, v]) => {
    const b = books.find(x => x.id === id);
    if (!b) return '';
    return `<div class="toprow"><span>${b.emoji}</span>
      <span style="min-width:90px;font-size:13px">${esc(b.title)}</span>
      <div class="pbar"><i style="width:${v / mx * 100}%"></i></div>
      <b style="font-size:13px">${fa(v)} ص</b></div>`;
  }).join('') : '<p class="muted">هنوز صفحه‌ای ثبت نشده.</p>';
}

/* ─────────── کشو و تب ─────────── */
function openDrawer() { $('#drawer').classList.add('on'); $('#scrim').classList.add('on'); }
function closeDrawer() {
  $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); openId = null;
}
function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'page-' + name));
  if (name === 'stats') renderStats();
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ─────────── راه‌اندازی ─────────── */
function init() {
  $$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
  $('#addBook').onclick = () => bookForm(null);
  $('#drClose').onclick = closeDrawer;
  $('#scrim').onclick = closeDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  $$('#statusSeg button').forEach(b => b.onclick = () => {
    $$('#statusSeg button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); filter = b.dataset.s; renderBooks();
  });
  $$('#noteSeg button').forEach(b => b.onclick = () => {
    $$('#noteSeg button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); noteFilter = b.dataset.t; renderNotes();
  });
  $('#search').oninput = e => { query = e.target.value; renderBooks(); };
  $('#noteSearch').oninput = e => { noteQuery = e.target.value; renderNotes(); };

  $('#s_goal').value = CFG.goal;
  $('#s_goal').onchange = e => {
    CFG.goal = Math.max(1, +e.target.value || 20); save('cfg', CFG); renderStats();
  };

  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ books, notes, sessions, cfg: CFG }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-library-backup.json';
    a.click();
  };
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (d.books) books = d.books;
        if (d.notes) notes = d.notes;
        if (d.sessions) sessions = d.sessions;
        if (d.cfg) CFG = { ...CFG, ...d.cfg };
        save('books', books); save('notes', notes); save('sessions', sessions); save('cfg', CFG);
        renderBooks(); renderNotes(); renderStats();
        alert('✅ بازگردانی انجام شد');
      } catch { alert('❌ فایل معتبر نیست'); }
    };
    rd.readAsText(f);
  };
  $('#resetBtn').onclick = () => {
    if (!confirm('همه‌ی کتاب‌ها، یادداشت‌ها و آمار پاک شود؟ این کار برگشت‌پذیر نیست.')) return;
    books = []; notes = []; sessions = [];
    save('books', books); save('notes', notes); save('sessions', sessions);
    renderBooks(); renderNotes(); renderStats();
  };

  renderBooks(); renderNotes(); renderStats();
}
document.addEventListener('DOMContentLoaded', init);
