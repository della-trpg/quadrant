// 앱 시작, 로그인·코드 확인, 화면 이동, 목록·보기 화면
import { CONFIG } from '../config.js';
import { createApi } from './api.js';
import { h, icon, toast, confirmDialog, fmtDate, lsGet, lsSet, charMeta } from './util.js';
import { clearMeasureCache, normalizeDoc, VIEWS, VIEW_LABEL, FONT, SERIF, T } from './layout.js';
import { BoardView } from './board.js';
import { renderThumb, THEMES } from './render.js';
import { getTheme, setTheme } from './theme.js';
import { openExportModal } from './export_modal.js';
import { mountEditor } from './editor.js';

const app = {
  api: null, profile: null,
  worlds: [], world: null,             // 들어갈 수 있는 세계관들 / 지금 보는 세계관
  chars: new Map(), charList: [],      // 지금 세계관의 캐릭터
  charCache: new Map(),                // 세계관 ID -> { list, map }
  cleanup: null, leaveGuard: null, rerender: null,
};
const WORLD_KEY = 'quadrant:last-world';
const rootEl = document.getElementById('app');
const headerEl = document.getElementById('site-header');

// ---------------------------------------------------------------- 시작
boot();

async function boot() {
  showLoading('불러오는 중…');
  await loadFonts();
  app.api = createApi();
  try {
    await app.api.init();
  } catch (e) {
    showError(e.message || '시작하지 못했어요.', () => location.reload());
    return;
  }
  app.api.onAuthChange(() => refreshSession());
  window.addEventListener('hashchange', () => route());
  await refreshSession();
}

async function loadFonts() {
  if (!document.fonts) return;
  const specs = [`400 ${T.descSize}px "IBM Plex Sans KR"`, `500 ${T.nameSize}px "IBM Plex Sans KR"`, `600 ${T.nameSize}px "IBM Plex Sans KR"`, '600 42px "Noto Serif KR"'];
  await Promise.race([
    Promise.all(specs.map((s) => document.fonts.load(s, '가나다ABC123').catch(() => null))),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  clearMeasureCache();
  // 한글 웹폰트는 글자 묶음별로 나중에 내려와요. 새로 내려오면 글자 너비를 다시 재고 다시 그림.
  let t = null;
  document.fonts.addEventListener?.('loadingdone', () => {
    clearTimeout(t);
    t = setTimeout(() => { clearMeasureCache(); app.rerender?.(); }, 60);
  });
}

async function refreshSession() {
  try {
    showLoading('불러오는 중…');
    app.profile = null; app.worlds = []; app.world = null;
    app.chars = new Map(); app.charList = []; app.charCache = new Map();
    if (app.api.user) {
      app.profile = await app.api.getProfile();
      if (app.profile?.nickname) app.worlds = await app.api.listWorlds();
    }
    if (app.worlds.length) await selectWorld(pickWorld());
    renderHeader();
    await route();
  } catch (e) {
    renderHeader();
    showError(e.message || '불러오지 못했어요.', () => refreshSession());
  }
}

// 처음 열 세계관: 마지막으로 본 곳 → config의 기본값 → 목록의 첫 번째
function pickWorld() {
  const ids = app.worlds.map((w) => w.id);
  const last = lsGet(WORLD_KEY);
  if (ids.includes(last)) return last;
  if (ids.includes(CONFIG.WORLD_ID)) return CONFIG.WORLD_ID;
  return ids[0];
}

async function selectWorld(id) {
  const w = app.worlds.find((x) => x.id === id);
  if (!w) return false;
  if (app.world?.id === id && app.charCache.has(id)) return true;
  if (!app.charCache.has(id)) app.charCache.set(id, await loadCharacters(id));
  const c = app.charCache.get(id);
  app.world = w;
  app.charList = c.list;
  app.chars = c.map;
  lsSet(WORLD_KEY, id);
  renderHeader();
  return true;
}

async function loadCharacters(worldId) {
  const list = await app.api.listCharacters(worldId);
  await Promise.all(list.map((c) => new Promise((resolve) => {
    if (!c.url) return resolve();
    const img = new Image();
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 8000);
    img.onload = done;
    img.onerror = () => { c.url = null; done(); };
    img.src = c.url;
    c.img = img;
  })));
  return { list, map: new Map(list.map((c) => [c.id, c])) };
}

// ---------------------------------------------------------------- 머리말
function renderHeader() {
  const right = [];
  const themeSel = h('select', { class: 'select select-sm theme-select', 'aria-label': '화면 테마', title: '화면 테마',
    onchange: (e) => setTheme(e.target.value) },
    ...Object.entries(THEMES).map(([k, t]) => h('option', { value: k }, t.label)));
  themeSel.value = getTheme();
  right.push(themeSel);
  if (app.api?.demo) right.push(h('span', { class: 'badge badge-demo', title: '서버 없이 이 브라우저에만 저장돼요' }, '데모 모드'));
  if (app.api?.user && app.profile?.nickname) right.push(h('span', { class: 'header-nick' }, app.profile.nickname));
  if (app.api?.user && !app.api.demo) right.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { await app.api.signOut(); refreshSession(); } }, '로그아웃'));
  headerEl.replaceChildren(
    h('div', { class: 'header-left' },
      h('a', { class: 'brand', href: '#/', 'aria-label': '캐릭터 사분면 목록' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
        h('span', { class: 'brand-name' }, '캐릭터 사분면')),
      app.world ? h('a', { class: 'world-chip', href: '#/worlds', title: '세계관 바꾸기·코드 입력' },
        h('span', { class: 'world-chip-name' }, app.world.name), icon('chevron', 14)) : null),
    h('div', { class: 'header-right' }, ...right));
}

