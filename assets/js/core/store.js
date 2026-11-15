/* ============================================================
   core/store.js · 隔离存储
   每个模块只能访问自己的命名空间：portal:v1:<moduleId>:<key>
   localStorage 不可用时自动降级为内存存储，页面不报错。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var PREFIX = 'portal:v1:';
  var memory = Object.create(null);
  var available = true;

  try {
    var probe = PREFIX + '__probe__';
    global.localStorage.setItem(probe, '1');
    global.localStorage.removeItem(probe);
  } catch (e) {
    available = false;
  }

  function rawGet(key) {
    if (!available) return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }

  function rawSet(key, value) {
    if (!available) { memory[key] = value; return; }
    try { global.localStorage.setItem(key, value); }
    catch (e) { memory[key] = value; } // 配额满时不影响主流程
  }

  function rawRemove(key) {
    if (!available) { delete memory[key]; return; }
    try { global.localStorage.removeItem(key); } catch (e) { delete memory[key]; }
  }

  Portal.store = {
    /** 返回一个只属于该命名空间的小仓库 */
    namespace: function (ns) {
      var base = PREFIX + ns + ':';
      return {
        get: function (key, fallback) {
          var raw = rawGet(base + key);
          if (raw === null || raw === undefined) return fallback;
          try { return JSON.parse(raw); } catch (e) { return fallback; }
        },
        set: function (key, value) {
          try { rawSet(base + key, JSON.stringify(value)); } catch (e) { /* 循环引用等，忽略 */ }
        },
        remove: function (key) { rawRemove(base + key); },
        clear: function () {
          try {
            if (available) {
              var doomed = [];
              for (var i = 0; i < global.localStorage.length; i++) {
                var k = global.localStorage.key(i);
                if (k && k.indexOf(base) === 0) doomed.push(k);
              }
              doomed.forEach(function (k) { global.localStorage.removeItem(k); });
            }
            Object.keys(memory).forEach(function (k) { if (k.indexOf(base) === 0) delete memory[k]; });
          } catch (e) { /* noop */ }
        }
      };
    }
  };
})(window);
