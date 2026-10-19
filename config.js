// 사이트 설정 — 공개돼도 되는 값만 넣어요.
// SUPABASE_URL / SUPABASE_ANON_KEY / GOOGLE_CLIENT_ID 는 카드 사이트의 app.js 맨 위에 있는 값과 같아요.
// 세 값이 비어 있으면 서버 없이 '데모 모드'로 동작해요 (데이터는 이 브라우저에만 저장).
export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  GOOGLE_CLIENT_ID: '',

  // (선택) 들어갈 수 있는 세계관이 여러 개일 때 처음 여는 세계관 ID.
  // 비워 두면 목록의 첫 번째를 열고, 그 뒤로는 마지막에 본 세계관을 기억해요.
  WORLD_ID: '',
  SITE_LABEL: 'della-trpg.github.io',
  CARDS_SITE_URL: 'https://della-trpg.github.io/insane-madness-cards/',
};
