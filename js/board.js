// 화면 위의 사분면 (편집/보기 공용). 내부 좌표는 사분면 크기(기본 1000) 단위, 화면 크기에 맞게 축소해서 보여줌.
import { STAGE_MARGIN, layoutCaptions, axisLabelBoxes, placeBox, dims, styleOf, gridSteps, axisFont } from './layout.js';
import { h, clamp, colorFor, initialOf } from './util.js';

export class BoardView {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;               // { editable, onSelect, onDragStart, onMove, onDropOut, onPlaceAt, fitHeight }
    this.editable = !!opts.editable;
    this.zoom = 1;
    this.k = 0.5;
    this.prevDirs = new Map();
    this.lastLayout = new Map();
    this.iconEls = new Map();
    this.capEls = new Map();
    this.drag = null;
    this.state = { doc: null, chars: new Map(), view: 'name', selected: null, showGrid: false, placing: null };

    host.classList.add('board-viewport');
    this.sizer = h('div', { class: 'board-sizer' });
    this.stage = h('div', { class: 'board-stage' });
    this.board = h('div', { class: 'board', style: { left: STAGE_MARGIN + 'px', top: STAGE_MARGIN + 'px' } });
    this.gridEl = h('div', { class: 'board-grid' });
    this.axisV = h('div', { class: 'axis-line axis-v' });
    this.axisH = h('div', { class: 'axis-line axis-h' });
    this.axisLayer = h('div', { class: 'board-axes' }, this.axisV, this.axisH);
    this.W = 1000; this.H = 1000;
    this.axisLabelLayer = h('div', { class: 'board-axis-labels' });
    this.capLayer = h('div', { class: 'board-caps' });
    this.iconLayer = h('div', { class: 'board-icons' });
    this.hint = h('div', { class: 'board-hint', hidden: true });
    this.board.append(this.gridEl, this.axisLayer, this.axisLabelLayer, this.capLayer, this.iconLayer);
    this.stage.append(this.board);
    this.sizer.append(this.stage, this.hint);
    host.append(this.sizer);

    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(host);
    this._onWinResize = () => this.fit();
    window.addEventListener('resize', this._onWinResize);