// ---------------------------------------------------------------- 이동
async function navigate(hash, { replace = false } = {}) {
  if (app.leaveGuard && !(await app.leaveGuard())) return;
  app.leaveGuard = null;
  if (replace) { history.replaceState(null, '', location.pathname + location.search + hash); route(); }
  else if (location.hash === hash) route();
  else location.hash = hash;
}
const setLeaveGuard = (fn) => { app.leaveGuard = fn; };

let routeToken = 0;
async function route() {
  const token = ++routeToken;
  if (app.cleanup) { try { app.cleanup(); } catch { /* ignore */ } app.cleanup = null; }
  app.leaveGuard = null;
  app.rerender = null;
  window.scrollTo(0, 0);

  if (!app.api.user) return renderLogin();
  if (!app.profile?.nickname) return renderNickname();

  const raw = (location.hash || '#/').slice(1);
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);

  if (parts[0] === 'code' || !app.worlds.length) return renderCode();
  try {
    if (parts[0] === 'worlds') return renderWorldPicker();
    if (parts[0] === 'w' && parts[1]) {
      showLoading('세계관을 여는 중…');
      const ok = await selectWorld(parts[1]);
      if (!ok) toast('들어갈 수 없는 세계관이에요.', 'error');
      return navigate('#/', { replace: true });
    }
    // 다른 세계관의 사분면 링크로 들어오면 그 세계관으로 자동 전환
    const qid = (parts[0] === 'edit' || parts[0] === 'view') ? parts[1] : (parts[0] === 'new' ? params.get('from') : null);
    if (qid) {
      const row = await app.api.getQuadrant(qid);
      if (token !== routeToken) return;
      if (row && row.world_id !== app.world?.id) { showLoading('세계관을 여는 중…'); await selectWorld(row.world_id); }
    }
  } catch (e) {
    if (token === routeToken) showError(e.message || '불러오지 못했어요.', () => route());
    return;
  }

  const ctx = { api: app.api, world: app.world, chars: app.chars, charList: app.charList, profile: app.profile, root: rootEl, navigate, setLeaveGuard,
    setRerender: (fn) => { if (token === routeToken) app.rerender = fn; } };
  try {
    if (!parts.length || parts[0] === 'mine') return await renderGallery(parts[0] === 'mine' ? 'mine' : 'all', token);
    if (parts[0] === 'new') {
      showLoading('편집 화면을 여는 중…');
      const c = await mountEditor(ctx, { fromId: params.get('from') });
      if (token === routeToken) app.cleanup = c; else c?.();
      return;
    }
    if (parts[0] === 'edit' && parts[1]) {
      showLoading('편집 화면을 여는 중…');
      const c = await mountEditor(ctx, { id: parts[1] });
      if (token === routeToken) app.cleanup = c; else c?.();
      return;
    }
    if (parts[0] === 'view' && parts[1]) return await renderView(parts[1], token);
    navigate('#/', { replace: true });
  } catch (e) {
    if (token === routeToken) showError(e.message || '불러오지 못했어요.', () => route());
  }
}

// ---------------------------------------------------------------- 들어가기 전 단계
function gateCard(...children) {
  rootEl.replaceChildren(h('div', { class: 'gate' }, h('div', { class: 'gate-card' }, ...children)));
}

