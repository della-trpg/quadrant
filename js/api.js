// 데이터 접근: Supabase(실제) / 데모(이 브라우저에만 저장)
import { CONFIG } from '../config.js';
import { lsGet, lsSet, colorFor } from './util.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

function friendlyError(err) {
  const msg = String(err?.message || err || '');
  if (/row-level security|permission denied|42501/i.test(msg)) return '권한이 없어요.';
  if (/JWT|token|session/i.test(msg)) return '로그인이 만료됐어요. 다시 로그인해 주세요.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  if (/[가-힣]/.test(msg)) return msg;           // DB에서 보낸 한국어 안내는 그대로
  return '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.';
}
export class ApiError extends Error {
  constructor(raw) { super(friendlyError(raw)); this.raw = raw; }
}

async function pool(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
  });
  await Promise.all(workers);
  return out;
}

// ======================================================================
// Supabase
// ======================================================================
export class SupabaseApi {
  constructor() { this.demo = false; this.user = null; this.objectUrls = []; }

  async init() {
    const { createClient } = await import(SUPABASE_ESM);
    this.sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
    const { data, error } = await this.sb.auth.getSession();
    if (error) throw new ApiError(error);
    this.user = data.session?.user || null;
    // 로그인 후 주소에 남은 ?code= 정리
    const url = new URL(location.href);
    if (url.searchParams.has('code') || url.searchParams.has('error')) {
      url.searchParams.delete('code'); url.searchParams.delete('error'); url.searchParams.delete('error_description');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }

  onAuthChange(cb) {
    this.sb.auth.onAuthStateChange((event, session) => {
      const before = this.user?.id || null;
      this.user = session?.user || null;
      if ((this.user?.id || null) !== before) cb();
    });
  }

  async signInWithGoogleRedirect() {
    const redirectTo = location.origin + location.pathname;
    const { error } = await this.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) throw new ApiError(error);
  }

