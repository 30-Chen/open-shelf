/* ============================================================
   select.js · 自定义下拉（无依赖，module.html / index.html 共享）
   问题背景：原生 <select> 的选项弹层由浏览器 / 系统绘制，CSS 无法控制，
   深浅主题与各平台表现不一致。这里把弹层改为 DOM 渲染，样式完全可控。
   兼容做法：真实值仍存放在隐藏的 <select> 中，业务逻辑照旧读写 value，
   选择时用 input / change 事件通知原有监听器，不改动既有数据流。
   ============================================================ */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  // 单一全局「点击外部关闭」，避免每次渲染都累加监听器
  var mounted = [];
  var bound = false;
  function bindGlobal() {
    if (bound) return;
    bound = true;
    doc.addEventListener('click', function (e) {
      for (var i = mounted.length - 1; i >= 0; i--) {
        var m = mounted[i];
        if (!m.pill.isConnected) { mounted.splice(i, 1); continue; }
        if (!m.pill.contains(e.target)) m.api.close();
      }
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') mounted.forEach(function (m) {
        if (m.pill.isConnected) m.api.close();
      });
    });
  }

  /**
   * 挂载自定义下拉。
   * @param {Element} pill  .sel-pill 容器
   * @param {Object}  opts  { format(option):string, onSelect(value):void }
   * @returns {Object} { refresh, rebuild, open, close, isOpen }
   */
  function mount(pill, opts) {
    if (!pill) return null;
    if (pill.__selApi) return pill.__selApi;
    opts = opts || {};
    var select = pill.querySelector('select');
    var trigger = pill.querySelector('.sel-trigger');
    var valueEl = pill.querySelector('.sel-value');
    var menu = pill.querySelector('.sel-menu');
    var newInput = pill.querySelector('input.sel-new');
    if (!select || !trigger || !menu) return null;

    function isNew(v) { return v === '__new__'; }
    function currentOption() {
      var found = null;
      Array.prototype.forEach.call(select.options, function (o) {
        if (o.value === select.value) found = o;
      });
      return found;
    }

    function refresh() {
      var v = select.value;
      var active = currentOption();
      if (valueEl) valueEl.textContent = opts.format ? opts.format(active) : (active ? active.textContent : '');
      var newMode = isNew(v);
      pill.classList.toggle('is-new', newMode);
      if (newInput) newInput.hidden = !newMode;
      Array.prototype.forEach.call(menu.children, function (li) {
        var on = li.getAttribute('data-value') === v;
        li.classList.toggle('is-active', on);
        li.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }

    function rebuild() {
      menu.innerHTML = '';
      Array.prototype.forEach.call(select.options, function (o) {
        var item = doc.createElement('div');
        item.className = 'sel-option' + (isNew(o.value) ? ' sel-option--new' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('data-value', o.value);
        item.textContent = o.textContent;
        menu.appendChild(item);
      });
      refresh();
    }

    function open() {
      refresh();
      menu.hidden = false;
      pill.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
    }
    function close() {
      menu.hidden = true;
      pill.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    function toggle() { if (menu.hidden) open(); else close(); }

    trigger.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (menu.hidden) open();
      }
    });
    menu.addEventListener('click', function (e) {
      var item = e.target && e.target.closest ? e.target.closest('.sel-option') : null;
      if (!item || !menu.contains(item)) return;
      e.stopPropagation();
      select.value = item.getAttribute('data-value');
      // 通知既有监听器（模块 1 监听 change，模块 2 监听 input）
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      refresh();
      close();
      if (opts.onSelect) opts.onSelect(select.value);
      if (newInput && isNew(select.value)) newInput.focus();
    });

    var api = {
      refresh: refresh, rebuild: rebuild, open: open, close: close,
      isOpen: function () { return !menu.hidden; }
    };
    pill.__selApi = api;
    mounted.push({ pill: pill, api: api });
    bindGlobal();
    rebuild();
    return api;
  }

  global.PortalSelect = { mount: mount };
})(window);
