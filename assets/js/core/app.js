/* ============================================================
   core/app.js · 启动入口（最后加载）
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};

  Portal.config = {
    githubApiBase: 'https://api.github.com',
    cacheMs: 30 * 60 * 1000   // 快照缓存 30 分钟，规避未认证 60 次/小时的限流
  };

  function start() {
    var y = document.getElementById('year');
    if (y) y.textContent = String(new Date().getFullYear());
    Portal.boot(document.getElementById('modules'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window);