  // 구글 공식 버튼(팝업) — 로그인 창에 della-trpg.github.io가 보이는 방식
  async renderGoogleButton(el, onError) {
    if (!CONFIG.GOOGLE_CLIENT_ID) return false;
    await loadScript('https://accounts.google.com/gsi/client');
    const raw = randomString(32);
    const hashed = await sha256Hex(raw);
    window.google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      nonce: hashed,
      use_fedcm_for_prompt: true,
      callback: async ({ credential }) => {
        const { error } = await this.sb.auth.signInWithIdToken({ provider: 'google', token: credential, nonce: raw });
        if (error) onError?.(new ApiError(error).message);
      },
    });
    window.google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', locale: 'ko' });
    return true;
  }

  async signOut() { await this.sb.auth.signOut(); this.user = null; }

  async getProfile() {
    if (!this.user) return null;
    const { data, error } = await this.sb.from('profiles').select('nickname, is_admin').eq('id', this.user.id).maybeSingle();
    if (error) throw new ApiError(error);
    return data ? { nickname: data.nickname || '', isAdmin: !!data.is_admin } : null;
  }

  async setNickname(nickname) {
    const existing = await this.getProfile();
    const q = existing
      ? this.sb.from('profiles').update({ nickname }).eq('id', this.user.id)
      : this.sb.from('profiles').insert({ id: this.user.id, nickname });
    const { error } = await q;
    if (error) {
      if (/duplicate|unique/i.test(error.message)) throw new ApiError('이미 쓰이고 있는 닉네임이에요.');
      throw new ApiError(error);
    }
  }

  async hasAccess(world) {
    const { data, error } = await this.sb.rpc('has_world_access', { p_world: world });
    if (error) throw new ApiError(error);
    return !!data;
  }

  async redeemCode(code) {
    const { data, error } = await this.sb.rpc('redeem_world_code', { p_code: code });
    if (error) throw new ApiError(error);
    return data || { ok: false, reason: 'invalid' };
  }

  async getWorld(world) {
    const { data, error } = await this.sb.from('worlds').select('id, name').eq('id', world).maybeSingle();
    if (error) throw new ApiError(error);
    return data;
  }

  // 내가 들어갈 수 있는 세계관만 돌아옴 (서버 규칙이 거름. 관리자는 전부)
  async listWorlds() {
    const { data, error } = await this.sb.from('worlds').select('id, name').order('created_at', { ascending: true });
    if (error) throw new ApiError(error);
    return data || [];
  }

  async listCharacters(world) {
    const { data, error } = await this.sb.from('world_characters')
      .select('char_id, name, org_label, career_label, image_path, sort_order')
      .eq('world_id', world).eq('active', true)
      .order('sort_order', { ascending: true }).order('name', { ascending: true });
    if (error) throw new ApiError(error);
    const bucket = this.sb.storage.from('world-assets');
    return pool(data || [], 6, async (r) => {
      let url = null;
      if (r.image_path) {
        const { data: blob } = await bucket.download(r.image_path);
        if (blob) { url = URL.createObjectURL(blob); this.objectUrls.push(url); }
      }
      return { id: r.char_id, name: r.name, org: r.org_label || '', career: r.career_label || '', url };
    });
  }

  async attachNicknames(rows) {
    const ids = [...new Set(rows.map((r) => r.owner_id))];
    if (!ids.length) return rows;
    const { data } = await this.sb.from('profiles').select('id, nickname').in('id', ids);
    const map = new Map((data || []).map((p) => [p.id, p.nickname]));
    for (const r of rows) r.author = map.get(r.owner_id) || '익명';
    return rows;
  }

  async listQuadrants({ world, scope, from = 0, limit = 24 }) {
    let q = this.sb.from('quadrants')
      .select('id, owner_id, title, default_view, visibility, data, created_at, updated_at')
      .eq('world_id', world)
      .order('updated_at', { ascending: false })
      .range(from, from + limit - 1);
    q = scope === 'mine' ? q.eq('owner_id', this.user.id) : q.eq('visibility', 'public');
    const { data, error } = await q;
    if (error) throw new ApiError(error);
    return this.attachNicknames(data || []);
  }

  async getQuadrant(id) {
    const { data, error } = await this.sb.from('quadrants')
      .select('id, owner_id, world_id, title, default_view, visibility, data, created_at, updated_at')
      .eq('id', id).maybeSingle();
    if (error) throw new ApiError(error);
    if (!data) return null;
    return (await this.attachNicknames([data]))[0];
  }

  async saveQuadrant({ id, world, title, default_view, visibility, data }) {
    const row = { title, default_view, visibility, data };
    const q = id
      ? this.sb.from('quadrants').update(row).eq('id', id)
      : this.sb.from('quadrants').insert({ ...row, world_id: world });
    const { data: saved, error } = await q.select('id, owner_id, world_id, title, default_view, visibility, data, created_at, updated_at').maybeSingle();
    if (error) throw new ApiError(error);
    if (!saved) throw new ApiError('권한이 없어요.');
    return saved;
  }

  async deleteQuadrant(id) {
    const { data, error } = await this.sb.from('quadrants').delete().eq('id', id).select('id');
    if (error) throw new ApiError(error);
    if (!data || !data.length) throw new ApiError('삭제할 권한이 없어요.');
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`) && window.google?.accounts) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('구글 로그인 버튼을 불러오지 못했어요.'));
    document.head.appendChild(s);
  });
}
function randomString(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ======================================================================
// 데모 (서버 없이 미리 보기)
// ======================================================================
const DEMO_KEY = 'quadrant-demo:v2';
const DEMO_WORLDS = [
  { id: 'SP1', name: '[특별 세계관 이름]', letters: 'ABCDEFGHIJKLMN', orgs: ['[기관 A]', '[기관 B]', '[기관 C]'], careers: ['[경력 1]', '[경력 2]', '[경력 3]', '[경력 4]'], prefix: '캐릭터', code: 'DEMOCODE0000' },
  { id: 'SP2', name: '두 번째 세계관 (데모)', letters: 'PQRSTUVW', orgs: ['[결사 1]', '[결사 2]'], careers: ['[역할 1]', '[역할 2]', '[역할 3]'], prefix: '인물', code: 'DEMOCODE0002' },
];
const DEMO_ME = 'demo-me';
const DEMO_OTHER = 'demo-other';

function demoImage(letter, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, color);
  grad.addColorStop(1, '#14151F');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(236,230,216,0.12)';
  g.beginPath(); g.arc(128, 300, 120, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(128, 112, 56, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ECE6D8';
  g.font = '600 96px "IBM Plex Sans KR", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 128, 118);
  return c.toDataURL('image/png');
}

function demoSeed() {
  const now = Date.now();
  const mk = (id, title, view, items, axes, captions = { name: {}, desc: {} }, ago = 1, world = 'SP1') => ({
    id, owner_id: DEMO_OTHER, world_id: world, title, default_view: view, visibility: 'public',
    created_at: new Date(now - ago * 86400000).toISOString(), updated_at: new Date(now - ago * 86400000).toISOString(),
    data: { v: 1, axes, iconSize: 88, grid: { show: true, snap: false, div: 10 }, items, captions,
      export: { theme: 'dark', showAuthor: true, showGrid: false } },
  });
  return [
    mk('demo-1', '이 사람들의 결정 방식', 'desc', [
      { c: 'D_A', x: 0.2, y: 0.18, desc: '규칙이 곧 마음의 평화.' },
      { c: 'D_B', x: 0.36, y: 0.36, desc: '계산은 빠른데 결론은 늘 남 편.' },
      { c: 'D_C', x: 0.72, y: 0.2, desc: '회의에선 늘 반대표. 결론은 끝까지 따른다.' },
      { c: 'D_D', x: 0.86, y: 0.42, desc: '모두의 일정표를 외우고 있다.' },
      { c: 'D_E', x: 0.24, y: 0.72, desc: '마음 가는 대로, 혼자서.' },
      { c: 'D_F', x: 0.6, y: 0.64, desc: '누군가 울면 같이 운다.' },
      { c: 'D_G', x: 0.84, y: 0.84, desc: '동료를 위해서라면 이성은 잠시 내려둔다.' },
    ], { top: '이성', bottom: '감정', left: '개인', right: '공동체' }, { name: {}, desc: { D_C: { dir: 'l' } } }, 2),
    mk('demo-2', '아침형 인간 판별', 'name', [
      { c: 'D_H', x: 0.15, y: 0.2 }, { c: 'D_I', x: 0.42, y: 0.12 }, { c: 'D_J', x: 0.8, y: 0.3 },
      { c: 'D_K', x: 0.3, y: 0.55 }, { c: 'D_L', x: 0.66, y: 0.78 }, { c: 'D_A', x: 0.9, y: 0.9 },
    ], { top: '아침형', bottom: '저녁형', left: '커피', right: '차' }, undefined, 5),
    mk('demo-3', '두 번째 세계관의 첫 사분면', 'name', [
      { c: 'D_P', x: 0.25, y: 0.3 }, { c: 'D_Q', x: 0.7, y: 0.25 }, { c: 'D_R', x: 0.4, y: 0.75 }, { c: 'D_S', x: 0.8, y: 0.7 },
    ], { top: '질서', bottom: '혼돈', left: '고독', right: '연대' }, undefined, 3, 'SP2'),
  ];
}

export class DemoApi {
  constructor({ locked = false } = {}) {
    this.demo = true;
    this.user = null;
    this.locked = locked;
    this.mem = null;
  }
  async init() {
    this.user = { id: DEMO_ME };
    const saved = lsGet(DEMO_KEY);
    this.mem = saved && Array.isArray(saved.rows) && Array.isArray(saved.access)
      ? saved
      : { rows: demoSeed(), access: this.locked ? [] : ['SP1'], nickname: '나 (데모)' };
    this.persist();
  }
  persist() { lsSet(DEMO_KEY, this.mem); }
  wait(ms = 120) { return new Promise((r) => setTimeout(r, ms)); }
  onAuthChange() {}
  async renderGoogleButton() { return false; }
  async signInWithGoogleRedirect() { this.user = { id: DEMO_ME }; }
  async signOut() { this.user = null; }
  async getProfile() { return this.user ? { nickname: this.mem.nickname, isAdmin: false } : null; }
  async setNickname(n) { this.mem.nickname = n; this.persist(); }
  has(world) { return this.mem.access.includes(world); }
  async hasAccess(world) { await this.wait(); return this.has(world); }
  async redeemCode(code) {
    await this.wait(300);
    const norm = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const w = DEMO_WORLDS.find((x) => x.code === norm);
    if (!w) return { ok: false, reason: 'invalid' };
    if (this.has(w.id)) return { ok: true, world_id: w.id, already: true };
    this.mem.access.push(w.id); this.persist();
    return { ok: true, world_id: w.id };
  }
  async getWorld(world) { const w = DEMO_WORLDS.find((x) => x.id === world); return w && this.has(world) ? { id: w.id, name: w.name } : null; }
  async listWorlds() {
    await this.wait();
    return DEMO_WORLDS.filter((w) => this.has(w.id)).map((w) => ({ id: w.id, name: w.name }));
  }
  async listCharacters(world) {
    await this.wait();
    const w = DEMO_WORLDS.find((x) => x.id === world);
    if (!w || !this.has(world)) return [];
    return w.letters.split('').map((L, i) => {
      const id = 'D_' + L;
      return { id, name: `${w.prefix} ${L}`, org: w.orgs[i % w.orgs.length], career: w.careers[Math.floor(i / w.orgs.length) % w.careers.length], url: demoImage(L, colorFor(id)) };
    });
  }
  async listQuadrants({ world, scope, from = 0, limit = 24 }) {
    await this.wait();
    let rows = this.mem.rows.filter((r) => r.world_id === world && this.has(r.world_id))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    rows = scope === 'mine' ? rows.filter((r) => r.owner_id === DEMO_ME) : rows.filter((r) => r.visibility === 'public');
    return rows.slice(from, from + limit).map((r) => this.withAuthor(r));
  }
  withAuthor(r) {
    return { ...JSON.parse(JSON.stringify(r)), author: r.owner_id === DEMO_ME ? this.mem.nickname : '다른 플레이어' };
  }
  async getQuadrant(id) {
    await this.wait();
    const r = this.mem.rows.find((x) => x.id === id);
    if (!r || !this.has(r.world_id) || (r.visibility !== 'public' && r.owner_id !== DEMO_ME)) return null;
    return this.withAuthor(r);
  }
  async saveQuadrant({ id, world, title, default_view, visibility, data }) {
    await this.wait(250);
    const now = new Date().toISOString();
    if (title.length > 40) throw new ApiError('제목은 40자까지예요.');
    if (id) {
      const r = this.mem.rows.find((x) => x.id === id);
      if (!r || r.owner_id !== DEMO_ME) throw new ApiError('권한이 없어요.');
      Object.assign(r, { title: title.trim(), default_view, visibility, data, updated_at: now });
      this.persist();
      return this.withAuthor(r);
    }
    if (!this.has(world)) throw new ApiError('권한이 없어요.');
    if (this.mem.rows.filter((x) => x.owner_id === DEMO_ME && x.world_id === world).length >= 50) throw new ApiError('사분면은 한 사람당 50개까지 만들 수 있어요.');
    const r = { id: 'q-' + Math.random().toString(36).slice(2, 10), owner_id: DEMO_ME, world_id: world,
      title: title.trim(), default_view, visibility, data, created_at: now, updated_at: now };
    this.mem.rows.push(r);
    this.persist();
    return this.withAuthor(r);
  }
  async deleteQuadrant(id) {
    await this.wait();
    const r = this.mem.rows.find((x) => x.id === id);
    if (!r || r.owner_id !== DEMO_ME) throw new ApiError('삭제할 권한이 없어요.');
    this.mem.rows = this.mem.rows.filter((x) => x.id !== id);
    this.persist();
  }
}

export function createApi() {
  const params = new URLSearchParams(location.search);
  const configured = CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY;
  if (!configured || params.has('demo')) return new DemoApi({ locked: params.get('demo') === 'locked' });
  return new SupabaseApi();
}
