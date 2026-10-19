// 사분면 편집 화면
import { h, icon, clamp, debounce, lsGet, lsSet, lsDel, toast, confirmDialog, colorFor, initialOf, charMeta } from './util.js';
import { BOARD, VIEWS, VIEW_LABEL, DIR_LABEL, emptyDoc, normalizeDoc, compactDoc } from './layout.js';
import { BoardView } from './board.js';
import { openExportModal } from './export_modal.js';

const AXES = [['top', '위쪽 끝'], ['bottom', '아래쪽 끝'], ['left', '왼쪽 끝'], ['right', '오른쪽 끝']];
const DIR_GRID = [['tl', '↖'], ['t', '↑'], ['tr', '↗'], ['l', '←'], ['auto', '자동'], ['r', '→'], ['bl', '↙'], ['b', '↓'], ['br', '↘']];
const ALIGN_OPTS = [['auto', '자동'], ['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']];
const isMobile = () => window.matchMedia('(max-width: 860px)').matches;

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
    ...[8, 10, 12, 20].map((n) => h('option', { value: String(n) }, `${n}칸`)));
  const sizeRange = h('input', { type: 'range', min: '56', max: '140', step: '4', 'aria-label': '아이콘 크기',
    oninput: (e) => { history.checkpoint('size'); st.doc.iconSize = Number(e.target.value); sizeOut.textContent = e.target.value; changed(); } });
  const sizeOut = h('span', { class: 'muted small num' });
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

  const banner = h('div', { class: 'banner', hidden: true });
  const boardHost = h('div', { class: 'ed-board' });
  const selPanel = h('section', { class: 'side-section sel-panel', 'aria-label': '선택한 캐릭터' });
  const rosterPanel = h('section', { class: 'side-section roster', 'aria-label': '캐릭터 일람' });
  const tabRoster = h('button', { type: 'button', class: 'side-tab', onclick: () => setTab('roster') });
  const tabSel = h('button', { type: 'button', class: 'side-tab', onclick: () => setTab('sel') });
  const sheetToggle = h('button', { type: 'button', class: 'btn-icon sheet-toggle', 'aria-label': '아래 패널 접기/펴기', onclick: () => { st.sheetOpen = !st.sheetOpen; paintSide(); board.fit(); } }, icon('chevron'));
  const side = h('aside', { class: 'ed-side', dataset: { dropzone: 'roster' } },
    h('div', { class: 'side-tabs' }, tabRoster, tabSel, sheetToggle), selPanel, rosterPanel);

  const settingsBtn = h('button', { class: 'btn btn-sm settings-toggle', type: 'button', 'aria-expanded': 'false',
    onclick: () => { const open = !el.classList.contains('settings-open'); el.classList.toggle('settings-open', open); settingsBtn.setAttribute('aria-expanded', String(open)); board.fit(); } },
  '축·그리드 설정', icon('chevron', 14));
  const el = h('div', { class: 'editor' },
    h('div', { class: 'ed-top' },
      h('button', { class: 'btn-icon', type: 'button', 'aria-label': '목록으로', onclick: () => navigate('#/') }, icon('back')),
      titleInput, statusEl,
      h('div', { class: 'ed-top-actions' }, undoBtn, redoBtn,
        h('button', { class: 'btn', type: 'button', 'aria-label': '이미지로 내보내기', onclick: () => openExport() }, icon('download'), h('span', { class: 'hide-sm' }, '이미지로 내보내기')),
        visSelect, saveBtn)),
    h('div', { class: 'ed-opts' },
      viewSeg, settingsBtn, warnChip,
      h('div', { class: 'opts-more' },
        h('label', { class: 'check' }, gridChk, '그리드 보이기'),
        h('label', { class: 'check' }, snapChk, '그리드에 맞추기'),
        divSel,
        h('label', { class: 'range-field' }, '아이콘 크기', sizeRange, sizeOut),
        zoomSeg)),
    h('div', { class: 'ed-body' },
      h('main', { class: 'ed-main' }, axesRow, banner, boardHost,
        h('p', { class: 'muted small ed-help' }, '일람에서 캐릭터를 끌어다 놓거나, 누른 뒤 놓을 곳을 누르세요. 선택한 캐릭터는 방향키로 옮기고(Shift는 크게) Delete로 뺄 수 있어요. 사분면 밖 일람 쪽으로 끌어 놓아도 빠져요.')),
      side));
  root.replaceChildren(el);
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
    for (const v of ['name', 'desc']) delete st.doc.captions[v][cid];
    if (st.selected === cid) st.selected = null;
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
    sizeRange.value = String(st.doc.iconSize);
    sizeOut.textContent = String(st.doc.iconSize);
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
      parts.push(h('p', { class: 'muted small' }, "'이미지만' 보기에는 캡션이 없어요. 위에서 보기를 '이름'이나 '이름+설명'으로 바꾸면 캡션을 고칠 수 있어요."));
    } else {
      const curDir = ov.dir || 'auto';
      const curAlign = ov.align || 'auto';
      parts.push(
        h('div', { class: 'sel-row' },
          h('div', { class: 'field' },
            h('span', { class: 'field-label' }, '캡션 위치'),
            h('div', { class: 'dir-grid', role: 'group', 'aria-label': '캡션 위치' }, ...DIR_GRID.map(([d, t]) =>
              h('button', { type: 'button', class: d === curDir ? 'on' : '', 'aria-pressed': d === curDir ? 'true' : 'false',
                'aria-label': d === 'auto' ? '자동 배치' : `캡션을 ${DIR_LABEL[d]}에`, onclick: () => setOverride({ dir: d }) }, t))),
            h('span', { class: 'muted small auto-dir' }, autoDirText(cid))),
          h('div', { class: 'field' },
            h('span', { class: 'field-label' }, '텍스트 정렬'),
            h('div', { class: 'align-grid', role: 'group', 'aria-label': '텍스트 정렬' }, ...ALIGN_OPTS.map(([a, t]) =>
              h('button', { type: 'button', class: a === curAlign ? 'on' : '', 'aria-pressed': a === curAlign ? 'true' : 'false', onclick: () => setOverride({ align: a }) }, t))))),
        h('p', { class: 'muted small' }, `이 위치·정렬은 '${VIEW_LABEL[st.view]}' 보기에만 적용돼요. 다른 보기의 설정은 따로 기억해요.`),
        lay?.bad ? h('p', { class: 'warn small' }, icon('warn', 14), ' 다른 캡션이나 이미지와 겹쳐 있어요. 위치를 바꾸거나 아이콘 크기를 줄여 보세요.') : null);
    }
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
      h('span', { class: 'field-label row-between' }, h('span', null, "설명 ('이름+설명' 보기에 표시)"), counter), descArea));
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
    if (e.key === 'Escape') { if (st.placing || st.selected) { st.placing = null; st.selected = null; renderAll(); } return; }
    if (!st.selected) return;
    const it = st.doc.items.find((i) => i.c === st.selected);
    if (!it) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(it.c); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      const snap = st.doc.grid.snap;
      const step = snap ? BOARD / st.doc.grid.div : (e.shiftKey ? 25 : 5);
      history.checkpoint('nudge-' + it.c);
      const p = board.constrain(it.x * BOARD + dx * step, it.y * BOARD + dy * step, snap);
      it.x = p.x; it.y = p.y;
      changed();
    }
  };
  document.addEventListener('keydown', onKey);
  const onBeforeUnload = (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onBeforeUnload);
  const onMq = () => { board.fit(); };
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
    board.destroy();
    setLeaveGuard(null);
  };
}

function notFound(navigate) {
  return h('div', { class: 'empty-state' },
    h('h2', null, '사분면을 찾을 수 없어요'),
    h('p', { class: 'muted' }, '삭제됐거나, 볼 수 있는 권한이 없어요.'),
    h('button', { class: 'btn', type: 'button', onclick: () => navigate('#/') }, '목록으로'));
}

export const _test = { clamp };
