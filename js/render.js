// 캔버스 그리기: 이미지 내보내기 + 목록 썸네일
import { BOARD, STAGE_MARGIN, T, FONT, SERIF, axisFont, axisLabelBoxes, layoutCaptions } from './layout.js';
import { colorFor, initialOf } from './util.js';

export const THEMES = {
  dark: {
    label: '어둡게',
    bg: '#14151F', board: '#1B1D2B', boardEdge: '#34364B', axis: '#5A5C75', grid: '#262838',
    name: '#ECE6D8', desc: '#CFC9DA', axisText: '#D9B26A', axisPill: '#1B1D2B',
    title: '#ECE6D8', sub: '#A9A3B5', credit: '#5E5B6E', iconEdge: '#14151F',
  },
  light: {
    label: '밝게',
    bg: '#FBFAF7', board: '#F2EFE8', boardEdge: '#D8D3C8', axis: '#BDB7AA', grid: '#E6E1D6',
    name: '#22212B', desc: '#45424F', axisText: '#8A6A2C', axisPill: '#F2EFE8',
    title: '#22212B', sub: '#6B6778', credit: '#B3AFA6', iconEdge: '#FBFAF7',
  },
  mono: {
    label: '흑백',
    bg: '#FFFFFF', board: '#FFFFFF', boardEdge: '#222222', axis: '#222222', grid: '#E8E8E8',
    name: '#111111', desc: '#555555', axisText: '#111111', axisPill: '#FFFFFF',
    title: '#111111', sub: '#777777', credit: '#B0B0B0', iconEdge: '#FFFFFF',
  },
};

function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawIcon(ctx, ch, cx, cy, s, theme) {
  const x = cx - s / 2, y = cy - s / 2, r = s * 0.18;
  ctx.save();
  roundRect(ctx, x, y, s, s, r);
  ctx.clip();
  const img = ch.img;
  if (img && img.complete && img.naturalWidth) {
    const iw = img.naturalWidth, ih = img.naturalHeight, side = Math.min(iw, ih);
    ctx.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, x, y, s, s);
  } else {
    ctx.fillStyle = colorFor(ch.id);
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#ECE6D8';
    ctx.font = `600 ${Math.round(s * 0.4)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initialOf(ch.name), cx, cy + s * 0.02);
  }
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, s, s, r);
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.iconEdge;
  ctx.stroke();
  ctx.restore();
}

// 사분면 하나를 (ox, oy)에 그림. 단위 = BOARD 좌표 (ctx 배율은 호출하는 쪽에서)
export function drawBoard(ctx, { doc, chars, view, theme, showGrid, ox = 0, oy = 0, captions }) {
  const th = THEMES[theme] || THEMES.dark;
  ctx.save();
  ctx.translate(ox, oy);

  ctx.fillStyle = th.board;
  ctx.fillRect(0, 0, BOARD, BOARD);

  if (showGrid) {
    const div = doc.grid?.div || 10;
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < div; i++) {
      const p = Math.round((BOARD / div) * i) + 0.5;
      ctx.moveTo(p, 0); ctx.lineTo(p, BOARD);
      ctx.moveTo(0, p); ctx.lineTo(BOARD, p);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = th.axis;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(BOARD / 2, 0); ctx.lineTo(BOARD / 2, BOARD);
  ctx.moveTo(0, BOARD / 2); ctx.lineTo(BOARD, BOARD / 2);
  ctx.stroke();

  ctx.strokeStyle = th.boardEdge;
  ctx.lineWidth = theme === 'mono' ? 2 : 1;
  ctx.strokeRect(0.5, 0.5, BOARD - 1, BOARD - 1);

  // 축 이름
  ctx.font = axisFont();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (const ab of axisLabelBoxes(doc.axes)) {
    ctx.fillStyle = th.axisPill;
    roundRect(ctx, ab.x, ab.y, ab.w, ab.h, 6);
    ctx.fill();
    ctx.fillStyle = th.axisText;
    ctx.fillText(ab.text, ab.x + ab.w / 2, ab.y + ab.h / 2 + 1);
  }

  // 아이콘
  const s = doc.iconSize;
  for (const it of doc.items) {
    const ch = chars.get(it.c);
    if (!ch) continue;
    drawIcon(ctx, ch, it.x * BOARD, it.y * BOARD, s, th);
  }

  // 캡션
  const caps = captions || layoutCaptions({
    items: doc.items, chars, view, iconSize: s,
    overrides: doc.captions?.[view] || {}, axes: doc.axes,
  });
  ctx.textBaseline = 'top';
  for (const [, b] of caps) {
    let y = b.y;
    for (const ln of b.lines) {
      ctx.font = ln.font;
      ctx.fillStyle = ln.role === 'name' ? th.name : th.desc;
      let x = b.x, align = 'left';
      if (b.align === 'center') { x = b.x + b.w / 2; align = 'center'; }
      else if (b.align === 'right') { x = b.x + b.w; align = 'right'; }
      ctx.textAlign = align;
      ctx.fillText(ln.text, x, y + (ln.h - ln.size) / 2);
      y += ln.h;
    }
  }
  ctx.restore();
}

/** 내보내기용 캔버스 만들기 */
export function renderExport({ doc, chars, view, theme, showGrid, showAuthor, title, author, siteLabel, pixelRatio = 1.5 }) {
  const th = THEMES[theme] || THEMES.dark;
  const M = STAGE_MARGIN;
  const W = BOARD + M * 2;
  const hasTitle = !!(title && title.trim());
  const hasAuthor = !!(showAuthor && author);
  let headerH = 0;
  if (hasTitle) headerH += 60;
  if (hasAuthor) headerH += 34;
  const boardTop = headerH ? 44 + headerH + 26 : M;
  const H = boardTop + BOARD + M + 10;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * pixelRatio);
  canvas.height = Math.round(H * pixelRatio);
  const ctx = canvas.getContext('2d');
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);

  let y = 44;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (hasTitle) {
    ctx.fillStyle = th.title;
    ctx.font = `600 42px ${SERIF}`;
    ctx.fillText(title.trim(), W / 2, y, W - 80);
    y += 60;
  }
  if (hasAuthor) {
    ctx.fillStyle = th.sub;
    ctx.font = `400 19px ${FONT}`;
    ctx.fillText(`by ${author}`, W / 2, y, W - 80);
  }

  drawBoard(ctx, { doc, chars, view, theme, showGrid, ox: M, oy: boardTop });

  if (siteLabel) {
    ctx.fillStyle = th.credit;
    ctx.font = `400 15px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(siteLabel, W - 26, H - 20);
  }
  return canvas;
}

/** 목록 썸네일 (이미지만, 정사각형) */
export function renderThumb({ doc, chars, size = 280, theme = 'dark' }) {
  const canvas = document.createElement('canvas');
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  const ctx = canvas.getContext('2d');
  const k = (size * ratio) / BOARD;
  ctx.scale(k, k);
  drawBoard(ctx, { doc, chars, view: 'image', theme, showGrid: false });
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했어요.'))), 'image/png');
  });
}

export const T_EXPORT = T;
