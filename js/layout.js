// 사분면 배치 계산 (화면과 내보내기 이미지가 같은 결과를 쓰도록 한 곳에서 계산)
// 좌표 단위: 사분면 한 변 = 1000

export const BOARD = 1000;
export const STAGE_MARGIN = 70;          // 사분면 바깥 여백 (캡션이 살짝 나가도 보이게)
export const FONT = '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
export const SERIF = '"Noto Serif KR", "AppleMyungjo", "Batang", serif';

export const T = {
  nameSize: 24,
  descSize: 19,
  lineH: 1.38,
  nameMaxW: 280,
  descMaxW: 260,
  gap: 8,
  axisSize: 22,
  axisPadX: 10,
  axisPadY: 5,
  axisInset: 14,
};

export const VIEWS = ['image', 'name', 'desc'];
export const VIEW_LABEL = { image: '이미지만', name: '이름', desc: '이름+설명' };
export const DIRS = ['b', 't', 'r', 'l', 'br', 'bl', 'tr', 'tl'];
export const DIR_LABEL = { t: '위', b: '아래', l: '왼쪽', r: '오른쪽', tl: '왼쪽 위', tr: '오른쪽 위', bl: '왼쪽 아래', br: '오른쪽 아래' };
export const ALIGNS = ['left', 'center', 'right'];

export function defaultAlign(dir) {
  if (dir === 't' || dir === 'b') return 'center';
  if (dir === 'r' || dir === 'tr' || dir === 'br') return 'left';
  return 'right';
}

export function nameFont(view) { return `${view === 'desc' ? 600 : 500} ${T.nameSize}px ${FONT}`; }
export function descFont() { return `400 ${T.descSize}px ${FONT}`; }
export function axisFont() { return `600 ${T.axisSize}px ${FONT}`; }

// ---- 글자 너비 재기 (캔버스로 재서 화면·이미지 모두 같은 값) ----
let mctx = null;
const mcache = new Map();
export function measure(text, font) {
  const key = font + '\u0001' + text;
  let w = mcache.get(key);
  if (w !== undefined) return w;
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = font;
  w = mctx.measureText(text).width;
  if (mcache.size > 5000) mcache.clear();
  mcache.set(key, w);
  return w;
}
export function clearMeasureCache() { mcache.clear(); }

// 줄바꿈: 띄어쓰기 기준, 한 단어가 너무 길면 글자 단위로 자름
export function wrapText(text, maxW, font) {
  const out = [];
  const paras = String(text || '').split(/\n/);
  for (const para of paras) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    for (const word of words) {
      const cand = line + word;
      if (measure(cand.trimEnd(), font) <= maxW) { line = cand; continue; }
      if (line.trim()) { out.push(line.trim()); line = ''; }
      if (/^\s+$/.test(word)) continue;
      if (measure(word, font) <= maxW) { line = word; continue; }
      for (const ch of Array.from(word)) {
        if (measure(line + ch, font) > maxW && line) { out.push(line); line = ch; } else line += ch;
      }
    }
    if (line.trim()) out.push(line.trim());
  }
  return out.length ? out : [''];
}

// 캡션 상자의 크기와 줄 목록
export function captionContent(name, desc, view) {
  const lines = [];
  const nf = nameFont(view);
  for (const t of wrapText(name, T.nameMaxW, nf)) lines.push({ text: t, role: 'name', font: nf, size: T.nameSize });
  if (view === 'desc' && desc && desc.trim()) {
    const df = descFont();
    for (const t of wrapText(desc.trim(), T.descMaxW, df)) lines.push({ text: t, role: 'desc', font: df, size: T.descSize });
  }
  let w = 0, hgt = 0;
  for (const l of lines) {
    l.w = measure(l.text, l.font);
    l.h = l.size * T.lineH;
    w = Math.max(w, l.w);
    hgt += l.h;
  }
  return { lines, w: Math.ceil(w) + 2, h: Math.ceil(hgt) };
}

export function placeBox(dir, cx, cy, s, w, hgt) {
  const g = T.gap, r = s / 2;
  switch (dir) {
    case 't': return { x: cx - w / 2, y: cy - r - g - hgt };
    case 'r': return { x: cx + r + g, y: cy - hgt / 2 };
    case 'l': return { x: cx - r - g - w, y: cy - hgt / 2 };
    case 'tr': return { x: cx + r, y: cy - r - hgt };
    case 'tl': return { x: cx - r - w, y: cy - r - hgt };
    case 'br': return { x: cx + r, y: cy + r };
    case 'bl': return { x: cx - r - w, y: cy + r };
    default: return { x: cx - w / 2, y: cy + r + g };
  }
}

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (w <= 0) return 0;
  const hh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return hh > 0 ? w * hh : 0;
}
function outside(a) {
  const inner = overlap(a, { x: 0, y: 0, w: BOARD, h: BOARD });
  return a.w * a.h - inner;
}

