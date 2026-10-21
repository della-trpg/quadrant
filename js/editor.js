// 사분면 편집 화면
import { h, icon, clamp, debounce, lsGet, lsSet, lsDel, toast, confirmDialog, colorFor, initialOf, charMeta } from './util.js';
import { VIEWS, VIEW_LABEL, DIR_LABEL, CAPTION_VIEWS, SIZE_MIN, SIZE_MAX, ICON_MIN, ICON_MAX, TEXT_RANGE, TEXT_DEFAULT, VALIGN_DIRS, dims, gridSteps, emptyDoc, normalizeDoc, compactDoc } from './layout.js';
import { BoardView } from './board.js';
import { openExportModal } from './export_modal.js';
import { getTheme } from './theme.js';

// 입력칸 순서: 첫 줄 위/아래, 둘째 줄 오른쪽/왼쪽
const AXES = [['top', '위쪽 끝'], ['bottom', '아래쪽 끝'], ['right', '오른쪽 끝'], ['left', '왼쪽 끝']];
const DIR_GRID = [['tl', '↖'], ['t', '↑'], ['tr', '↗'], ['l', '←'], ['auto', '자동'], ['r', '→'], ['bl', '↙'], ['b', '↓'], ['br', '↘']];
const ALIGN_OPTS = [['auto', '자동'], ['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']];
const VALIGN_OPTS = [['auto', '자동'], ['top', '위'], ['middle', '가운데'], ['bottom', '아래']];
const isMobile = () => window.matchMedia('(max-width: 860px)').matches;
// 넓은 화면: 선택한 캐릭터 패널을 사이드바로 따로 띄움 (캐릭터 일람 바로 왼쪽)
const WIDE_MQ = '(min-width: 1280px)';
const SPLIT_KEY = 'quadrant:split-sidebar';

class History {
  constructor(snap, restore) { this.snap = snap; this.restore = restore; this.u = []; this.r = []; this.key = null; this.t = 0; }
  checkpoint(key) {
    const now = Date.now();
    if (key && key === this.key && now - this.t < 1200) { this.t = now; return; }
    this.u.push(this.snap());
    if (this.u.length > 100) this.u.shift();
    this.r = [];
    this.key = key || null;
    this.t = now;
  }
  undo() { if (!this.u.length) return false; this.r.push(this.snap()); this.restore(this.u.pop()); this.key = null; return true; }
  redo() { if (!this.r.length) return false; this.u.push(this.snap()); this.restore(this.r.pop()); this.key = null; return true; }
}

