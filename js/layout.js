// 사분면 배치 계산 (화면과 내보내기 이미지가 같은 결과를 쓰도록 한 곳에서 계산)
// 좌표 단위: 사분면 기본 크기 1000×1000. 가로·세로는 사분면마다 400~4000에서 바꿀 수 있음.
// 배치 위치(x, y)는 0~1 비율로 저장하므로 크기를 바꿔도 같은 자리에 비례해서 놓여요.

export const BOARD = 1000;                  // 기본 크기
export const SIZE_MIN = 400;
export const SIZE_MAX = 4000;
export const ICON_MIN = 24;
export const ICON_MAX = 400;
export const STAGE_MARGIN = 70;             // 사분면 바깥 여백 (캡션이 살짝 나가도 보이게)
export const FONT = '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
export const SERIF = '"Noto Serif KR", "AppleMyungjo", "Batang", serif';

export const TEXT_DEFAULT = { name: 24, desc: 19, axis: 22 };
export const TEXT_RANGE = { name: [10, 96], desc: [10, 80], axis: [10, 96] };

// 예전 코드 호환용 (기본 글자 크기 기준)
export const T = { nameSize: 24, descSize: 19 };

export const VIEWS = ['image', 'name', 'desc', 'desc_only'];
export const CAPTION_VIEWS = ['name', 'desc', 'desc_only'];
export const VIEW_LABEL = { image: '이미지만', name: '이름', desc: '이름+설명', desc_only: '설명만' };
export const DIRS = ['b', 't', 'r', 'l', 'br', 'bl', 'tr', 'tl'];
export const DIR_LABEL = { t: '위', b: '아래', l: '왼쪽', r: '오른쪽', tl: '왼쪽 위', tr: '오른쪽 위', bl: '왼쪽 아래', br: '오른쪽 아래' };
export const ALIGNS = ['left', 'center', 'right'];
export const VALIGNS = ['top', 'middle', 'bottom'];

export function defaultAlign(dir) {
  if (dir === 't' || dir === 'b') return 'center';
  if (dir === 'r' || dir === 'tr' || dir === 'br') return 'left';
  return 'right';
}

// ---- 사분면 크기와 글자 모양 ----
export function dims(doc) {
  return { w: doc?.board?.w || BOARD, h: doc?.board?.h || BOARD };
}

export function styleOf(doc) {
  const name = doc?.text?.name || TEXT_DEFAULT.name;
  const desc = doc?.text?.desc || TEXT_DEFAULT.desc;
  // 축 글자 크기를 따로 정하지 않은 예전 사분면은 이름 크기를 따라감
  const axis = doc?.text?.axis || Math.round(name * TEXT_DEFAULT.axis / TEXT_DEFAULT.name);
  return {
    nameSize: name,
    descSize: desc,
    lineH: 1.38,
    nameMaxW: Math.round(280 * name / TEXT_DEFAULT.name),
    descMaxW: Math.round(260 * desc / TEXT_DEFAULT.desc),
    gap: 8,
    axisSize: axis,
    axisPadX: 10,
    axisPadY: 5,
    axisInset: 14,
  };
}

// 그리드: 짧은 쪽을 div칸으로 나누고, 긴 쪽은 칸이 정사각형에 가깝도록 (짝수로 맞춰 가운데 축과 겹치게)
export function gridSteps(doc) {
  const { w, h } = dims(doc);
  const div = doc?.grid?.div || 10;
  const even = (n) => Math.max(2, 2 * Math.round(n / 2));
  const divX = w >= h ? even(div * w / h) : div;
  const divY = h > w ? even(div * h / w) : div;
  return { divX, divY, sx: w / divX, sy: h / divY };
}

export function nameFont(view, st = styleOf()) { return `${view === 'desc' ? 600 : 500} ${st.nameSize}px ${FONT}`; }
export function descFont(st = styleOf()) { return `400 ${st.descSize}px ${FONT}`; }
export function axisFont(st = styleOf()) { return `600 ${st.axisSize}px ${FONT}`; }

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

/**
 * 캡션 상자의 크기와 줄 목록. 보여줄 글이 없으면 null.
 * 줄 role: name(이름) / desc(이름 아래 설명) / note(설명만 보기의 설명 — 이름처럼 또렷한 색)
 */
export function captionContent(name, desc, view, st = styleOf()) {
  const lines = [];
  const d = (desc || '').trim();
  if (view === 'desc_only') {
    if (!d) return null;
    const df = descFont(st);
    for (const t of wrapText(d, st.descMaxW, df)) lines.push({ text: t, role: 'note', font: df, size: st.descSize });
  } else {
    const nf = nameFont(view, st);
    for (const t of wrapText(name, st.nameMaxW, nf)) lines.push({ text: t, role: 'name', font: nf, size: st.nameSize });
    if (view === 'desc' && d) {
      const df = descFont(st);
      for (const t of wrapText(d, st.descMaxW, df)) lines.push({ text: t, role: 'desc', font: df, size: st.descSize });
    }
  }
  let w = 0, hgt = 0;
  for (const l of lines) {
    l.w = measure(l.text, l.font);
    l.h = l.size * st.lineH;
    w = Math.max(w, l.w);
    hgt += l.h;
  }
  // 줄 위아래의 행간 여백 (세로 정렬 때 '글자' 끝을 아이콘 가장자리에 맞추려고 뺌)
  const leadTop = lines.length ? lines[0].size * (st.lineH - 1) / 2 : 0;
  const leadBot = lines.length ? lines[lines.length - 1].size * (st.lineH - 1) / 2 : 0;
  return { lines, w: Math.ceil(w) + 2, h: Math.ceil(hgt), leadTop, leadBot };
}