// 축 이름 상자 (사분면 안쪽 끝, 축 선 위에 얹힘)
export function axisLabelBoxes(axes) {
  const f = axisFont();
  const res = [];
  const hgt = T.axisSize * 1.3 + T.axisPadY * 2;
  const mk = (key, text, place) => {
    const t = String(text || '').trim();
    if (!t) return;
    const w = Math.ceil(measure(t, f)) + T.axisPadX * 2;
    let x, y;
    if (place === 'top') { x = BOARD / 2 - w / 2; y = T.axisInset; }
    else if (place === 'bottom') { x = BOARD / 2 - w / 2; y = BOARD - T.axisInset - hgt; }
    else if (place === 'left') { x = T.axisInset; y = BOARD / 2 - hgt / 2; }
    else { x = BOARD - T.axisInset - w; y = BOARD / 2 - hgt / 2; }
    res.push({ key, text: t, x, y, w, h: hgt });
  };
  mk('top', axes?.top, 'top');
  mk('bottom', axes?.bottom, 'bottom');
  mk('left', axes?.left, 'left');
  mk('right', axes?.right, 'right');
  return res;
}

const DIR_PENALTY = { b: 0, t: 2, r: 3, l: 3, br: 6, bl: 6, tr: 7, tl: 7 };
const AXIS_V = { x: BOARD / 2 - 1, y: 0, w: 2, h: BOARD };
const AXIS_H = { x: 0, y: BOARD / 2 - 1, w: BOARD, h: 2 };

/**
 * 캡션 자동 배치.
 * items: [{c, x, y, desc}] (x,y는 0~1), chars: Map(id -> {name})
 * overrides: {charId: {dir?, align?}} (보기별), prevDirs: Map (안정성용)
 * 반환: Map(charId -> {dir, align, pinned, x, y, w, h, lines, bad})
 */
export function layoutCaptions({ items, chars, view, iconSize, overrides = {}, axes, prevDirs }) {
  const out = new Map();
  if (view === 'image') return out;
  const s = iconSize;
  const live = items.filter((it) => chars.has(it.c));
  const icons = live.map((it) => ({ id: it.c, x: it.x * BOARD - s / 2, y: it.y * BOARD - s / 2, w: s, h: s }));
  const axisBoxes = axisLabelBoxes(axes);
  const content = new Map();
  for (const it of live) content.set(it.c, captionContent(chars.get(it.c).name, it.desc, view));

  const make = (it, dir) => {
    const c = content.get(it.c);
    const p = placeBox(dir, it.x * BOARD, it.y * BOARD, s, c.w, c.h);
    return { dir, x: p.x, y: p.y, w: c.w, h: c.h, lines: c.lines };
  };

  const cost = (it, box, placed) => {
    let hit = 0;
    for (const ic of icons) if (ic.id !== it.c) hit += overlap(box, ic);
    for (const [id, other] of placed) if (id !== it.c) hit += overlap(box, other);
    for (const ab of axisBoxes) hit += overlap(box, ab) * 0.8;
    // 축 선을 가로지르는 건 가벼운 감점 (읽을 수는 있지만 덜 깔끔함)
    const line = overlap(box, AXIS_V) + overlap(box, AXIS_H);
    const out = outside(box) * 1.5;
    return { hit: hit + out, total: hit + out + line * 1.5 + DIR_PENALTY[box.dir] - ((prevDirs && prevDirs.get(it.c) === box.dir) ? 25 : 0) };
  };

  // 1) 고정한 캡션
  const autoItems = [];
  for (const it of live) {
    const ov = overrides[it.c] || {};
    if (ov.dir && DIRS.includes(ov.dir)) {
      const b = make(it, ov.dir);
      b.pinned = true;
      b.align = ALIGNS.includes(ov.align) ? ov.align : defaultAlign(ov.dir);
      out.set(it.c, b);
    } else autoItems.push(it);
  }

  // 2) 붐비는 곳부터 자동 배치, 3번 다듬기
  const crowd = (it) => icons.reduce((n, ic) => n + (Math.hypot(ic.x + s / 2 - it.x * BOARD, ic.y + s / 2 - it.y * BOARD) < s * 3 ? 1 : 0), 0);
  autoItems.sort((a, b) => crowd(b) - crowd(a));
  for (let pass = 0; pass < 3; pass++) {
    for (const it of autoItems) {
      out.delete(it.c);
      let best = null, bestCost = null;
      for (const dir of DIRS) {
        const b = make(it, dir);
        const c = cost(it, b, out);
        if (!best || c.total < bestCost.total) { best = b; bestCost = c; }
      }
      const ov = overrides[it.c] || {};
      best.align = ALIGNS.includes(ov.align) ? ov.align : defaultAlign(best.dir);
      best.pinned = false;
      out.set(it.c, best);
    }
  }

  // 3) 겹침 표시
  for (const it of live) {
    const b = out.get(it.c);
    b.bad = cost(it, b, out).hit > 4;
    if (prevDirs) prevDirs.set(it.c, b.dir);
  }
  return out;
}