export async function mountEditor(ctx, { id, fromId }) {
  const { api, world, chars, charList, profile, root, navigate, setLeaveGuard } = ctx;

  // ---------- 불러오기 ----------
  let quadId = null, serverUpdatedAt = null;
  const st = { doc: emptyDoc(), title: '', visibility: 'public', view: 'name', selected: null, placing: null,
    zoom: 1, dirty: false, saving: false, sideTab: 'roster', sheetOpen: true,
    filter: { q: '', org: '', career: '', unplaced: false } };

  if (id) {
    const row = await api.getQuadrant(id);
    if (!row) { root.replaceChildren(notFound(navigate)); return () => {}; }
    if (row.owner_id !== api.user?.id) { navigate(`#/view/${id}`, { replace: true }); return () => {}; }
    quadId = row.id;
    serverUpdatedAt = row.updated_at;
    st.doc = normalizeDoc(row.data);
    st.title = row.title || '';
    st.visibility = row.visibility;
    st.view = row.default_view;
  } else if (fromId) {
    const src = await api.getQuadrant(fromId);
    if (src) {
      st.doc = normalizeDoc(src.data);
      st.title = `${src.title || '제목 없음'} (복제)`.slice(0, 40);
      st.view = src.default_view;
      st.visibility = 'draft';
      st.dirty = true;
    }
  } else {
    st.doc.axes = { top: '', bottom: '', left: '', right: '' };
    // 새 사분면의 내보내기 테마는 지금 화면 테마로 시작
    st.doc.export.theme = getTheme();
  }
  const draftKeyFor = (qid) => `quadrant-draft:${world.id}:${qid || (fromId ? 'copy-' + fromId : 'new')}`;
  let draftKey = draftKeyFor(quadId);

  // ---------- 실행 취소 ----------
  const history = new History(
    () => JSON.stringify({ doc: st.doc, title: st.title }),
    (s) => { const o = JSON.parse(s); st.doc = o.doc; st.title = o.title; st.dirty = true; syncControls(); renderAll(); saveDraft(); });

  // ---------- 화면 뼈대 ----------
  const titleInput = h('input', { class: 'title-input', type: 'text', maxlength: '40', placeholder: '사분면 제목', 'aria-label': '사분면 제목', value: st.title,
    oninput: (e) => { history.checkpoint('title'); st.title = e.target.value; changed({ board: false }); } });
  const statusEl = h('span', { class: 'save-status', 'aria-live': 'polite' });
  const undoBtn = h('button', { class: 'btn-icon', type: 'button', 'aria-label': '되돌리기 (Ctrl+Z)', title: '되돌리기 (Ctrl+Z)', onclick: () => undo() }, icon('undo'));
  const redoBtn = h('button', { class: 'btn-icon', type: 'button', 'aria-label': '다시 하기 (Ctrl+Shift+Z)', title: '다시 하기 (Ctrl+Shift+Z)', onclick: () => redo() }, icon('redo'));
  const visSelect = h('select', { class: 'select', 'aria-label': '공개 범위', onchange: (e) => { st.visibility = e.target.value; changed({ board: false }); } },
    h('option', { value: 'public' }, '공개'), h('option', { value: 'draft' }, '초안 (나만 보기)'));
  visSelect.value = st.visibility;
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => save() }, '저장');

  const viewSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '보기' },
    ...VIEWS.map((v) => h('button', { type: 'button', dataset: { v }, onclick: () => { st.view = v; renderAll(); } }, VIEW_LABEL[v])));
  const gridChk = h('input', { type: 'checkbox', onchange: (e) => { st.doc.grid.show = e.target.checked; changed(); } });
  const snapChk = h('input', { type: 'checkbox', onchange: (e) => { st.doc.grid.snap = e.target.checked; changed({ board: false }); } });
  const divSel = h('select', { class: 'select select-sm', 'aria-label': '그리드 칸 수', onchange: (e) => { history.checkpoint(); st.doc.grid.div = Number(e.target.value); changed(); } },
    ...[8, 10, 12, 20].map((n) => h('option', { value: String(n) }, `짧은 쪽 ${n}칸`)));

  // 슬라이더 하나 (라벨 + 막대 + 숫자 입력칸). get/set으로 문서 값과 연결
  // 숫자칸은 Enter나 칸을 벗어날 때 적용하고, 범위 밖 값은 가장 가까운 끝값으로 맞춤
  const ranges = [];
  const refreshRanges = () => { for (const r of ranges) r(); };
  const rangeField = (label, min, max, step, get, set, unit = '') => {
    const apply = (v, key) => {
      if (!Number.isFinite(v)) { refreshRanges(); return; }
      v = clamp(Math.round(v), min, max);
      if (v === get()) { refreshRanges(); return; }
      history.checkpoint(key);
      set(v);
      refreshRanges();
      changed();
    };
    const slider = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label,
      oninput: (e) => apply(Number(e.target.value), 'range-' + label) });
    const num = h('input', { type: 'number', class: 'num-input', min: String(min), max: String(max), step: '1', inputmode: 'numeric', 'aria-label': `${label} (숫자 입력)`,
      onchange: (e) => apply(Number(e.target.value), null),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(Number(e.target.value), null); e.target.select(); } } });
    ranges.push(() => {
      slider.value = String(get());
      if (document.activeElement !== num || Number(num.value) !== get()) num.value = String(get());
    });
    return h('div', { class: 'range-field' },
      h('span', { class: 'range-label' }, label), slider,
      h('span', { class: 'num-wrap' }, num, unit ? h('span', { class: 'muted small' }, unit) : null));
  };

  // 사분면 크기: '비율 고정'을 켜면 가로·세로 중 하나를 바꿀 때 다른 쪽이 같은 비율로 따라옴
  let lockRatio = st.doc.board.w / st.doc.board.h;
  const setBoard = (w, hh) => {
    if (st.doc.board.lock) {
      // 한쪽이 범위 끝에 닿으면 그 끝에 맞춰 다른 쪽을 다시 계산 (비율 유지)
      if (w != null) hh = w / lockRatio; else w = hh * lockRatio;
      if (hh > SIZE_MAX) { hh = SIZE_MAX; w = hh * lockRatio; }
      if (hh < SIZE_MIN) { hh = SIZE_MIN; w = hh * lockRatio; }
      if (w > SIZE_MAX) { w = SIZE_MAX; hh = w / lockRatio; }
      if (w < SIZE_MIN) { w = SIZE_MIN; hh = w / lockRatio; }
    }
    if (w != null) st.doc.board.w = clamp(Math.round(w), SIZE_MIN, SIZE_MAX);
    if (hh != null) st.doc.board.h = clamp(Math.round(hh), SIZE_MIN, SIZE_MAX);
  };
  const boardW = rangeField('가로', SIZE_MIN, SIZE_MAX, 50, () => st.doc.board.w, (v) => setBoard(v, null));
  const boardH = rangeField('세로', SIZE_MIN, SIZE_MAX, 50, () => st.doc.board.h, (v) => setBoard(null, v));
  const lockChk = h('input', { type: 'checkbox', onchange: (e) => {
    history.checkpoint();
    st.doc.board.lock = e.target.checked;
    lockRatio = st.doc.board.w / st.doc.board.h;
    changed({ board: false });
    syncControls();
  } });
  const ratioText = h('span', { class: 'muted small ratio-text' });
  ranges.push(() => { ratioText.textContent = ratioLabel(st.doc.board.w, st.doc.board.h); });
  const sizeField = rangeField('아이콘 크기', ICON_MIN, ICON_MAX, 2, () => st.doc.iconSize, (v) => { st.doc.iconSize = v; });
  const nameSize = rangeField('이름 글자', ...TEXT_RANGE.name, 1, () => st.doc.text.name, (v) => { st.doc.text.name = v; });
  const descSize = rangeField('설명 글자', ...TEXT_RANGE.desc, 1, () => st.doc.text.desc, (v) => { st.doc.text.desc = v; });
  const axisSize = rangeField('축 이름 글자', ...TEXT_RANGE.axis, 1, () => st.doc.text.axis, (v) => { st.doc.text.axis = v; });
  const preset = (label, w, hh) => h('button', { type: 'button', class: 'chip', onclick: () => {
    history.checkpoint(); st.doc.board.w = w; st.doc.board.h = hh; lockRatio = w / hh; syncControls(); changed();
  } }, label);
  const resetText = h('button', { type: 'button', class: 'chip', onclick: () => {
    history.checkpoint(); st.doc.text = { ...TEXT_DEFAULT }; st.doc.iconSize = 88; syncControls(); changed();
  } }, '기본 크기로');

  const zoomSeg = h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': '확대' },
    ...[[1, '맞춤'], [1.5, '150%'], [2, '200%']].map(([z, t]) => h('button', { type: 'button', dataset: { v: String(z) }, onclick: () => { st.zoom = z; board.setZoom(z); paintSeg(zoomSeg, String(z)); } }, t)));
  const warnChip = h('button', { class: 'warn-chip', type: 'button', hidden: true, onclick: () => {
    const bad = [...board.layoutInfo()].find(([, b]) => b.bad);
    if (bad) select(bad[0]);
  } });

  const axisInputs = {};
  const axesRow = h('div', { class: 'axes-row' }, ...AXES.map(([k, label]) => {
    const inp = h('input', { type: 'text', maxlength: '20', placeholder: '축 이름', value: st.doc.axes[k] || '',
      oninput: (e) => { history.checkpoint('axis-' + k); st.doc.axes[k] = e.target.value; changed(); } });
    axisInputs[k] = inp;
    return h('label', { class: 'field axis-field' }, h('span', { class: 'field-label' }, label), inp);
  }));

  const group = (title, ...children) => h('section', { class: 'settings-group' }, h('h3', null, title), ...children);
  const settingsPanel = h('div', { class: 'settings-panel', id: 'ed-settings' },
    group('축 이름', axesRow),
    group('사분면 크기', boardW, boardH,
      h('div', { class: 'row-between' }, h('label', { class: 'check' }, lockChk, '비율 고정'), ratioText),
      h('div', { class: 'chips' }, preset('정사각형', 1000, 1000), preset('가로로 넓게', 1600, 1000), preset('세로로 길게', 1000, 1400))),
    group('아이콘·글자 크기', sizeField, nameSize, descSize, axisSize, h('div', { class: 'chips' }, resetText)),
    group('그리드',
      h('label', { class: 'check' }, gridChk, '그리드 보이기'),
      h('label', { class: 'check' }, snapChk, '그리드에 맞추기'),
      divSel));

  const banner = h('div', { class: 'banner', hidden: true });
  const boardHost = h('div', { class: 'ed-board' });
  const selPanel = h('section', { class: 'side-section sel-panel', 'aria-label': '선택한 캐릭터' });
  const rosterPanel = h('section', { class: 'side-section roster', 'aria-label': '캐릭터 일람' });
  const tabRoster = h('button', { type: 'button', class: 'side-tab', onclick: () => setTab('roster') });
  const tabSel = h('button', { type: 'button', class: 'side-tab', onclick: () => setTab('sel') });
  const sheetToggle = h('button', { type: 'button', class: 'btn-icon sheet-toggle', 'aria-label': '아래 패널 접기/펴기', onclick: () => { st.sheetOpen = !st.sheetOpen; paintSide(); board.fit(); } }, icon('chevron'));
  const side = h('aside', { class: 'ed-side', dataset: { dropzone: 'roster' } },
    h('div', { class: 'side-tabs' }, tabRoster, tabSel, sheetToggle), selPanel, rosterPanel);
  const sideSel = h('aside', { class: 'ed-side-sel', 'aria-label': '선택한 캐릭터 편집' });
  // 화면 너비에 따라 선택 패널을 별도 사이드바(일람 바로 왼쪽) ↔ 일람 사이드바 안(탭) 사이로 옮김
  // 넓은 화면에서도 '사이드바 나누기'를 끄면 오른쪽 하나에 탭으로 (가로로 긴 사분면을 크게 보고 싶을 때)
  const wideMq = window.matchMedia(WIDE_MQ);
  let splitOn = lsGet(SPLIT_KEY) !== false;
  const isWide = () => wideMq.matches && splitOn;
  const splitBtn = h('button', { class: 'btn btn-sm split-toggle', type: 'button', title: '선택한 캐릭터 패널을 일람 옆에 따로 띄우기',
    onclick: () => { splitOn = !splitOn; lsSet(SPLIT_KEY, splitOn); placePanels(); renderAll(); } }, '사이드바 나누기');
  function placePanels() {
    if (isWide()) { if (selPanel.parentNode !== sideSel) sideSel.append(selPanel); }
    else if (selPanel.parentNode !== side) side.insertBefore(selPanel, rosterPanel);
    sideSel.hidden = !isWide();
    // CSS가 탭 모드를 알 수 있게 (넓은 화면 + 나누기 끔 = 중간 너비와 같은 탭)
    side.classList.toggle('tabbed', !isMobile() && !isWide());
    splitBtn.hidden = !wideMq.matches;
    splitBtn.setAttribute('aria-pressed', String(splitOn));
    splitBtn.classList.toggle('on', splitOn);
  }
  placePanels();
  const isMid = () => !isMobile() && !isWide();

  const settingsBtn = h('button', { class: 'btn btn-sm settings-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ed-settings',
    onclick: () => { const open = !el.classList.contains('settings-open'); el.classList.toggle('settings-open', open); settingsBtn.setAttribute('aria-expanded', String(open)); board.fit(); } },
  '설정', icon('chevron', 14));
  const el = h('div', { class: 'editor' },
    h('div', { class: 'ed-top' },
      h('button', { class: 'btn-icon', type: 'button', 'aria-label': '목록으로', onclick: () => navigate('#/') }, icon('back')),
      titleInput, statusEl,
      h('div', { class: 'ed-top-actions' }, undoBtn, redoBtn,
        h('button', { class: 'btn', type: 'button', 'aria-label': '이미지로 내보내기', onclick: () => openExport() }, icon('download'), h('span', { class: 'hide-sm' }, '이미지로 내보내기')),
        visSelect, saveBtn)),
    h('div', { class: 'ed-opts' }, viewSeg, zoomSeg, settingsBtn, splitBtn, warnChip),
    settingsPanel,
    h('div', { class: 'ed-body' },
      h('main', { class: 'ed-main' }, banner, boardHost,
        h('p', { class: 'muted small ed-help' }, '일람에서 캐릭터를 끌어다 놓거나, 누른 뒤 놓을 곳을 누르세요. 선택한 캐릭터는 방향키로 옮기고(Shift는 크게) Delete로 뺄 수 있어요. 사분면 밖 일람 쪽으로 끌어 놓아도 빠져요.')),
      sideSel, side));
  root.replaceChildren(el);
  // 축 이름이 비어 있는 새 사분면은 설정을 펼친 채로 시작
  if (!Object.values(st.doc.axes).some((v) => v && v.trim())) {
    el.classList.add('settings-open');
    settingsBtn.setAttribute('aria-expanded', 'true');
  }

  const board = new BoardView(boardHost, {
    editable: true,
    fitHeight: () => !isMobile(),
    bottomReserve: () => (isMobile() ? side.getBoundingClientRect().height + 12 : 16),
    onSelect: (cid, o) => select(cid, o),
    onTap: () => { if (isMobile()) { st.sideTab = 'sel'; st.sheetOpen = true; paintSide(); board.fit(); } },
    onDragStart: () => history.checkpoint(),
    onMove: (cid, x, y, commit) => {
      const it = st.doc.items.find((i) => i.c === cid);
      if (!it) return;
      it.x = x; it.y = y;
      if (commit) changed(); else board.render();
    },
    onDropOut: (cid) => { removeItem(cid, false); toast(`${chars.get(cid)?.name || ''}을(를) 사분면에서 뺐어요.`); },
    onPlaceAt: (cid, ux, uy) => placeAt(cid, ux, uy),
  });

  // ---------- 동작 ----------
  function changed({ board: redraw = true } = {}) {
    st.dirty = true;
    if (redraw) renderAll({ keepSel: true }); else renderTop();
    saveDraft();
  }
  function select(cid, { pointer = false } = {}) {
    st.selected = cid;
    if (cid) st.placing = null;
    // 휴대폰: 드래그 시작 때는 패널을 열지 않음 (열리면 놓을 자리를 가림). 탭으로 끝나면 onTap에서 열어 줌
    if (cid && isMobile() && !pointer) { st.sideTab = 'sel'; st.sheetOpen = true; }
    // 중간 너비: 고르면 '선택' 탭, 선택을 풀면 '일람' 탭
    if (isMid()) st.sideTab = cid ? 'sel' : 'roster';
    renderAll();
  }
  function setTab(t) { st.sideTab = t; st.sheetOpen = true; paintSide(); board.fit(); }

  function placeAt(cid, ux, uy) {
    history.checkpoint();
    const p = board.constrain(ux, uy);
    const it = st.doc.items.find((i) => i.c === cid);
    if (it) { it.x = p.x; it.y = p.y; }
    else {
      if (st.doc.items.length >= 100) { toast('한 사분면에는 100명까지 놓을 수 있어요.', 'error'); return; }
      st.doc.items.push({ c: cid, x: p.x, y: p.y, desc: '' });
    }
    st.placing = null;
    st.selected = cid;
    // 휴대폰: 이어서 배치하기 쉽게 일람을 다시 펼침 (탭 이름에 선택한 캐릭터가 보임)
    if (isMobile()) { st.sheetOpen = true; st.sideTab = 'roster'; }
    changed();
    if (isMobile()) board.fit();
  }
  function removeItem(cid, checkpoint = true) {
    if (checkpoint) history.checkpoint();
    st.doc.items = st.doc.items.filter((i) => i.c !== cid);
    for (const v of CAPTION_VIEWS) delete st.doc.captions[v][cid];
    if (st.selected === cid) { st.selected = null; if (isMid()) st.sideTab = 'roster'; }
    changed();
  }
  function setOverride(patch) {
    const cid = st.selected;
    if (!cid || st.view === 'image') return;
    history.checkpoint();
    const cur = { ...(st.doc.captions[st.view][cid] || {}) };
    for (const [k, v] of Object.entries(patch)) { if (v === 'auto' || v == null) delete cur[k]; else cur[k] = v; }
    if (Object.keys(cur).length) st.doc.captions[st.view][cid] = cur; else delete st.doc.captions[st.view][cid];
    changed();
  }
  // ---------- 겹침 순서 (doc.items 순서 = 아래에서 위로 그리는 순서) ----------
  function iconBox(it) {
    const { w: W, h: H } = dims(st.doc);
    const s = st.doc.iconSize;
    return { x: it.x * W - s / 2, y: it.y * H - s / 2, w: s, h: s };
  }
  const boxesOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // 이 아이콘과 실제로 겹치는 아이콘들 (위에 있는 것 / 아래에 있는 것)
  function layerInfo(cid) {
    const items = st.doc.items.filter((i) => chars.has(i.c));
    const i = items.findIndex((x) => x.c === cid);
    if (i < 0) return { above: [], below: [] };
    const me = iconBox(items[i]);
    return {
      above: items.slice(i + 1).filter((o) => boxesOverlap(me, iconBox(o))),
      below: items.slice(0, i).filter((o) => boxesOverlap(me, iconBox(o))),
    };
  }
  // how: front(맨 앞으로) / up(앞으로 한 칸) / down(뒤로 한 칸) / back(맨 뒤로). 겹친 아이콘 기준으로 움직임
  function moveLayer(cid, how) {
    const info = layerInfo(cid);
    if ((how === 'front' || how === 'up') && !info.above.length) return false;
    if ((how === 'back' || how === 'down') && !info.below.length) return false;
    history.checkpoint();
    const items = st.doc.items;
    const it = items.splice(items.findIndex((x) => x.c === cid), 1)[0];
    let at;
    if (how === 'front') at = items.length;
    else if (how === 'back') at = 0;
    else if (how === 'up') at = items.indexOf(info.above[0]) + 1;
    else at = items.indexOf(info.below[info.below.length - 1]);
    items.splice(at, 0, it);
    changed();
    return true;
  }
  function undo() { history.undo(); }
  function redo() { history.redo(); }

  // ---------- 그리기 ----------
  function paintSeg(seg, value) {
    for (const b of seg.children) {
      const on = b.dataset.v === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function syncControls() {
    titleInput.value = st.title;
    for (const [k] of AXES) if (document.activeElement !== axisInputs[k]) axisInputs[k].value = st.doc.axes[k] || '';
    gridChk.checked = st.doc.grid.show;
    snapChk.checked = st.doc.grid.snap;
    divSel.value = String(st.doc.grid.div);
    lockRatio = st.doc.board.w / st.doc.board.h;
    refreshRanges();
    lockChk.checked = !!st.doc.board.lock;
    visSelect.value = st.visibility;
  }
  function renderTop() {
    undoBtn.disabled = !history.u.length;
    redoBtn.disabled = !history.r.length;
    saveBtn.disabled = st.saving;
    saveBtn.title = `지금 보기(${VIEW_LABEL[st.view]})가 다른 사람에게 처음 보이는 보기로 저장돼요.`;
    if (st.saving) statusEl.textContent = '저장 중…';
    else if (st.dirty) statusEl.textContent = quadId ? '저장 안 된 변경 있음' : '아직 저장 안 됨';
    else statusEl.textContent = statusEl.dataset.saved || '';
    statusEl.classList.toggle('unsaved', st.dirty && !st.saving);
  }
  function renderAll() {
    paintSeg(viewSeg, st.view);
    paintSeg(zoomSeg, String(st.zoom));
    board.set({ doc: st.doc, chars, view: st.view, selected: st.selected, showGrid: st.doc.grid.show, placing: st.placing });
    const badN = [...board.layoutInfo().values()].filter((b) => b.bad).length;
    warnChip.hidden = !badN;
    warnChip.replaceChildren(icon('warn', 14), `캡션 겹침 ${badN}곳`);
    renderTop();
    renderSel();
    renderRoster();
    paintSide();
    board.fit();   // 위쪽 줄(경고 칩·안내 띠 등) 높이가 바뀌어도 사분면 크기를 다시 맞춤
  }
  function paintSide() {
    const placed = st.doc.items.filter((i) => chars.has(i.c)).length;
    tabRoster.textContent = `캐릭터 일람 ${placed}/${charList.length}`;
    tabSel.textContent = st.selected ? `선택: ${chars.get(st.selected)?.name || ''}` : '선택한 캐릭터';
    tabRoster.classList.toggle('on', st.sideTab === 'roster');
    tabSel.classList.toggle('on', st.sideTab === 'sel');
    side.classList.toggle('tab-sel', st.sideTab === 'sel');
    side.classList.toggle('collapsed', !st.sheetOpen);
  }

  let descArea = null;
  function renderSel() {
    const cid = st.selected;
    const it = cid && st.doc.items.find((i) => i.c === cid);
    const ch = cid && chars.get(cid);
    if (!it || !ch) {
      descArea = null;
      selPanel.replaceChildren(h('p', { class: 'muted small empty-sel' }, '사분면이나 일람에서 배치한 캐릭터를 누르면, 여기서 캡션 위치와 설명을 고칠 수 있어요.'));
      return;
    }
    if (descArea && document.activeElement === descArea && descArea.dataset.id === cid) {
      // 설명을 입력하는 중에는 패널을 다시 그리지 않음 (커서 유지)
      const head = selPanel.querySelector('.auto-dir');
      if (head) head.textContent = autoDirText(cid);
      return;
    }
    const ov = st.doc.captions[st.view]?.[cid] || {};
    const lay = board.layoutInfo().get(cid);
    const parts = [
      h('div', { class: 'sel-head' },
        thumb(ch, 44),
        h('div', { class: 'sel-name' }, h('strong', null, ch.name), charMeta(ch) ? h('span', { class: 'muted small' }, charMeta(ch)) : null),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => removeItem(cid) }, '사분면에서 빼기')),
    ];
    if (st.view === 'image') {
      parts.push(h('p', { class: 'muted small' }, "'이미지만' 보기에는 캡션이 없어요. 위에서 다른 보기로 바꾸면 캡션을 고칠 수 있어요."));
    } else {
      const curDir = ov.dir || 'auto';
      const curAlign = ov.align || 'auto';
      const curVAlign = ov.valign || 'auto';
      const vOk = !!lay && VALIGN_DIRS.includes(lay.dir);
      parts.push(
        h('div', { class: 'sel-row' },
          h('div', { class: 'field' },
            h('span', { class: 'field-label' }, '캡션 위치'),
            h('div', { class: 'dir-grid', role: 'group', 'aria-label': '캡션 위치' }, ...DIR_GRID.map(([d, t]) =>
              h('button', { type: 'button', class: d === curDir ? 'on' : '', 'aria-pressed': d === curDir ? 'true' : 'false',
                'aria-label': d === 'auto' ? '자동 배치' : `캡션을 ${DIR_LABEL[d]}에`, onclick: () => setOverride({ dir: d }) }, t))),
            h('span', { class: 'muted small auto-dir' }, autoDirText(cid))),
          h('div', { class: 'field align-fields' },
            h('span', { class: 'field-label' }, '가로 정렬'),
            h('div', { class: 'align-grid', role: 'group', 'aria-label': '가로 정렬' }, ...ALIGN_OPTS.map(([a, t]) =>
              h('button', { type: 'button', class: a === curAlign ? 'on' : '', 'aria-pressed': a === curAlign ? 'true' : 'false', onclick: () => setOverride({ align: a }) }, t))),
            h('span', { class: 'field-label' }, '세로 정렬'),
            h('div', { class: 'align-grid', role: 'group', 'aria-label': '세로 정렬' }, ...VALIGN_OPTS.map(([a, t]) =>
              h('button', { type: 'button', class: a === curVAlign ? 'on' : '', 'aria-pressed': a === curVAlign ? 'true' : 'false', disabled: !vOk,
                title: vOk ? '' : '캡션이 왼쪽·오른쪽에 있을 때 쓸 수 있어요', onclick: () => setOverride({ valign: a }) }, t))))),
        h('p', { class: 'muted small' }, `정렬은 아이콘 가장자리 기준이고, 세로 정렬은 캡션이 왼쪽·오른쪽에 있을 때 써요. 위치·정렬은 '${VIEW_LABEL[st.view]}' 보기에만 적용돼요.`),
        st.view === 'desc_only' && !(it.desc || '').trim() ? h('p', { class: 'warn small' }, icon('warn', 14), " 설명이 없어서 '설명만' 보기에서는 이 캐릭터 옆에 아무 글도 안 보여요.") : null,
        lay?.bad ? h('p', { class: 'warn small' }, icon('warn', 14), ' 다른 캡션이나 이미지와 겹쳐 있어요. 위치를 바꾸거나 아이콘 크기를 줄여 보세요.') : null);
    }
    // 겹침 순서 (모든 보기 공통)
    const li = layerInfo(cid);
    const lbtn = (how, label, tip, on) => h('button', { type: 'button', class: 'btn btn-sm', disabled: !on, title: tip, onclick: () => moveLayer(cid, how) }, label);
    parts.push(h('div', { class: 'field layer-field' },
      h('span', { class: 'field-label' }, '겹침 순서'),
      h('div', { class: 'layer-btns', role: 'group', 'aria-label': '겹침 순서' },
        lbtn('back', '맨 뒤로', 'Ctrl+Shift+[', li.below.length > 0),
        lbtn('down', '뒤로', 'Ctrl+[', li.below.length > 0),
        lbtn('up', '앞으로', 'Ctrl+]', li.above.length > 0),
        lbtn('front', '맨 앞으로', 'Ctrl+Shift+]', li.above.length > 0)),
      h('span', { class: 'muted small' }, li.above.length || li.below.length
        ? `겹친 아이콘: 위에 ${li.above.length}개, 아래에 ${li.below.length}개`
        : '다른 아이콘과 겹쳐 있지 않아요.')));
    const counter = h('span', { class: 'muted small' }, `${(it.desc || '').length} / 60`);
    descArea = h('textarea', { rows: '3', maxlength: '60', placeholder: '이 캐릭터에 대한 한 줄 설명', dataset: { id: cid },
      oninput: (e) => {
        history.checkpoint('desc-' + cid);
        it.desc = e.target.value.slice(0, 60);
        counter.textContent = `${it.desc.length} / 60`;
        changed();
      } });
    descArea.value = it.desc || '';
    parts.push(h('label', { class: 'field' },
      h('span', { class: 'field-label row-between' }, h('span', null, "설명 ('이름+설명', '설명만' 보기에 표시)"), counter), descArea));
    selPanel.replaceChildren(...parts.filter(Boolean));
  }
  function autoDirText(cid) {
    const lay = board.layoutInfo().get(cid);
    if (!lay || st.view === 'image') return '';
    return lay.pinned ? `고정: ${DIR_LABEL[lay.dir]}` : `자동 배치 중: ${DIR_LABEL[lay.dir]}`;
  }

  let suppressClick = false;
  function renderRoster() {
    const placedIds = new Set(st.doc.items.map((i) => i.c));
    const orgs = [...new Set(charList.map((c) => c.org).filter(Boolean))];
    const careers = [...new Set(charList.map((c) => c.career).filter(Boolean))];
    const f = st.filter;
    const q = f.q.trim().toLowerCase();
    const list = charList.filter((c) => (!q || [c.name, c.org, c.career].some((s) => (s || '').toLowerCase().includes(q)))
      && (!f.org || c.org === f.org) && (!f.career || c.career === f.career)
      && (!f.unplaced || !placedIds.has(c.id)));

    if (!rosterPanel.firstChild) {
      const search = h('input', { type: 'search', class: 'input', placeholder: '이름·기관·경력으로 찾기', 'aria-label': '캐릭터 찾기 (이름, 기관, 경력)',
        oninput: (e) => { st.filter.q = e.target.value; renderRoster(); } });
      rosterPanel.append(
        h('div', { class: 'row-between' }, h('strong', null, '캐릭터 일람'), h('span', { class: 'muted small roster-count' })),
        search,
        h('div', { class: 'filter-rows' }),
        h('div', { class: 'tiles' }),
        h('p', { class: 'muted small' }, '배치한 캐릭터는 흐리게 보여요. 누르면 사분면에서 선택돼요.'));
    }
    rosterPanel.querySelector('.roster-count').textContent = `배치 ${[...placedIds].filter((x) => chars.has(x)).length} / ${charList.length}`;
    const chip = (label, on, fn) => h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label);
    // 기관·경력은 각각 하나씩 고를 수 있고, 둘 다 고르면 둘 다 맞는 캐릭터만
    const filterRow = (label, values, key) => (values.length ? h('div', { class: 'filter-row', role: 'group', 'aria-label': `${label}로 거르기` },
      h('span', { class: 'filter-label' }, label),
      h('div', { class: 'chips' },
        chip('전체', !f[key], () => { f[key] = ''; renderRoster(); }),
        ...values.map((v) => chip(v, f[key] === v, () => { f[key] = f[key] === v ? '' : v; renderRoster(); })))) : null);
    rosterPanel.querySelector('.filter-rows').replaceChildren(...[
      filterRow('기관', orgs, 'org'),
      filterRow('경력', careers, 'career'),
      h('div', { class: 'filter-row' }, h('span', { class: 'filter-label' }), h('div', { class: 'chips' },
        chip('미배치만', f.unplaced, () => { f.unplaced = !f.unplaced; renderRoster(); }))),
    ].filter(Boolean));

    const tiles = rosterPanel.querySelector('.tiles');
    tiles.replaceChildren(...list.map((c) => {
      const placed = placedIds.has(c.id);
      const meta = charMeta(c);
      const t = h('button', { type: 'button', class: 'tile' + (placed ? ' placed' : '') + (st.selected === c.id ? ' selected' : '') + (st.placing === c.id ? ' placing' : ''),
        dataset: { id: c.id }, title: meta ? `${c.name}\n${meta}` : c.name,
        'aria-label': `${c.name}${meta ? `, ${meta}` : ''}${placed ? ' (배치됨)' : ''}`,
        onclick: () => { if (suppressClick) { suppressClick = false; return; } tileClick(c.id); } },
      thumb(c, 56), h('span', { class: 'tile-name' }, c.name),
      c.org ? h('span', { class: 'tile-meta' }, c.org) : null,
      c.career ? h('span', { class: 'tile-meta' }, c.career) : null);
      t.addEventListener('pointerdown', (e) => startTileDrag(e, c));
      return t;
    }));
    if (!list.length) tiles.append(h('p', { class: 'muted small' }, '조건에 맞는 캐릭터가 없어요.'));
  }

  function tileClick(cid) {
    if (st.doc.items.some((i) => i.c === cid)) { select(cid); return; }
    st.placing = st.placing === cid ? null : cid;
    st.selected = null;
    if (st.placing && isMobile()) { st.sheetOpen = false; }
    renderAll();
    if (st.placing) {
      board.fit();
      if (isMobile()) {
        const top = boardHost.getBoundingClientRect().top + window.scrollY - 64;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    }
  }

  function startTileDrag(e, c) {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null;
    const size = Math.max(40, st.doc.iconSize * board.k);
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        ghost = h('div', { class: 'drag-ghost', style: { width: size + 'px', height: size + 'px', borderRadius: Math.round(size * 0.18) + 'px' } }, thumb(c, size));
        document.body.append(ghost);
        document.body.classList.add('dragging-tile');
      }
      ghost.style.transform = `translate(${ev.clientX - size / 2}px, ${ev.clientY - size / 2}px)`;
      boardHost.classList.toggle('drop-target', board.stageContains(ev.clientX, ev.clientY));
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      boardHost.classList.remove('drop-target');
      document.body.classList.remove('dragging-tile');
      if (!ghost) return;
      ghost.remove();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (ev.type !== 'pointercancel' && board.stageContains(ev.clientX, ev.clientY)) {
        const u = board.toUnits(ev.clientX, ev.clientY);
        placeAt(c.id, u.x, u.y);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function thumb(c, size) {
    return c.url
      ? h('img', { class: 'thumb', src: c.url, alt: '', draggable: 'false', style: { width: size + 'px', height: size + 'px' } })
      : h('span', { class: 'thumb thumb-fallback', style: { width: size + 'px', height: size + 'px', background: colorFor(c.id), fontSize: Math.round(size * 0.4) + 'px' } }, initialOf(c.name));
  }

  // ---------- 내보내기 ----------
  function openExport() {
    openExportModal({
      doc: st.doc, chars, view: st.view, title: st.title, author: profile?.nickname || '',
      prefs: st.doc.export,
      onPrefsChange: (p) => { st.doc.export = p; st.dirty = true; renderTop(); saveDraft(); },
    });
  }

  // ---------- 저장 ----------
  const saveDraft = debounce(() => {
    lsSet(draftKey, { title: st.title, visibility: st.visibility, view: st.view, doc: st.doc, at: Date.now(), base: serverUpdatedAt });
  }, 700);

  async function save() {
    if (st.saving) return;
    if (!st.doc.items.length && !(await confirmDialog({ title: '빈 사분면이에요', body: '캐릭터가 하나도 없는 상태로 저장할까요?', ok: '저장' }))) return;
    st.saving = true;
    renderTop();
    try {
      const row = await api.saveQuadrant({
        id: quadId, world: world.id, title: st.title.trim(), default_view: st.view, visibility: st.visibility, data: compactDoc(st.doc),
      });
      saveDraft.cancel();
      lsDel(draftKey);
      if (!quadId) {
        quadId = row.id;
        draftKey = draftKeyFor(quadId);
        history_replace(`#/edit/${row.id}`);
      }
      serverUpdatedAt = row.updated_at;
      st.dirty = false;
      const t = new Date();
      statusEl.dataset.saved = `저장됨 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      toast(st.visibility === 'public' ? '저장했어요. 세계관 멤버 모두가 볼 수 있어요.' : '초안으로 저장했어요. 나만 볼 수 있어요.');
    } catch (e) {
      toast(e.message || '저장하지 못했어요.', 'error');
    } finally {
      st.saving = false;
      renderTop();
    }
  }
  function history_replace(hash) { window.history.replaceState(null, '', location.pathname + location.search + hash); }

  // ---------- 임시 저장 불러오기 ----------
  const draft = lsGet(draftKey);
  if (draft && draft.doc && !fromId) {
    const stale = quadId && draft.base !== serverUpdatedAt;
    const differs = JSON.stringify(compactDoc(normalizeDoc(draft.doc))) !== JSON.stringify(compactDoc(st.doc)) || (draft.title || '') !== st.title;
    if (stale) lsDel(draftKey);
    else if (differs) {
      const when = new Date(draft.at);
      banner.hidden = false;
      banner.replaceChildren(
        h('span', null, `저장하지 않은 작업이 있어요 (${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}).`),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => {
          history.checkpoint();
          st.doc = normalizeDoc(draft.doc); st.title = draft.title || ''; st.visibility = draft.visibility || st.visibility;
          if (VIEWS.includes(draft.view)) st.view = draft.view;
          st.dirty = true; banner.hidden = true; syncControls(); renderAll();
        } }, '불러오기'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { lsDel(draftKey); banner.hidden = true; } }, '버리기'));
    }
  }

  // ---------- 키보드 ----------
  const onKey = (e) => {
    if (!document.body.contains(el)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); save(); return; }
    if (document.querySelector('.modal-overlay')) return;
    const typing = e.target.matches?.('input:not([type=checkbox]):not([type=radio]), textarea, select');
    if (typing) return;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { if (st.placing || st.selected) { st.placing = null; st.selected = null; if (isMid()) st.sideTab = 'roster'; renderAll(); } return; }
    if (!st.selected) return;
    const it = st.doc.items.find((i) => i.c === st.selected);
    if (!it) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(it.c); return; }
    // 겹침 순서: Ctrl+] 앞으로, Ctrl+[ 뒤로, Shift를 같이 누르면 맨 앞/맨 뒤 (자판 배열과 상관없이 키 위치로 판단)
    if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      e.preventDefault();
      const up = e.code === 'BracketRight';
      moveLayer(it.c, up ? (e.shiftKey ? 'front' : 'up') : (e.shiftKey ? 'back' : 'down'));
      return;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      const snap = st.doc.grid.snap;
      const { w: W, h: H } = dims(st.doc);
      const g = gridSteps(st.doc);
      const stepX = snap ? g.sx : (e.shiftKey ? 25 : 5);
      const stepY = snap ? g.sy : (e.shiftKey ? 25 : 5);
      history.checkpoint('nudge-' + it.c);
      const p = board.constrain(it.x * W + dx * stepX, it.y * H + dy * stepY, snap);
      it.x = p.x; it.y = p.y;
      changed();
    }
  };
  document.addEventListener('keydown', onKey);
  const onBeforeUnload = (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBeforeUnload);
  const onMq = () => { placePanels(); board.fit(); };
  const onWide = () => { placePanels(); board.fit(); };
  wideMq.addEventListener?.('change', onWide);
  const mq = window.matchMedia('(max-width: 860px)');
  mq.addEventListener?.('change', onMq);

  setLeaveGuard(async () => {
    if (!st.dirty) return true;
    return confirmDialog({ title: '저장하지 않고 나갈까요?', body: '이 브라우저에 임시 저장된 작업은 남아 있어서, 다시 열면 불러올 수 있어요.', ok: '나가기', cancel: '계속 편집' });
  });

  syncControls();
  renderAll();
  board.fit();
  ctx.setRerender?.(() => renderAll());

  return () => {
    if (st.dirty) saveDraft.flush(); else saveDraft.cancel();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', onBeforeUnload);
    mq.removeEventListener?.('change', onMq);
    wideMq.removeEventListener?.('change', onWide);
    board.destroy();
    setLeaveGuard(null);
  };
}

// 가로:세로 비율 글자 (예: 1600×1000 → 8 : 5)
function ratioLabel(w, hh) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(w, hh);
  const a = w / g, b = hh / g;
  return a <= 32 && b <= 32 ? `비율 ${a} : ${b}` : `비율 ${(w / hh).toFixed(2)} : 1`;
}

function notFound(navigate) {
  return h('div', { class: 'empty-state' },
    h('h2', null, '사분면을 찾을 수 없어요'),
    h('p', { class: 'muted' }, '삭제됐거나, 볼 수 있는 권한이 없어요.'),
    h('button', { class: 'btn', type: 'button', onclick: () => navigate('#/') }, '목록으로'));
}

export const _test = { clamp };
