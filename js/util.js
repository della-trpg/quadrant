// 작은 도구 모음. 사용자 글은 항상 텍스트 노드로만 넣어요 (innerHTML 금지).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round4 = (v) => Math.round(v * 10000) / 10000;

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function lsGet(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
}
export function lsDel(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

const PALETTE = ['#7A5A2E', '#3B5878', '#2F6A63', '#5C4675', '#7A3E3E', '#4B6A35', '#6A4E2A', '#35506A'];
export function colorFor(id) {
  let n = 0;
  for (const ch of String(id)) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[n % PALETTE.length];
}
export function initialOf(name) {
  const s = String(name || '?').replace(/[\[\]()]/g, '').trim();
  return Array.from(s)[0] || '?';
}

// 캐릭터의 기관·경력을 한 줄로 (둘 중 비어 있는 건 뺌)
export function charMeta(c) {
  return [c?.org, c?.career].filter(Boolean).join(' · ');
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function toast(msg, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(host); }
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  host.appendChild(t);
  while (host.children.length > 2) host.firstChild.remove();
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
}

// 브라우저 기본 confirm 대신 쓰는 확인 창
export function confirmDialog({ title, body, ok = '확인', cancel = '취소', danger = false }) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    const okBtn = h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', onclick: () => close(true) }, ok);
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(false); } },
      h('div', { class: 'modal modal-sm', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h2', { class: 'modal-title' }, title),
        body ? h('p', { class: 'modal-body' }, body) : null,
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => close(false) }, cancel), okBtn)));
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    okBtn.focus();
  });
}

export function icon(name, size = 18) {
  const paths = {
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 4H7l3-4z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    share: '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 13v7h14v-7"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
  };
  const span = document.createElement('span');
  span.className = 'ico';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  return span;
}

export function sanitizeFileName(s) {
  const base = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 40);
  return base || 'quadrant';
}