// 이미지로 그리기 전에, 들어갈 글자들의 웹폰트 조각을 미리 내려받기
export async function ensureFontsFor(texts) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const s = Array.from(new Set(texts.filter(Boolean).join(' '))).join('');
  if (!s.trim()) return;
  const fonts = [nameFont('name'), nameFont('desc'), descFont(), axisFont(),
    `600 42px ${SERIF}`, `400 19px ${FONT}`, `400 15px ${FONT}`];
  await Promise.race([
    Promise.all(fonts.map((f) => document.fonts.load(f, s).catch(() => null))),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
  clearMeasureCache();
}

export function docTexts(doc, chars, extra = []) {
  const out = [...extra, ...Object.values(doc.axes || {})];
  for (const it of doc.items) {
    const ch = chars.get(it.c);
    if (ch) out.push(ch.name);
    if (it.desc) out.push(it.desc);
  }
  return out;
}

export function emptyDoc() {
  return {
    v: 1,
    axes: { top: '', bottom: '', left: '', right: '' },
    iconSize: 88,
    grid: { show: true, snap: false, div: 10 },
    items: [],
    captions: { name: {}, desc: {} },
    export: { theme: 'dark', showAuthor: true, showGrid: false },
  };
}

// 저장된 데이터를 안전한 모양으로 정리 (빠진 칸 채우기, 잘못된 값 버리기)
export function normalizeDoc(raw) {
  const d = emptyDoc();
  if (!raw || typeof raw !== 'object') return d;
  for (const k of ['top', 'bottom', 'left', 'right']) {
    if (typeof raw.axes?.[k] === 'string') d.axes[k] = raw.axes[k].slice(0, 20);
  }
  const sz = Number(raw.iconSize);
  if (sz >= 48 && sz <= 160) d.iconSize = Math.round(sz);
  if (raw.grid && typeof raw.grid === 'object') {
    d.grid.show = raw.grid.show !== false;
    d.grid.snap = !!raw.grid.snap;
    d.grid.div = [8, 10, 12, 20].includes(raw.grid.div) ? raw.grid.div : 10;
  }
  const seen = new Set();
  if (Array.isArray(raw.items)) {
    for (const it of raw.items.slice(0, 100)) {
      if (!it || typeof it.c !== 'string' || seen.has(it.c)) continue;
      const x = Number(it.x), y = Number(it.y);
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) continue;
      seen.add(it.c);
      d.items.push({ c: it.c.slice(0, 40), x, y, desc: typeof it.desc === 'string' ? it.desc.slice(0, 60) : '' });
    }
  }
  for (const v of ['name', 'desc']) {
    const src = raw.captions?.[v];
    if (src && typeof src === 'object') {
      for (const [id, ov] of Object.entries(src)) {
        if (!seen.has(id) || !ov || typeof ov !== 'object') continue;
        const o = {};
        if (DIRS.includes(ov.dir)) o.dir = ov.dir;
        if (ALIGNS.includes(ov.align)) o.align = ov.align;
        if (o.dir || o.align) d.captions[v][id] = o;
      }
    }
  }
  if (raw.export && typeof raw.export === 'object') {
    d.export.theme = ['dark', 'light', 'mono'].includes(raw.export.theme) ? raw.export.theme : 'dark';
    d.export.showAuthor = raw.export.showAuthor !== false;
    d.export.showGrid = !!raw.export.showGrid;
  }
  return d;
}

// 저장용: 빈 설명·쓰이지 않는 캡션 설정 정리
export function compactDoc(doc) {
  const d = JSON.parse(JSON.stringify(doc));
  d.items = d.items.map((it) => {
    const o = { c: it.c, x: Math.round(it.x * 10000) / 10000, y: Math.round(it.y * 10000) / 10000 };
    if (it.desc && it.desc.trim()) o.desc = it.desc.trim().slice(0, 60);
    return o;
  });
  const ids = new Set(d.items.map((i) => i.c));
  for (const v of ['name', 'desc']) {
    for (const id of Object.keys(d.captions[v])) if (!ids.has(id)) delete d.captions[v][id];
  }
  for (const k of Object.keys(d.axes)) d.axes[k] = d.axes[k].trim().slice(0, 20);
  return d;
}