function renderLogin() {
  const msg = h('p', { class: 'error small', role: 'alert', hidden: true });
  const btnHost = h('div', { class: 'gbtn' });
  const redirectBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: async () => {
    try { await app.api.signInWithGoogleRedirect(); if (app.api.demo) refreshSession(); }
    catch (e) { msg.hidden = false; msg.textContent = e.message; }
  } }, '구글로 로그인');
  const alt = h('button', { class: 'btn-link small', type: 'button', hidden: true, onclick: () => redirectBtn.click() }, '버튼이 안 보이면: 다른 방식으로 로그인');
  gateCard(
    h('h1', { class: 'gate-title' }, '캐릭터 사분면'),
    h('p', { class: 'muted' }, '초대받은 사람만 볼 수 있는 공간이에요. 로그인한 뒤 받은 코드를 입력해 주세요.'),
    btnHost, alt, msg,
    h('p', { class: 'muted small' }, '카드 공모 사이트에서 로그인했다면 같은 계정으로 자동 로그인돼요.'));
  app.api.renderGoogleButton(btnHost, (m) => { msg.hidden = false; msg.textContent = m; })
    .then((ok) => { if (ok) alt.hidden = false; else btnHost.replaceChildren(redirectBtn); })
    .catch(() => btnHost.replaceChildren(redirectBtn));
}

function renderNickname() {
  const input = h('input', { class: 'input', type: 'text', maxlength: '20', placeholder: '닉네임 (1~20자)', 'aria-label': '닉네임' });
  const msg = h('p', { class: 'error small', role: 'alert', hidden: true });
  const submit = async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) { msg.hidden = false; msg.textContent = '닉네임을 입력해 주세요.'; return; }
    try { await app.api.setNickname(v); await refreshSession(); }
    catch (err) { msg.hidden = false; msg.textContent = err.message; }
  };
  gateCard(
    h('h1', { class: 'gate-title' }, '닉네임 정하기'),
    h('p', { class: 'muted' }, '사분면에 만든 사람으로 표시돼요. 실명이나 이메일은 표시되지 않아요. 카드 공모 사이트와 같은 닉네임을 써요.'),
    h('form', { class: 'gate-form', onsubmit: submit }, input, h('button', { class: 'btn btn-primary', type: 'submit' }, '저장')),
    msg);
  input.focus();
}

function renderCode() {
  const input = h('input', { class: 'input code-input', type: 'text', maxlength: '24', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'XXXX-XXXX-XXXX', 'aria-label': '초대 코드' });
  const msg = h('p', { class: 'error small', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, '확인');
  const reasons = {
    invalid: '코드가 맞지 않아요. 다시 확인해 주세요.',
    used: '이미 사용된 코드예요.',
    too_many: '시도가 너무 많아요. 10분 뒤에 다시 시도해 주세요.',
    login: '로그인이 필요해요.',
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    btn.disabled = true;
    try {
      const r = await app.api.redeemCode(input.value);
      if (r.ok) {
        app.worlds = await app.api.listWorlds();
        await selectWorld(r.world_id);
        toast(r.already ? `이미 들어갈 수 있는 세계관이에요: ${app.world?.name || ''}` : `${app.world?.name || '세계관'}에 입장했어요!`);
        navigate('#/', { replace: true });
        return;
      }
      msg.hidden = false; msg.textContent = reasons[r.reason] || reasons.invalid;
    } catch (err) { msg.hidden = false; msg.textContent = err.message; }
    finally { btn.disabled = false; }
  };
  const hasAny = app.worlds.length > 0;
  gateCard(
    hasAny ? h('a', { class: 'back-link', href: '#/worlds' }, icon('back', 16), '세계관 목록') : null,
    h('h1', { class: 'gate-title' }, hasAny ? '다른 세계관 코드 입력' : '초대 코드 입력'),
    h('p', { class: 'muted' }, '받은 코드를 입력하면 그 세계관의 캐릭터와 사분면을 볼 수 있어요. 코드는 한 번만 쓸 수 있고, 처음 입력한 계정에 묶여요.'),
    h('form', { class: 'gate-form', onsubmit: submit }, input, btn),
    msg,
    app.api.demo ? h('p', { class: 'muted small' }, '데모 코드: DEMO-CODE-0000 (첫 번째 세계관), DEMO-CODE-0002 (두 번째 세계관)') : null);
  input.focus();
}

// ---------------------------------------------------------------- 세계관 고르기
function renderWorldPicker() {
  const card = (w) => {
    const current = w.id === app.world?.id;
    return h('a', { class: 'world-card' + (current ? ' current' : ''), href: `#/w/${encodeURIComponent(w.id)}`, 'aria-current': current ? 'true' : null },
      h('span', { class: 'world-card-name' }, w.name),
      h('span', { class: 'muted small' }, current ? '지금 보는 중' : '이 세계관으로 가기'));
  };
  rootEl.replaceChildren(h('div', { class: 'page page-narrow' },
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', { class: 'page-title' }, '세계관'),
        h('p', { class: 'muted' }, app.profile?.isAdmin ? '관리자라서 모든 세계관이 보여요.' : '코드를 입력한 세계관만 보여요.'))),
    h('div', { class: 'world-grid' },
      ...app.worlds.map(card),
      h('a', { class: 'world-card world-card-add', href: '#/code' },
        h('span', { class: 'world-card-name' }, icon('plus', 16), '코드로 세계관 추가'),
        h('span', { class: 'muted small' }, '새로 받은 초대 코드 입력')))));
}

