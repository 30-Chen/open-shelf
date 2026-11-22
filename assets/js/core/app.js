/* ============================================================
   core/app.js · 启动入口（最后加载）
   同一套脚本服务三种页面：
     - 介绍首页：既无 #catalog 也无 #modules → 只做展示，模块在后台冷同步
     - 收藏架页：存在 #catalog → 渲染模块入口卡片
     - 模块页：存在 #modules + ?id=<moduleId> → 只启动该模块
   不带 id 时模块页启动全部模块（兼容旧入口）。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};

  Portal.config = {
    githubApiBase: 'https://api.github.com',
    cacheMs: 30 * 60 * 1000   // 快照缓存 30 分钟，规避未认证 60 次/小时的限流
  };

  function query(name) {
    try { return new URLSearchParams(global.location.search).get(name); }
    catch (e) { return null; }
  }

  function start() {
    var y = document.getElementById('year');
    if (y) y.textContent = String(new Date().getFullYear());

    var catalog = document.getElementById('catalog');
    if (catalog) {
      Portal.renderCatalog(catalog);
      return;
    }

    // 纯介绍首页：既无目录也无挂载点。模块脚本已注册、sync 自行冷同步，
    // 这里不再尝试 boot，避免产生「找不到挂载点 #modules」的报错。
    var modulesRoot = document.getElementById('modules');
    if (!modulesRoot) return;

    // 二级页：根据 ?id= 选择模块，并同步页面上的标题 / 描述
    var id = query('id');
    var def = id ? Portal.registry.get(id) : null;
    if (def) {
      var t = document.getElementById('module-title');
      var s = document.getElementById('module-subtitle');
      var n = document.getElementById('module-index');
      if (t) t.textContent = def.title || def.id;
      if (s) s.textContent = def.desc || '';
      if (n) n.textContent = String(def.index || '01').padStart(2, '0') + ' / MODULE';
      document.title = (def.title || def.id) + ' · OPEN / SHELF';
    }
    // 页头 MODULE 图标的二级菜单：按注册表自动生成入口
    if (Portal.mountModuleSwitch) Portal.mountModuleSwitch(null, null, id);
    Portal.boot(modulesRoot, id || null);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window);