    if (this.editable) this.bindPointer();
    else this.board.addEventListener('click', (e) => {
      const el = e.target.closest('[data-id]');
      this.opts.onSelect?.(el ? el.dataset.id : null);
    });
  }

  destroy() {
    this.ro.disconnect();
    window.removeEventListener('resize', this._onWinResize);
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.render();
  }

  setZoom(z) { this.zoom = z; this.fit(); }

  // 사분면 크기에 맞춰 무대 크기를 정함
  applySize() {
    const { w, h: hh } = dims(this.state.doc);
    this.W = w; this.H = hh;
    this.SW = w + STAGE_MARGIN * 2;
    this.SH = hh + STAGE_MARGIN * 2;
    Object.assign(this.stage.style, { width: this.SW + 'px', height: this.SH + 'px' });
    Object.assign(this.board.style, { width: w + 'px', height: hh + 'px' });
    Object.assign(this.axisV.style, { left: (w / 2 - 1) + 'px' });
    Object.assign(this.axisH.style, { top: (hh / 2 - 1) + 'px' });
  }

  fit() {
    if (!this.SW) this.applySize();
    const availW = this.host.clientWidth || 300;
    let k = availW / this.SW;
    const fitH = typeof this.opts.fitHeight === 'function' ? this.opts.fitHeight() : this.opts.fitHeight;
    if (fitH) {
      // 스크롤 위치와 상관없이, 페이지 맨 위에서부터의 위치로 계산 (스크롤된 채로 맞추면 사분면이 화면 밖으로 커지는 문제 방지)
      const docTop = this.host.getBoundingClientRect().top + window.scrollY;
      const availH = Math.max(280, window.innerHeight - docTop - (this.opts.bottomReserve?.() || 16));
      k = Math.min(k, availH / this.SH);
    }
    k = Math.min(k, this.opts.maxScale || 1);
    k *= this.zoom;
    this.k = k;
    this.stage.style.transform = `scale(${k})`;
    this.sizer.style.width = (this.SW * k) + 'px';
    this.sizer.style.height = (this.SH * k) + 'px';
    this.host.classList.toggle('zoomed', this.zoom > 1);
  }

  toUnits(clientX, clientY) {
    const r = this.board.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * this.W, y: ((clientY - r.top) / r.height) * this.H };
  }
  stageContains(clientX, clientY) {
    const r = this.stage.getBoundingClientRect();
    const v = this.host.getBoundingClientRect();
    return clientX >= Math.max(r.left, v.left) && clientX <= Math.min(r.right, v.right)
      && clientY >= Math.max(r.top, v.top) && clientY <= Math.min(r.bottom, v.bottom);
  }

  // 그리드 맞춤 + 사분면 안으로 제한 (단위: 사분면 좌표) → 0~1 비율로 돌려줌
  constrain(cx, cy, snap = this.state.doc?.grid?.snap) {
    const doc = this.state.doc;
    const s = doc.iconSize;
    const { w: W, h: H } = dims(doc);
    if (snap) {
      const g = gridSteps(doc);
      cx = Math.round(cx / g.sx) * g.sx;
      cy = Math.round(cy / g.sy) * g.sy;
    }
    return { x: clamp(cx, s / 2, W - s / 2) / W, y: clamp(cy, s / 2, H - s / 2) / H };
  }

  render() {
    const { doc, chars, view, selected, showGrid, placing } = this.state;
    if (!doc) return;
    const s = doc.iconSize;
    const { w: W, h: H } = dims(doc);
    if (W !== this.W || H !== this.H || !this.SW) { this.applySize(); this.fit(); }
    const st = styleOf(doc);

    // 그리드
    this.gridEl.hidden = !showGrid;
    const g = gridSteps(doc);
    this.gridEl.style.backgroundSize = `${g.sx}px ${g.sy}px`;

    // 축 이름
    const af = axisFont(st);
    this.axisLabelLayer.replaceChildren(...axisLabelBoxes(doc.axes, st, W, H).map((ab) =>
      h('div', { class: 'axis-label', style: { left: ab.x + 'px', top: ab.y + 'px', width: ab.w + 'px', height: ab.h + 'px', lineHeight: ab.h + 'px', font: af } }, ab.text)));

    // 아이콘
    const live = doc.items.filter((it) => chars.has(it.c));
    const seen = new Set();
    // 아이콘 겹침 순서 = doc.items 순서 (뒤에 있을수록 위에 그려짐). 끌고 있는 아이콘만 잠깐 맨 위로.
    live.forEach((it, i) => {
      seen.add(it.c);
      let el = this.iconEls.get(it.c);
      const ch = chars.get(it.c);
      if (!el || el.dataset.img !== (ch.url || '')) {
        el?.remove();
        const inner = ch.url
          ? h('img', { src: ch.url, alt: '', draggable: 'false' })
          : h('span', { class: 'q-icon-fallback', style: { background: colorFor(ch.id) } }, initialOf(ch.name));
        el = this.editable
          ? h('button', { class: 'q-icon', type: 'button', dataset: { id: it.c, img: ch.url || '' }, 'aria-label': `${ch.name} (드래그해서 옮기기)` }, inner)
          : h('div', { class: 'q-icon', dataset: { id: it.c, img: ch.url || '' }, role: 'img', 'aria-label': ch.name }, inner);
        this.iconEls.set(it.c, el);
        this.iconLayer.append(el);
      }
      Object.assign(el.style, {
        left: (it.x * W - s / 2) + 'px', top: (it.y * H - s / 2) + 'px',
        width: s + 'px', height: s + 'px', borderRadius: Math.round(s * 0.18) + 'px',
        zIndex: String((this.drag?.id === it.c && this.drag.moved) ? live.length + 5 : i + 1),
      });
      el.classList.toggle('selected', selected === it.c);
      el.classList.toggle('dragging', this.drag?.id === it.c && this.drag.moved);
    });
    for (const [id, el] of this.iconEls) if (!seen.has(id)) { el.remove(); this.iconEls.delete(id); }

    // 캡션
    let layout;
    if (this.drag?.moved && this.lastLayout.size) {
      layout = new Map(this.lastLayout);
      const b = layout.get(this.drag.id);
      const it = live.find((i) => i.c === this.drag.id);
      if (b && it) {
        const p = placeBox(b.dir, it.x * W, it.y * H, s, b.w, b.h, st.gap, b.halign, b.valign, b.leadTop, b.leadBot);
        layout.set(this.drag.id, { ...b, x: p.x, y: p.y });
      }
    } else {
      layout = layoutCaptions({ doc, chars, view, overrides: doc.captions?.[view] || {}, prevDirs: this.prevDirs });
      this.lastLayout = layout;
    }
    const capSeen = new Set();
    for (const [id, b] of layout) {
      capSeen.add(id);
      let el = this.capEls.get(id);
      if (!el) {
        el = h('div', { class: 'q-cap', dataset: { id } });
        this.capEls.set(id, el);
        this.capLayer.append(el);
      }
      const key = b.lines.map((l) => l.role + l.font + l.text).join('\u0001');
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        el.replaceChildren(...b.lines.map((l) => h('div', {
          class: 'q-cap-line ' + l.role,
          style: { font: l.font, height: l.h + 'px', lineHeight: l.h + 'px' },
        }, l.text)));
      }
      Object.assign(el.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', textAlign: b.align });
      el.classList.toggle('pinned', !!b.pinned && this.editable);
      el.classList.toggle('bad', !!b.bad && this.editable);
      el.classList.toggle('selected', selected === id);
    }
    for (const [id, el] of this.capEls) if (!capSeen.has(id)) { el.remove(); this.capEls.delete(id); }

    // 놓기 모드 안내
    this.host.classList.toggle('placing', !!placing);
    this.hint.hidden = !placing;
    if (placing) this.hint.textContent = `${chars.get(placing)?.name || ''}: 놓을 곳을 누르세요 (Esc로 취소)`;
  }

  layoutInfo() { return this.lastLayout; }

  bindPointer() {
    const onDown = (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const iconEl = e.target.closest('.q-icon');
      const capEl = e.target.closest('.q-cap');
      const { doc, placing } = this.state;
      if (iconEl) {
        e.preventDefault();
        const id = iconEl.dataset.id;
        const it = doc.items.find((i) => i.c === id);
        if (!it) return;
        this.opts.onSelect?.(id, { pointer: true });
        // 방향키·Delete가 바로 먹도록 포커스를 옮김 (다시 그려진 요소 기준)
        (this.iconEls.get(id) || iconEl).focus({ preventScroll: true });
        this.drag = { id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, cx: it.x * this.W, cy: it.y * this.H, moved: false };
        iconEl.setPointerCapture?.(e.pointerId);
        return;
      }
      if (capEl) {
        this.opts.onSelect?.(capEl.dataset.id);
        this.iconEls.get(capEl.dataset.id)?.focus({ preventScroll: true });
        return;
      }
      if (document.activeElement?.matches?.('input, textarea, select')) document.activeElement.blur();
      // 놓기는 click에서 처리 (터치에서 손을 뗀 뒤 처리해야 다시 열린 아래 패널이 탭을 가로채지 않음)
      if (placing) return;
      if (this.board.contains(e.target)) this.opts.onSelect?.(null);
    };
    const onMove = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pid) return;
      const dx = (e.clientX - d.sx) / this.k, dy = (e.clientY - d.sy) / this.k;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
        d.moved = true;
        this.opts.onDragStart?.(d.id);
      }
      const p = this.constrain(d.cx + dx, d.cy + dy);
      d.last = p;
      this.opts.onMove?.(d.id, p.x, p.y, false);
      const out = this.isOverDropOut(e.clientX, e.clientY);
      this.host.classList.toggle('drop-out', out);
    };
    const onUp = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pid) return;
      this.drag = null;
      this.host.classList.remove('drop-out');
      if (!d.moved) { this.render(); this.opts.onTap?.(d.id); return; }
      if (this.isOverDropOut(e.clientX, e.clientY)) this.opts.onDropOut?.(d.id);
      else this.opts.onMove?.(d.id, d.last.x, d.last.y, true);
    };
    this.board.addEventListener('click', (e) => {
      const { placing } = this.state;
      if (!placing || e.target.closest('.q-icon, .q-cap')) return;
      const u = this.toUnits(e.clientX, e.clientY);
      this.opts.onPlaceAt?.(placing, u.x, u.y);
    });
    this.board.addEventListener('pointerdown', onDown);
    this.board.addEventListener('pointermove', onMove);
    this.board.addEventListener('pointerup', onUp);
    this.board.addEventListener('pointercancel', onUp);
  }

  isOverDropOut(x, y) {
    const el = document.elementFromPoint(x, y);
    return !!el?.closest?.('[data-dropzone="roster"]');
  }
}
