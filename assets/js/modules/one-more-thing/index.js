/* ============================================================
   one-more-thing/index.js · 预留模块（占位，不含实际功能）
   只注册元信息并渲染一张说明页；不读写存储、不发网络请求、不参与同步。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};

  Portal.registry.register({
    id: 'one-more-thing',
    index: '03',
    title: 'One more thing',
    desc: '留给下一个灵感的空位置：暂时不放功能，也不会收集或同步任何数据。',
    badge: 'COMING SOON',
    path: 'module.html?id=one-more-thing',
    mount: function (ctx) {
      var root = ctx.root;
      root.innerHTML = '' +
        '<div class="omt">' +
          '<div class="omt-orbit" aria-hidden="true"><span>03</span></div>' +
          '<p class="omt-eyebrow mono"><i aria-hidden="true"></i> RESERVED / 预留模块</p>' +
          '<h2 class="omt-title">One more thing<span>.</span></h2>' +
          '<p class="omt-lead">这里留给下一个值得收藏的想法。它还没有功能，也不收集任何数据——先占一个位置，等它长成真正的模块。</p>' +
          '<div class="omt-tags mono" aria-label="模块状态">' +
            '<span>NO DATA</span><span>NO SETTINGS</span><span>NO SYNC</span>' +
          '</div>' +
          '<a class="omt-back" href="shelf.html"><i class="i-ico i-back" aria-hidden="true"></i> 返回功能模块</a>' +
        '</div>';
    }
  });
})(window);
