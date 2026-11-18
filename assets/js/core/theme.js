/* ============================================================
   theme.js · 明暗主题（独立、无依赖，三个页面都可加载）
   模式：auto（默认，随日出日落）/ light / dark，点击三段循环。
   auto 依据访问者本地时间判断昼夜：日出 06:00、日落 18:00；
   无法取得真实经纬度日照，采用本地时钟近似，简单且无需定位权限。
   偏好存 localStorage，键 portal:v1:settings:theme。
   ============================================================ */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  var KEY = 'portal:v1:settings:theme';
  var MODES = ['auto', 'light', 'dark'];
  var ICONS = { auto: 'i-auto', light: 'i-sun', dark: 'i-moon' };
  var SUNRISE = 6, SUNSET = 18; // 本地时间（小时）

  function read() {
    try {
      var v = global.localStorage && global.localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : 'auto';
    } catch (e) { return 'auto'; }
  }

  function write(mode) {
    try { if (global.localStorage) global.localStorage.setItem(KEY, mode); }
    catch (e) { /* 隐私模式下忽略 */ }
  }

  /** 当前生效主题：auto 时按本地时间判断昼夜 */
  function resolve(mode, now) {
    if (mode !== 'auto') return mode;
    now = now || new Date();
    var h = now.getHours() + now.getMinutes() / 60;
    return (h >= SUNRISE && h < SUNSET) ? 'light' : 'dark';
  }

  function apply(mode) {
    var effective = resolve(mode);
    doc.documentElement.setAttribute('data-theme', effective);
    var meta = doc.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', effective);
    return effective;
  }

  var mode = read();
  apply(mode); // 首屏尽早应用，避免闪烁

  var repaint = function () {};

  function buildButton() {
    if (doc.getElementById('theme-toggle')) return;
    var header = doc.querySelector('.header-meta');
    if (!header) return;

    var btn = doc.createElement('button');
    btn.id = 'theme-toggle';
    btn.className = 'theme-toggle';
    btn.type = 'button';

    function paint() {
      var effective = resolve(mode);
      var tip = mode === 'auto'
        ? '自动主题（日出 06:00 – 日落 18:00，当前 ' + (effective === 'light' ? '亮色' : '暗色') + '）· 点击切换'
        : (mode === 'light' ? '亮色主题 · 点击切换' : '暗色主题 · 点击切换');
      // 仅图标，不显示文字；当前模式通过 title / aria-label 说明
      btn.innerHTML = '<i class="i-ico ' + ICONS[mode] + '" aria-hidden="true"></i>';
      btn.title = tip;
      btn.setAttribute('aria-label', tip);
    }
    repaint = paint;

    btn.addEventListener('click', function () {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      write(mode);
      apply(mode);
      paint();
    });

    paint();
    // 放在页头控件最后（SYNC、外链之后），与其它胶囊控件同排
    header.appendChild(btn);
  }

  // 暴露给需要的页面（目前无需外部调用，仅便于测试）
  global.PortalTheme = {
    resolve: resolve,
    apply: apply,
    getMode: function () { return mode; },
    setMode: function (m) {
      if (MODES.indexOf(m) < 0) return;
      mode = m; write(m); apply(m); repaint();
    }
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', buildButton, { once: true });
  } else {
    buildButton();
  }
})(window);
