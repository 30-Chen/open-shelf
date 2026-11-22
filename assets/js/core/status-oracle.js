/* ============================================================
   core/status-oracle.js · 首页系统状态图标的点按彩蛋
   点击 / 回车 / 空格触发：随机弹出一条「系统运行状态」或「中国名言名句」。
   只作用于 #status-oracle，独立脚本、无依赖；不在模块页加载。
   ============================================================ */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  // 文案池：一半是拟真的系统状态，一半是名言名句
  var LINES = [
    { kind: 'SYSTEM / 运行状态', text: '系统运行正常，所有模块已就绪。' },
    { kind: 'SYSTEM / 运行状态', text: '数据都留在本地，离线也能正常使用。' },
    { kind: 'SYSTEM / 运行状态', text: '未连接云端 · 当前仅在浏览器存储。' },
    { kind: 'SYSTEM / 运行状态', text: '冷同步待命 · 未挂载的模块也会接收更新。' },
    { kind: 'SYSTEM / 运行状态', text: '无服务端 · 页面即应用，打开即用。' },
    { kind: 'SYSTEM / 运行状态', text: '存储配额充足 · 可放心继续收藏。' },
    { kind: 'SYSTEM / 运行状态', text: '模块彼此隔离 · 一处异常不影响其它。' },
    { kind: '名言 / 名句', text: '路漫漫其修远兮，吾将上下而求索。——屈原《离骚》' },
    { kind: '名言 / 名句', text: '不积跬步，无以至千里；不积小流，无以成江海。——荀子《劝学》' },
    { kind: '名言 / 名句', text: '天行健，君子以自强不息。——《周易》' },
    { kind: '名言 / 名句', text: '海内存知己，天涯若比邻。——王勃《送杜少府之任蜀州》' },
    { kind: '名言 / 名句', text: '会当凌绝顶，一览众山小。——杜甫《望岳》' },
    { kind: '名言 / 名句', text: '问渠那得清如许？为有源头活水来。——朱熹《观书有感》' },
    { kind: '名言 / 名句', text: '千里之行，始于足下。——老子《道德经》' },
    { kind: '名言 / 名句', text: '博观而约取，厚积而薄发。——苏轼《稼说送张琥》' },
    { kind: '名言 / 名句', text: '苟日新，日日新，又日新。——《礼记·大学》' }
  ];

  function start() {
    var trigger = doc.getElementById('status-oracle');
    if (!trigger) return;

    var tip = null;
    var hideTimer = null;
    var lastIndex = -1;

    function hide() {
      if (!tip) return;
      var dying = tip;
      tip = null;
      dying.classList.add('is-out');
      global.setTimeout(function () {
        if (dying.parentNode) dying.parentNode.removeChild(dying);
      }, 300);
    }

    function show() {
      // 避免连续两次抽到同一条
      var i = Math.floor(Math.random() * LINES.length);
      if (LINES.length > 1 && i === lastIndex) i = (i + 1) % LINES.length;
      lastIndex = i;
      var line = LINES[i];

      if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
      if (hideTimer) { global.clearTimeout(hideTimer); hideTimer = null; }

      tip = doc.createElement('div');
      tip.className = 'lc-oracle-tip';
      tip.setAttribute('role', 'status');
      tip.innerHTML =
        '<span class="lc-oracle-kind"></span>' +
        '<span class="lc-oracle-text"></span>';
      tip.querySelector('.lc-oracle-kind').textContent = line.kind;
      tip.querySelector('.lc-oracle-text').textContent = line.text;
      trigger.appendChild(tip);

      hideTimer = global.setTimeout(hide, 3600);
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      show();
    });
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        show();
      } else if (e.key === 'Escape') {
        hide();
      }
    });
    // 点击空白处收起
    doc.addEventListener('click', function (e) {
      if (tip && !trigger.contains(e.target)) hide();
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window);