// ---------------------------------------------------------------- 목록
async function renderGallery(tab, token) {
  const grid = h('div', { class: 'q-grid' });
  const more = h('button', { class: 'btn', type: 'button', hidden: true }, '더 보기');
  const empty = h('div', { class: 'empty-state', hidden: true });
  const tabBtn = (key, label, hash) => h('a', { class: 'tab' + (tab === key ? ' on' : ''), href: hash, 'aria-current': tab === key ? 'page' : null }, label);
  rootEl.replaceChildren(h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', { class: 'page-title' }, '캐릭터 사분면'),
        h('p', { class: 'muted' }, `${app.world.name}의 캐릭터들을 두 개의 축 위에 놓아 보세요.`)),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => navigate('#/new') }, icon('plus'), '새 사분면')),
    h('nav', { class: 'tabs', 'aria-label': '목록 종류' }, tabBtn('all', '모두의 사분면', '#/'), tabBtn('mine', '내 사분면', '#/mine')),
    grid, empty, h('div', { class: 'center' }, more)));

  let from = 0;
  const limit = 24;
  const load = async () => {
    more.disabled = true;
    const rows = await app.api.listQuadrants({ world: app.world.id, scope: tab, from, limit });
    if (token !== routeToken) return;
    for (const r of rows) grid.append(card(r));
    from += rows.length;
    more.hidden = rows.length < limit;
    more.disabled = false;
    if (!from) {
      empty.hidden = false;
      empty.replaceChildren(
        h('h2', null, tab === 'mine' ? '아직 만든 사분면이 없어요' : '아직 공개된 사분면이 없어요'),
        h('p', { class: 'muted' }, '첫 사분면을 만들어 보세요.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => navigate('#/new') }, '새 사분면'));
    }
  };
  more.onclick = () => load().catch((e) => toast(e.message, 'error'));
  await load();
}

// 목록 썸네일은 캔버스라서 테마를 바꾸면 다시 그려야 함
const thumbDocs = new WeakMap();
function drawThumb(box) {
  const doc = thumbDocs.get(box);
  if (!doc) return;
  try { box.replaceChildren(renderThumb({ doc, chars: app.chars, size: 280, theme: getTheme() })); } catch { /* ignore */ }
}
window.addEventListener('quadrant-theme', () => {
  for (const box of document.querySelectorAll('.q-thumb')) drawThumb(box);
  const sel = headerEl.querySelector('.theme-select');
  if (sel) sel.value = getTheme();
});

function card(r) {
  const doc = normalizeDoc(r.data);
  const thumbBox = h('div', { class: 'q-thumb' });
  thumbDocs.set(thumbBox, doc);
  drawThumb(thumbBox);
  const mine = r.owner_id === app.api.user?.id;
  return h('a', { class: 'q-card', href: `#/view/${r.id}` },
    thumbBox,
    h('div', { class: 'q-meta' },
      h('strong', { class: 'q-title' }, r.title || '제목 없음'),
      h('span', { class: 'muted small' }, `${r.author || ''} · ${fmtDate(r.updated_at)}`),
      h('span', { class: 'q-badges' },
        r.visibility === 'draft' ? h('span', { class: 'badge' }, '초안') : null,
        mine ? h('span', { class: 'badge badge-mine' }, '내 것') : null,
        h('span', { class: 'badge badge-ghost' }, `${doc.items.length}명`))));
}

// ---------------------------------------------------------------- 보기
async function renderView(id, token) {
  showLoading('불러오는 중…');
  const row = await app.api.getQuadrant(id);
  if (token !== routeToken) return;
  if (!row) {
    rootEl.replaceChildren(h('div', { class: 'empty-state' },
      h('h2', null, '사분면을 찾을 수 없어요'), h('p', { class: 'muted' }, '삭제됐거나, 볼 수 있는 권한이 없어요.'),
      h('button', { class: 'btn', type: 'button', onclick: () => navigate('#/') }, '목록으로')));
    return;
  }
  const doc = normalizeDoc(row.data);
  let view = row.default_view;
  const isOwner = row.owner_id === app.api.user?.id;
  const canDelete = isOwner || app.profile?.isAdmin;

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '보기' },
    ...VIEWS.map((v) => h('button', { type: 'button', dataset: { v }, onclick: () => { view = v; paint(); board.set({ view }); } }, VIEW_LABEL[v])));
  const paint = () => { for (const b of seg.children) { const on = b.dataset.v === view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); } };
  const zoomSeg = h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': '확대' },
    ...[[1, '맞춤'], [1.5, '150%'], [2, '200%']].map(([z, t]) => h('button', { type: 'button', dataset: { v: String(z) }, onclick: () => {
      board.setZoom(z);
      for (const b of zoomSeg.children) { const on = b.dataset.v === String(z); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    } }, t)));
  zoomSeg.firstChild.classList.add('on');
  const info = h('div', { class: 'view-info', 'aria-live': 'polite' });
  const host = h('div', { class: 'view-board' });

  const actions = [
    seg, zoomSeg,
    h('button', { class: 'btn', type: 'button', onclick: () => openExportModal({ doc, chars: app.chars, view, title: row.title, author: row.author, prefs: doc.export }) }, icon('download'), '이미지로 내보내기'),
    h('button', { class: 'btn', type: 'button', onclick: () => navigate(`#/new?from=${row.id}`) }, icon('copy'), '복제해서 내 버전'),
    isOwner ? h('button', { class: 'btn', type: 'button', onclick: () => navigate(`#/edit/${row.id}`) }, icon('edit'), '편집') : null,
    canDelete ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
      const ok = await confirmDialog({ title: '이 사분면을 삭제할까요?', body: isOwner ? '삭제하면 되돌릴 수 없어요.' : '관리자 권한으로 다른 사람의 사분면을 삭제해요. 되돌릴 수 없어요.', ok: '삭제', danger: true });
      if (!ok) return;
      try { await app.api.deleteQuadrant(row.id); toast('삭제했어요.'); navigate('#/'); }
      catch (e) { toast(e.message, 'error'); }
    } }, icon('trash'), '삭제') : null,
  ];

  rootEl.replaceChildren(h('div', { class: 'page page-view' },
    h('a', { class: 'back-link', href: '#/' }, icon('back', 16), '목록'),
    h('div', { class: 'view-head' },
      h('h1', { class: 'page-title serif' }, row.title || '제목 없음'),
      h('p', { class: 'muted' }, `by ${row.author || ''} · ${fmtDate(row.updated_at)}`, row.visibility === 'draft' ? h('span', { class: 'badge' }, '초안') : null)),
    h('div', { class: 'view-actions' }, ...actions),
    host, info));

  const showInfo = (cid) => {
    const it = cid && doc.items.find((i) => i.c === cid);
    const ch = cid && app.chars.get(cid);
    if (!it || !ch) { info.replaceChildren(); return; }
    info.replaceChildren(...[h('strong', null, ch.name), charMeta(ch) ? h('span', { class: 'muted small' }, ` · ${charMeta(ch)}`) : null,
      it.desc ? h('p', null, it.desc) : h('p', { class: 'muted small' }, '설명 없음')].filter(Boolean));
  };
  const board = new BoardView(host, { editable: false, fitHeight: () => !window.matchMedia('(max-width: 860px)').matches, onSelect: (cid) => { board.set({ selected: cid }); showInfo(cid); } });
  board.set({ doc, chars: app.chars, view, showGrid: false });
  board.fit();
  paint();
  app.rerender = () => board.render();
  app.cleanup = () => board.destroy();
}

// ---------------------------------------------------------------- 공용
function showLoading(text) {
  rootEl.replaceChildren(h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text));
}
function showError(text, retry) {
  rootEl.replaceChildren(h('div', { class: 'empty-state' },
    h('h2', null, '문제가 생겼어요'), h('p', { class: 'muted' }, text),
    retry ? h('button', { class: 'btn', type: 'button', onclick: retry }, '다시 시도') : null));
}

export { FONT, SERIF };