/**
 * 캡션 상자 위치. 아이콘 가장자리 기준으로 맞춤:
 *  - 위·아래 캡션: halign left = 상자 왼쪽 끝이 아이콘 왼쪽 끝과 일치, right = 오른쪽 끝끼리, 없으면 가운데
 *  - 왼쪽·오른쪽 캡션: valign top = 글 맨 위가 아이콘 위 가장자리와 일치, bottom = 아래끼리, 없으면 가운데
 */
export function placeBox(dir, cx, cy, s, w, hgt, gap = 8, halign = null, valign = null, leadTop = 0, leadBot = 0) {
  const g = gap, r = s / 2;
  const hx = halign === 'left' ? cx - r : halign === 'right' ? cx + r - w : cx - w / 2;
  const vy = valign === 'top' ? cy - r - leadTop : valign === 'bottom' ? cy + r - hgt + leadBot : cy - hgt / 2;
  switch (dir) {
    case 't': return { x: hx, y: cy - r - g - hgt };
    case 'r': return { x: cx + r + g, y: vy };
    case 'l': return { x: cx - r - g - w, y: vy };
    case 'tr': return { x: cx + r, y: cy - r - hgt };
    case 'tl': return { x: cx - r - w, y: cy - r - hgt };
    case 'br': return { x: cx + r, y: cy + r };
    case 'bl': return { x: cx - r - w, y: cy + r };
    default: return { x: hx, y: cy + r + g };
  }
}

// 이 방향에서 세로 정렬(위/가운데/아래)을 쓸 수 있는지
export const VALIGN_DIRS = ['l', 'r'];

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (w <= 0) return 0;
  const hh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return hh > 0 ? w * hh : 0;
}

// 축 이름 상자 (사분면 안쪽 끝, 축 선 위에 얹힘)
export function axisLabelBoxes(axes, st = styleOf(), W = BOARD, H = BOARD) {
  const f = axisFont(st);
  const res = [];
  const hgt = st.axisSize * 1.3 + st.axisPadY * 2;
  const mk = (key, text) => {
    const t = String(text || '').trim();
    if (!t) return;
    const w = Math.ceil(measure(t, f)) + st.axisPadX * 2;
    let x, y;
    if (key === 'top') { x = W / 2 - w / 2; y = st.axisInset; }
    else if (key === 'bottom') { x = W / 2 - w / 2; y = H - st.axisInset - hgt; }
    else if (key === 'left') { x = st.axisInset; y = H / 2 - hgt / 2; }
    else { x = W - st.axisInset - w; y = H / 2 - hgt / 2; }
    res.push({ key, text: t, x, y, w, h: hgt });
  };
  mk('top', axes?.top);
  mk('bottom', axes?.bottom);
  mk('left', axes?.left);
  mk('right', axes?.right);
  return res;
}

const DIR_PENALTY = { b: 0, t: 2, r: 3, l: 3, br: 6, bl: 6, tr: 7, tl: 7 };

/**
 * 캡션 자동 배치.
 * doc: 사분면 데이터 (크기·글자·아이콘 크기·축 이름을 여기서 읽음)
 * overrides: {charId: {dir?, align?, valign?}} (보기별), prevDirs: Map (안정성용)
 * 반환: Map(charId -> {dir, align, pinned, x, y, w, h, lines, bad})
 */
