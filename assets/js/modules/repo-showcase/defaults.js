/* ============================================================
   repo-showcase/defaults.js · 默认收藏清单
   ✎ 直接编辑这个文件并推送到 GitHub，所有访客打开页面就能看到这些项目。
     （访客自己在页面上添加的项目只保存在他自己的浏览器里，不会改仓库）
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  Portal.moduleAssets = Portal.moduleAssets || {};
  Portal.moduleAssets.repoShowcase = {
    defaults: [
      'localsend/localsend',
      'flameshot-org/flameshot',
      'ankitects/anki',
      'Syncthing/syncthing'
    ]
  };
})(window);
