/* ============================================================
   core/kernel.js · 模块内核
   职责：事件总线 + 模块注册表 + 启动沙箱 + 引导页目录渲染。
   「互不影响」的四层保证：
     1. 独立 DOM 容器（section#module-<id>）
     2. 独立存储命名空间（store.namespace(id)）
     3. 独立 CSS 前缀（约定 module-<id> / 模块自定前缀）
     4. mount 异常被捕获并隔离，单个模块崩溃不影响其它模块
   模块之间只通过 bus 通信，禁止互相直接引用。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};

  /* ---------- 事件总线 ---------- */
  var topics = new Map();
  Portal.bus = {
    on: function (topic, fn) {
      if (!topics.has(topic)) topics.set(topic, []);
      topics.get(topic).push(fn);
      return function off() {
        var list = topics.get(topic) || [];
        var i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    },
    emit: function (topic, payload) {
      (topics.get(topic) || []).slice().forEach(function (fn) {
        try { fn(payload); } catch (e) { console.error('[bus:' + topic + ']', e); }
      });
    }
  };

  /* ---------- 注册表 ---------- */
  var defs = [];
  Portal.registry = {
    /** def: { id, title?, desc?, path?, index?, mount(ctx) } */
    register: function (def) {
      if (!def || !def.id || typeof def.mount !== 'function') {
        throw new Error('模块定义必须包含 id 与 mount()');
      }
      if (defs.some(function (d) { return d.id === def.id; })) {
        throw new Error('模块 id 重复：' + def.id);
      }
      defs.push(def);
    },
    list: function () { return defs.slice(); },
    get: function (id) {
      return defs.filter(function (d) { return d.id === id; })[0] || null;
    }
  };

  /* ---------- 引导页目录 ---------- */
  /** 把已注册模块渲染成入口卡片，供首页引导使用。 */
  Portal.renderCatalog = function (mountRoot) {
    var root = mountRoot || document.getElementById('catalog');
    if (!root) return;

    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function safePath(p) {
      var s = String(p || '');
      return /^(https?:\/\/|\/|\.\/|\.\.\/)/.test(s) ? esc(s) : esc('./' + s);
    }

    root.innerHTML = defs.map(function (def, i) {
      var num = String(def.index || (i + 1)).padStart(2, '0');
      var href = def.path || ('module.html?id=' + encodeURIComponent(def.id));
      return '' +
        '<a class="lc-card" href="' + safePath(href) + '" data-module="' + esc(def.id) + '">' +
          '<span class="lc-corner mono" aria-hidden="true"></span>' +
          '<span class="lc-index mono">' + esc(num) + ' / MODULE</span>' +
          '<span class="lc-name">' + esc(def.title || def.id) + '</span>' +
          '<span class="lc-desc">' + esc(def.desc || '') + '</span>' +
          '<span class="lc-foot mono">进入模块 <i class="i-ico i-ext" aria-hidden="true"></i></span>' +
        '</a>';
    }).join('');

    Portal.bus.emit('catalog:ready', { modules: defs.map(function (d) { return d.id; }) });
  };

  /* ---------- 启动 ---------- */
  /**
   * @param mountRoot 挂载点
   * @param only      可选：只挂载指定 id 的模块（二级页面用）
   */
  Portal.boot = function (mountRoot, only) {
    var root = mountRoot || document.getElementById('modules');
    if (!root) { console.error('[kernel] 找不到挂载点 #modules'); return; }

    var list = only
      ? defs.filter(function (d) { return d.id === only; })
      : defs;

    if (only && !list.length) {
      root.innerHTML = '<div class="module-fatal">未找到模块「' +
        String(only).replace(/[<>&]/g, '') + '」，请从<a href="index.html">首页</a>选择模块。</div>';
      return;
    }

    list.forEach(function (def) {
      var section = document.createElement('section');
      section.className = 'module module--' + def.id;
      section.id = 'module-' + def.id;
      section.dataset.moduleId = def.id;
      root.appendChild(section);

      var ctx = Object.freeze({
        root: section,
        store: Portal.store.namespace(def.id),   // 私有存储
        net: Portal.net,
        bus: Portal.bus,
        config: Portal.config || {},
        id: def.id
      });

      // 异步 + 独立 try/catch：任一模块失败只影响自己
      Promise.resolve()
        .then(function () { return def.mount(ctx); })
        .catch(function (err) {
          console.error('[module:' + def.id + '] 加载失败', err);
          section.innerHTML = '<div class="module-fatal">模块「' + def.id + '」加载失败：' +
            String(err && err.message || err).replace(/[<>&]/g, '') + '</div>';
        });
    });

    Portal.bus.emit('app:ready', { modules: list.map(function (d) { return d.id; }) });
  };
})(window);
