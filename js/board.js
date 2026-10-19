// 화면 위의 사분면 (편집/보기 공용). 내부 좌표는 1000 단위, 화면 크기에 맞게 축소해서 보여줌.
import { BOARD, STAGE_MARGIN, layoutCaptions, axisLabelBoxes, placeBox } from './layout.js';
import { h, clamp, colorFor, initialOf } from './util.js';

const STAGE = BOARD + STAGE_MARGIN * 2;

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
    this.stage = h('div', { class: 'board-stage', style: { width: STAGE + 'px', height: STAGE + 'px' } });
    this.board = h('div', { class: 'board', style: { left: STAGE_MARGIN + 'px', top: STAGE_MARGIN + 'px', width: BOARD + 'px', height: BOARD + 'px' } });
    this.gridEl = h('div', { class: 'board-grid' });
    this.axisLayer = h('div', { class: 'board-axes' },
      h('div', { class: 'axis-line axis-v' }), h('div', { class: 'axis-line axis-h' }));
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

  fit() {
    const w = this.host.clientWidth || 300;
    let size = w;
    const fitH = typeof this.opts.fitHeight === 'function' ? this.opts.fitHeight() : this.opts.fitHeight;
    if (fitH) {
      const top = this.host.getBoundingClientRect().top + window.scrollY;
      const avail = window.innerHeight - Math.max(0, top - window.scrollY) - (this.opts.bottomReserve?.() || 16);
      size = Math.min(w, Math.max(280, avail));
    }
    size = Math.min(size, this.opts.maxSize || 1140);
    const px = size * this.zoom;
    this.k = px / STAGE;
    this.stage.style.transform = `scale(${this.k})`;
    this.sizer.style.width = px + 'px';
    this.sizer.style.height = px + 'px';
    this.host.classList.toggle('zoomed', this.zoom > 1);
  }

  toUnits(clientX, clientY) {
    const r = this.board.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * BOARD, y: ((clientY - r.top) / r.height) * BOARD };
  }
  stageContains(clientX, clientY) {
    const r = this.stage.getBoundingClientRect();
    const v = this.host.getBoundingClientRect();
    return clientX >= Math.max(r.left, v.left) && clientX <= Math.min(r.right, v.right)
      && clientY >= Math.max(r.top, v.top) && clientY <= Math.min(r.bottom, v.bottom);
  }

  // 그리드 맞춤 + 사분면 안으로 제한 (단위: 1000)
  constrain(cx, cy, snap = this.state.doc?.grid?.snap) {
    const doc = this.state.doc;
    const s = doc.iconSize;
    if (snap) {
      const step = BOARD / (doc.grid.div || 10);
      cx = Math.round(cx / step) * step;
      cy = Math.round(cy / step) * step;
    }
    return { x: clamp(cx, s / 2, BOARD - s / 2) / BOARD, y: clamp(cy, s / 2, BOARD - s / 2) / BOARD };
  }

  render() {
    const { doc, chars, view, selected, showGrid, placing } = this.state;
    if (!doc) return;
    const s = doc.iconSize;

    // 그리드
    this.gridEl.hidden = !showGrid;
    const step = BOARD / (doc.grid?.div || 10);
    this.gridEl.style.backgroundSize = `${step}px ${step}px`;

    // 축 이름
    this.axisLabelLayer.replaceChildren(...axisLabelBoxes(doc.axes).map((ab) =>
      h('div', { class: 'axis-label', style: { left: ab.x + 'px', top: ab.y + 'px', width: ab.w + 'px', height: ab.h + 'px', lineHeight: ab.h + 'px' } }, ab.text)));

    // 아이콘
    const live = doc.items.filter((it) => chars.has(it.c));
    const seen = new Set();
    for (const it of live) {
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
        left: (it.x * BOARD - s / 2) + 'px', top: (it.y * BOARD - s / 2) + 'px',
        width: s + 'px', height: s + 'px', borderRadius: Math.round(s * 0.18) + 'px',
      });
      el.classList.toggle('selected', selected === it.c);
      el.classList.toggle('dragging', this.drag?.id === it.c && this.drag.moved);
    }
    for (const [id, el] of this.iconEls) if (!seen.has(id)) { el.remove(); this.iconEls.delete(id); }

    // 캡션
    let layout;
    if (this.drag?.moved && this.lastLayout.size) {
      layout = new Map(this.lastLayout);
      const b = layout.get(this.drag.id);
      const it = live.find((i) => i.c === this.drag.id);
      if (b && it) {
        const p = placeBox(b.dir, it.x * BOARD, it.y * BOARD, s, b.w, b.h);
        layout.set(this.drag.id, { ...b, x: p.x, y: p.y });
      }
    } else {
      layout = layoutCaptions({ items: doc.items, chars, view, iconSize: s, overrides: doc.captions?.[view] || {}, axes: doc.axes, prevDirs: this.prevDirs });
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
      const key = b.lines.map((l) => l.role + l.text).join('\u0001');
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
        this.drag = { id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, cx: it.x * BOARD, cy: it.y * BOARD, moved: false };
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