export function layoutCaptions({ doc, chars, view, overrides = {}, prevDirs }) {
  const out = new Map();
  if (!CAPTION_VIEWS.includes(view)) return out;
  const { w: W, h: H } = dims(doc);
  const st = styleOf(doc);
  const s = doc.iconSize;
  const live = doc.items.filter((it) => chars.has(it.c));
  const icons = live.map((it) => ({ id: it.c, x: it.x * W - s / 2, y: it.y * H - s / 2, w: s, h: s }));
  const axisBoxes = axisLabelBoxes(doc.axes, st, W, H);
  const AXIS_V = { x: W / 2 - 1, y: 0, w: 2, h: H };
  const AXIS_H = { x: 0, y: H / 2 - 1, w: W, h: 2 };
  const boardBox = { x: 0, y: 0, w: W, h: H };

  const content = new Map();
  const withText = [];
  for (const it of live) {
    const c = captionContent(chars.get(it.c).name, it.desc, view, st);
    if (c) { content.set(it.c, c); withText.push(it); }
  }

  const make = (it, dir) => {
    const c = content.get(it.c);
    const ov = overrides[it.c] || {};
    const halign = ALIGNS.includes(ov.align) ? ov.align : null;
    const valign = VALIGNS.includes(ov.valign) ? ov.valign : null;
    const p = placeBox(dir, it.x * W, it.y * H, s, c.w, c.h, st.gap, halign, valign, c.leadTop, c.leadBot);
    return { dir, x: p.x, y: p.y, w: c.w, h: c.h, lines: c.lines, halign, valign, leadTop: c.leadTop, leadBot: c.leadBot };
  };

  const cost = (it, box, placed) => {
    let hit = 0;
    for (const ic of icons) if (ic.id !== it.c) hit += overlap(box, ic);
    for (const [id, other] of placed) if (id !== it.c) hit += overlap(box, other);
    for (const ab of axisBoxes) hit += overlap(box, ab) * 0.8;
    // 축 선을 가로지르는 건 가벼운 감점 (읽을 수는 있지만 덜 깔끔함)
    const line = overlap(box, AXIS_V) + overlap(box, AXIS_H);
    const outside = (box.w * box.h - overlap(box, boardBox)) * 1.5;
    return { hit: hit + outside, total: hit + outside + line * 1.5 + DIR_PENALTY[box.dir] - ((prevDirs && prevDirs.get(it.c) === box.dir) ? 25 : 0) };
  };

  // 1) 고정한 캡션
  const autoItems = [];
  for (const it of withText) {
    const ov = overrides[it.c] || {};
    if (ov.dir && DIRS.includes(ov.dir)) {
      const b = make(it, ov.dir);
      b.pinned = true;
      b.align = ALIGNS.includes(ov.align) ? ov.align : defaultAlign(ov.dir);
      out.set(it.c, b);
    } else autoItems.push(it);
  }

  // 2) 붐비는 곳부터 자동 배치, 3번 다듬기
  const crowd = (it) => icons.reduce((n, ic) => n + (Math.hypot(ic.x + s / 2 - it.x * W, ic.y + s / 2 - it.y * H) < s * 3 ? 1 : 0), 0);
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
  for (const it of withText) {
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
  const fonts = [`400 20px ${FONT}`, `500 20px ${FONT}`, `600 20px ${FONT}`, `600 42px ${SERIF}`];
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
    board: { w: BOARD, h: BOARD, lock: false },
    text: { ...TEXT_DEFAULT },
    axes: { top: '', bottom: '', left: '', right: '' },
    iconSize: 88,
    grid: { show: true, snap: false, div: 10 },
    items: [],
    captions: { name: {}, desc: {}, desc_only: {} },
    export: { theme: 'dark', showAuthor: true, showGrid: false },
  };
}

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

// 저장된 데이터를 안전한 모양으로 정리 (빠진 칸 채우기, 잘못된 값 버리기)
export function normalizeDoc(raw) {
  const d = emptyDoc();
  if (!raw || typeof raw !== 'object') return d;
  if (raw.board && typeof raw.board === 'object') {
    d.board.w = clampInt(raw.board.w, SIZE_MIN, SIZE_MAX, BOARD);
    d.board.h = clampInt(raw.board.h, SIZE_MIN, SIZE_MAX, BOARD);
    d.board.lock = !!raw.board.lock;
  }
  if (raw.text && typeof raw.text === 'object') {
    d.text.name = clampInt(raw.text.name, ...TEXT_RANGE.name, TEXT_DEFAULT.name);
    d.text.desc = clampInt(raw.text.desc, ...TEXT_RANGE.desc, TEXT_DEFAULT.desc);
    // 축 글자를 따로 정한 적 없는 예전 데이터는 이름 크기에 맞춰 채움
    d.text.axis = raw.text.axis !== undefined
      ? clampInt(raw.text.axis, ...TEXT_RANGE.axis, TEXT_DEFAULT.axis)
      : Math.round(d.text.name * TEXT_DEFAULT.axis / TEXT_DEFAULT.name);
  }
  for (const k of ['top', 'bottom', 'left', 'right']) {
    if (typeof raw.axes?.[k] === 'string') d.axes[k] = raw.axes[k].slice(0, 20);
  }
  const sz = Number(raw.iconSize);
  if (sz >= ICON_MIN && sz <= ICON_MAX) d.iconSize = Math.round(sz);
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
  for (const v of CAPTION_VIEWS) {
    const src = raw.captions?.[v];
    if (src && typeof src === 'object') {
      for (const [id, ov] of Object.entries(src)) {
        if (!seen.has(id) || !ov || typeof ov !== 'object') continue;
        const o = {};
        if (DIRS.includes(ov.dir)) o.dir = ov.dir;
        if (ALIGNS.includes(ov.align)) o.align = ov.align;
        if (VALIGNS.includes(ov.valign)) o.valign = ov.valign;
        if (o.dir || o.align || o.valign) d.captions[v][id] = o;
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
  for (const v of CAPTION_VIEWS) {
    d.captions[v] = d.captions[v] || {};
    for (const id of Object.keys(d.captions[v])) if (!ids.has(id)) delete d.captions[v][id];
  }
  for (const k of Object.keys(d.axes)) d.axes[k] = d.axes[k].trim().slice(0, 20);
  return d;
}
