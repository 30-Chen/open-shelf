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

  /* ---------- 通用工具 ---------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safePath(p) {
    var s = String(p || '');
    return /^(https?:\/\/|\/|\.\/|\.\.\/)/.test(s) ? esc(s) : esc('./' + s);
  }

  /* ---------- 引导页目录 ---------- */
  /** 把已注册模块渲染成入口卡片，供首页引导使用。 */
  Portal.renderCatalog = function (mountRoot) {
    var root = mountRoot || document.getElementById('catalog');
    if (!root) return;

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

  /* ---------- 页头 MODULE 状态图标的二级菜单 ---------- */
  /** 根据注册表自动生成菜单项（新增模块无需改 HTML），并绑定打开/关闭。 */
  Portal.mountModuleSwitch = function (btn, menu, currentId) {
    btn = btn || document.getElementById('module-switch-btn');
    menu = menu || document.getElementById('module-switch-menu');
    if (!btn || !menu) return;

    menu.innerHTML =
      '<li class="msw-head" aria-hidden="true">MODULES / 切换模块</li>' +
      defs.map(function (def, i) {
        var num = String(def.index || (i + 1)).padStart(2, '0');
        var href = def.path || ('module.html?id=' + encodeURIComponent(def.id));
        var current = def.id === currentId;
        return '<li role="none">' +
          '<a class="msw-item' + (current ? ' is-current' : '') + '" role="menuitem" ' +
            'href="' + safePath(href) + '"' + (current ? ' aria-current="page"' : '') + '>' +
            '<span class="msw-num">' + esc(num) + '</span>' +
            '<span class="msw-body">' +
              '<span class="msw-name">' + esc(def.title || def.id) + '</span>' +
              '<span class="msw-desc">' + esc(def.desc || '') + '</span>' +
            '</span>' +
            '<i class="i-ico i-ext" aria-hidden="true"></i>' +
          '</a></li>';
      }).join('');

    function setOpen(open) {
      if (open) Portal.popovers.closeAll('module-switch'); // 打开自己前先收起其它浮层
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.classList.toggle('is-open', open);
    }
    Portal.popovers.register('module-switch', function () { setOpen(false); });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { if (!menu.hidden) setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); }
    });
  };

  /* ---------- 全局悬浮面板互斥 ---------- */
  // 任意浮层打开时先收起其它浮层，避免「设置 / 云同步 / 切换模块」等多个面板叠加。
  // 各浮层只需 register(id, closeFn)，并在自己打开的瞬间调用 closeAll(id)。
  var popovers = [];
  Portal.popovers = {
    /** 登记一个浮层：id 唯一；closeFn 用于关闭它 */
    register: function (id, closeFn) {
      if (!id || typeof closeFn !== 'function') return;
      for (var i = 0; i < popovers.length; i++) {
        if (popovers[i].id === id) { popovers[i].close = closeFn; return; }
      }
      popovers.push({ id: id, close: closeFn });
    },
    /** 关闭除 exceptId 之外的所有已登记浮层 */
    closeAll: function (exceptId) {
      popovers.slice().forEach(function (p) {
        if (p.id === exceptId) return;
        try { p.close(); } catch (e) { /* 单个浮层关闭失败不影响其它 */ }
      });
    }
  };

  /* ---------- 悬浮层定位 ---------- */
  /**
   * 把一个 absolute 浮层定位到触发按钮正下方，右缘与按钮右缘对齐。
   * 解决「浮层用 right:0 锚定在整个 .filters 容器右缘、与按钮错位」的问题。
   * - host：定位宿主（浮层的 offsetParent，通常是 .filters 容器）；不传则取浮层当前 offsetParent
   * - 会把浮层夹取在 host 内，左右各留 pad，避免移动端溢出
   * - 浮层显示后调用；窗口 resize / 宿主滚动时自动重算
   */
  var placements = [];   // [{ pop, anchor, host, gap, pad }]
  function computePlacement(p) {
    var pop = p.pop, anchor = p.anchor, host = p.host || pop.offsetParent;
    if (!pop || !anchor || !host) return;
    var hr = host.getBoundingClientRect();
    var ar = anchor.getBoundingClientRect();
    // 先清除上次内联定位，按 CSS 的自然宽度测量浮层
    pop.style.left = '';
    pop.style.right = '';
    pop.style.top = '';
    var pw = pop.offsetWidth;
    var pad = p.pad == null ? 8 : p.pad;
    var gap = p.gap == null ? 8 : p.gap;
    // 右缘对齐按钮右缘；夹取到 host 内（左右留 pad）
    var left = ar.right - hr.left - pw;
    var maxLeft = hr.width - pw - pad;
    if (left > maxLeft) left = maxLeft;
    if (left < pad) left = pad;
    pop.style.left = Math.round(left) + 'px';
    pop.style.right = 'auto';
    pop.style.top = Math.round(ar.bottom - hr.top + gap) + 'px';
  }
  Portal.placePopover = function (pop, anchor, opts) {
    if (!pop || !anchor) return;
    opts = opts || {};
    var entry = { pop: pop, anchor: anchor, host: opts.host || pop.offsetParent,
      gap: opts.gap, pad: opts.pad };
    // 清理已脱离 DOM 的旧浮层（模块 render 会整体重建 innerHTML），避免累积
    for (var i = placements.length - 1; i >= 0; i--) {
      if (!placements[i].pop.parentNode || placements[i].pop === pop) placements.splice(i, 1);
    }
    placements.push(entry);
    computePlacement(entry);
  };
  if (global.addEventListener) {
    global.addEventListener('resize', function () {
      placements.forEach(function (p) {
        if (p.pop && !p.pop.hidden && p.pop.offsetParent) computePlacement(p);
      });
    });
  }

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
