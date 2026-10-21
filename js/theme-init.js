// 화면 테마를 페이지가 그려지기 전에 적용 (깜빡임 방지). 모듈이 아닌 일반 스크립트로 <head>에서 바로 실행됨.
(function () {
  var t = 'dark';
  try {
    var v = JSON.parse(localStorage.getItem('quadrant:theme') || 'null');
    if (v === 'light' || v === 'mono' || v === 'dark') t = v;
  } catch (e) { /* 저장소를 못 쓰는 환경이면 기본(어둡게) */ }
  document.documentElement.setAttribute('data-site-theme', t);
  var m = document.querySelector('meta[name="color-scheme"]');
  if (m) m.setAttribute('content', t === 'dark' ? 'dark' : 'light');
})();
