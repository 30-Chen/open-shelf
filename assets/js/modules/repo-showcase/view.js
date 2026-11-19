/* ============================================================
   repo-showcase/view.js · 纯渲染层（无状态、无请求）
   所有来自 GitHub 的文本都经过转义后再拼进 HTML。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var NS = Portal.moduleAssets.repoShowcase;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function safeUrl(url) {
    try {
      var p = new URL(url);
      return (p.protocol === 'https:' || p.protocol === 'http:') ? esc(url) : '#';
    } catch (e) { return '#'; }
  }

  var LANG_COLORS = {
    Dart: '#00B4AB', TypeScript: '#3178c6', JavaScript: '#f1e05a', Rust: '#dea584',
    Go: '#00ADD8', Python: '#3572A5', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600',
    Java: '#b07219', Kotlin: '#A97BFF', Swift: '#F05138', Vue: '#41b883',
    PHP: '#4F5D95', Ruby: '#701516', Shell: '#89e051', HTML: '#e34c26',
    CSS: '#563d7c', Lua: '#000080', Zig: '#ec915c', Scala: '#c22d40'
  };

  function compact(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function size(bytes) {
    if (!bytes || bytes < 0) return '—';
    var units = ['B', 'KB', 'MB', 'GB'], i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
  }

  function date(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
  }

  function relative(ts) {
    if (!ts) return '—';
    var d = Date.now() - ts;
    if (d < 6e4) return '刚刚';
    if (d < 36e5) return Math.floor(d / 6e4) + ' 分钟前';
    if (d < 864e5) return Math.floor(d / 36e5) + ' 小时前';
    return Math.floor(d / 864e5) + ' 天前';
  }

  function attrRepo(fullName) { return esc(fullName); }

  function headBlock(fullName, index, url) {
    var num = String(index + 1).padStart(2, '0');
    return '' +
      '<header class="rs-card-head">' +
        '<span class="rs-num mono">' + num + '</span>' +
        '<a class="rs-path mono" href="' + safeUrl(url || 'https://github.com/' + fullName) +
          '" target="_blank" rel="noopener noreferrer">' + esc(fullName) + ' <i class="i-ico i-ext" aria-hidden="true"></i></a>' +
        '<div class="rs-card-actions">' +
          '<button class="rs-icon-btn" data-action="refresh" data-repo="' + attrRepo(fullName) +
            '" title="重新获取" aria-label="重新获取">↻</button>' +
          '<button class="rs-icon-btn rs-icon-btn--danger" data-action="remove" data-repo="' + attrRepo(fullName) +
            '" title="移除收藏" aria-label="移除收藏">×</button>' +
        '</div>' +
      '</header>';
  }

  function repoBlock(d) {
    var color = LANG_COLORS[d.language] || '#71829d';
    var meta = [];
    if (d.language) meta.push('<span class="rs-lang"><i style="background:' + esc(color) + '"></i>' + esc(d.language) + '</span>');
    meta.push('<span title="Star 数">★ ' + esc(compact(d.stars)) + '</span>');
    if (d.license) meta.push('<span>' + esc(d.license) + '</span>');
    if (d.homepage) meta.push('<a href="' + safeUrl(d.homepage) + '" target="_blank" rel="noopener noreferrer">官网 <i class="i-ico i-ext" aria-hidden="true"></i></a>');

    return '' +
      '<div class="rs-repo">' +
        (d.avatar ? '<img class="rs-avatar" src="' +
          safeUrl(d.avatar + (d.avatar.indexOf('?') >= 0 ? '&' : '?') + 's=96') +
          '" alt="" loading="lazy">' : '') +
        '<div class="rs-repo-main">' +
          '<h3 class="rs-name">' + esc(d.name) + '</h3>' +
          '<div class="rs-meta mono">' + meta.join('') + '</div>' +
        '</div>' +
      '</div>' +
      '<p class="rs-description">' + esc(d.description) + '</p>';
  }

  function assetRow(a) {
    return '' +
      '<a class="rs-asset" href="' + safeUrl(a.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="rs-asset-ic mono">↓</span>' +
        '<span class="rs-asset-name mono" title="' + esc(a.name) + '">' + esc(a.name) + '</span>' +
        '<span class="rs-asset-size mono">' + esc(size(a.size)) + '</span>' +
        '<span class="rs-asset-count mono">' + esc(compact(a.downloads)) + ' 次</span>' +
      '</a>';
  }

  // 主要安装文件（各平台可执行包）优先，校验文件/签名/源码包靠后。
  var PRIMARY_RE = /\.(exe|msi|appx|dmg|pkg|app|AppImage|deb|rpm|apk|ipa|zip|7z|rar|tar\.gz|tgz|bin|jar)$/i;
  var SECONDARY_RE = /(checksums?|sha\d+|md5|sig|asc|pem|signature|\.txt$|\.sha\d+$|source[-_]?code|sources?\.jar)/i;
  var SOURCE_RE = /(source|src)[-_.]?(code)?\.(zip|tar|tgz|7z)/i;
  var PLATFORM_LABEL = {
    windows: 'Windows', macos: 'macOS', linux: 'Linux',
    android: 'Android', ios: 'iOS', other: '其它'
  };
  var PLATFORM_ORDER = ['windows', 'macos', 'linux', 'android', 'ios', 'other'];

  // ui: { platform: 'windows|macos|...' }  由 index.js 维护（仅平台筛选，无版本状态）
  function assetScore(a, device) {
    var name = String(a.name || '');
    var s = 0;
    if (PRIMARY_RE.test(name)) s += 100;
    if (SOURCE_RE.test(name)) s -= 60;
    else if (SECONDARY_RE.test(name)) s -= 80;
    // 当前设备平台优先；其余已知平台次之；未识别再次
    var p = a.platform || (NS.github ? NS.github.platformOf(name) : 'other');
    if (device && p === device) s += 60;
    else if (p !== 'other') s += 10;
    // 同档位内按下载量排序，越常用越靠前
    s += Math.min(Number(a.downloads) || 0, 100000) / 100000;
    return s;
  }

  // 始终只展示最新的一个 Release（版本号 + 发布时间），不再提供版本切换。
  function releaseBlock(d, ui) {
    ui = ui || {};
    // d.release 由数据层固定指向最新版本（稳定版优先、按发布时间倒序）
    var r = d.release || null;
    if (!r) {
      return '' +
        '<div class="rs-release rs-release--empty">' +
          '<div class="rs-release-head"><span class="rs-kicker mono">RELEASE</span>' +
          '<span class="rs-tag rs-tag--none mono">暂无发布版本</span></div>' +
          '<p class="rs-no-assets">该仓库还没有正式 Release，可直接前往仓库查看源码或预发布版本。</p>' +
          '<div class="rs-source mono"><a href="' + safeUrl(d.htmlUrl + '/releases') +
            '" target="_blank" rel="noopener noreferrer">查看 Releases 页面 <i class="i-ico i-ext" aria-hidden="true"></i></a></div>' +
        '</div>';
    }

    var device = NS.github ? NS.github.currentPlatform() : '';

    // 该版本实际包含的平台，按「当前设备优先 + 固定顺序」排列
    var present = [];
    r.assets.forEach(function (a) {
      var p = a.platform || (NS.github ? NS.github.platformOf(a.name) : 'other');
      if (present.indexOf(p) < 0) present.push(p);
    });
    present.sort(function (a, b) {
      if (a === device) return -1;
      if (b === device) return 1;
      return PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b);
    });

    // 默认选中当前设备平台；识别不到设备或无对应安装包时取第一个平台。
    var wanted = ui.platform || '';
    var active = (wanted && present.indexOf(wanted) >= 0)
      ? wanted
      : (present.indexOf(device) >= 0 ? device : (present[0] || ''));

    var MAX = 3;
    var pool = r.assets.filter(function (a) {
      if (!active) return true;
      return (a.platform || (NS.github ? NS.github.platformOf(a.name) : 'other')) === active;
    }).sort(function (a, b) { return assetScore(b, device) - assetScore(a, device); });
    var visible = pool.slice(0, MAX);
    var rest = pool.length - visible.length;
    var assets = visible.length
      ? '<div class="rs-assets">' + visible.map(assetRow).join('') +
          (rest > 0 ? '<a class="rs-asset-more mono" href="' + safeUrl(r.url) +
            '" target="_blank" rel="noopener noreferrer">还有 ' + rest + ' 个文件 · 前往 Release 页面查看全部 <i class="i-ico i-ext" aria-hidden="true"></i></a>' : '') +
        '</div>'
      : '<p class="rs-no-assets">' + (active
          ? '该版本没有 ' + esc(PLATFORM_LABEL[active] || active) + ' 平台的安装包，试试切换平台。'
          : '该版本没有上传安装包，可下载源码归档或查看 Release 页面。') + '</p>';

    // 平台筛选条：至少两个平台时才显示，不再有「全部」（只显示 3 行时无意义）
    var platBar = present.length > 1
      ? '<div class="rs-platform-bar mono" role="group" aria-label="按平台筛选下载">' +
          present.map(function (p) {
            var label = PLATFORM_LABEL[p] || p;
            if (p === device) label += ' · 本机';
            return '<button type="button" class="rs-plat' + (active === p ? ' is-active' : '') +
              '" data-action="platform" data-repo="' + attrRepo(d.fullName) +
              '" data-platform="' + esc(p) + '">' + esc(label) + '</button>';
          }).join('') +
        '</div>'
      : '';

    var notes = r.body.trim()
      ? '<details class="rs-notes"><summary class="mono">更新日志 / RELEASE NOTES</summary><pre>' +
          esc(r.body.trim().slice(0, 1600)) + (r.body.length > 1600 ? '\n…' : '') +
        '</pre></details>'
      : '';

    return '' +
      '<div class="rs-release">' +
        '<div class="rs-release-head">' +
          '<span class="rs-kicker mono">LATEST RELEASE</span>' +
          '<span class="rs-tag mono">' + esc(r.tag) + '</span>' +
          (r.prerelease ? '<span class="rs-tag rs-tag--pre mono">预览版</span>' : '') +
          '<span class="rs-date mono">' + esc(date(r.publishedAt)) + '</span>' +
        '</div>' +
        platBar +
        assets +
        '<div class="rs-source mono">' +
          '<a href="' + safeUrl(r.sourceZip) + '" target="_blank" rel="noopener noreferrer">↓ 源码 .zip</a>' +
          '<a href="' + safeUrl(r.sourceTar) + '" target="_blank" rel="noopener noreferrer">↓ 源码 .tar.gz</a>' +
          '<a href="' + safeUrl(r.url) + '" target="_blank" rel="noopener noreferrer">查看 Release <i class="i-ico i-ext" aria-hidden="true"></i></a>' +
        '</div>' +
        notes +
      '</div>';
  }

  function loadingBlock() {
    return '' +
      '<div class="rs-skeleton" aria-label="正在加载">' +
        '<div class="sk sk--avatar"></div><div class="sk sk--title"></div>' +
        '<div class="sk sk--text"></div><div class="sk sk--text sk--short"></div>' +
        '<div class="sk sk--bar"></div><div class="sk sk--row"></div><div class="sk sk--row"></div>' +
      '</div>';
  }

  function errorBlock(item) {
    return '' +
      '<div class="rs-error">' +
        '<div class="rs-error-title">↯ 无法获取该仓库</div>' +
        '<p>' + esc(item.error || '未知错误') + '</p>' +
        '<p class="rs-error-tip">检查仓库名是否正确；若网络无法访问 api.github.com，可在「设置」里更换 API 地址。</p>' +
        '<button class="btn" data-action="refresh" data-repo="' + attrRepo(item.fullName) + '">↻ 重试</button>' +
      '</div>';
  }

  function staleBar(item) {
    return '<div class="rs-stale"><span>⚠ ' + esc(item.error || '刷新失败') + '，以下为 ' +
      esc(relative(item.data.fetchedAt)) + ' 前的本地数据</span>' +
      '<button class="rs-stale-retry mono" data-action="refresh" data-repo="' +
      attrRepo(item.fullName) + '">↻ 重试</button></div>';
  }

  function footBlock(d) {
    var label = d.offline
      ? '离线快照 · ' + esc(date(d.generatedAt))
      : '已同步 · ' + esc(relative(d.fetchedAt)) + (d.cached ? ' · 缓存' : '');
    return '' +
      '<div class="rs-card-foot mono">' +
        '<span><i class="rs-led' + (d.offline ? ' rs-led--offline' : '') + '"></i> ' + label + '</span>' +
        '<a href="' + safeUrl(d.htmlUrl + '/releases') + '" target="_blank" rel="noopener noreferrer">全部版本 <i class="i-ico i-ext" aria-hidden="true"></i></a>' +
      '</div>';
  }

  /** item: { fullName, status: loading|ready|error, data?, error? }; ui: 该卡的下载选择状态 */
  function card(item, index, ui) {
    var d = item.data;
    var inner = '';

    if (item.status === 'loading' && !d) {
      inner = headBlock(item.fullName, index) + loadingBlock();
    } else {
      inner = headBlock(item.fullName, index, d ? d.htmlUrl : null);
      if (item.status === 'error' && d) inner += staleBar(item);
      if (d) inner += repoBlock(d) + releaseBlock(d, ui) + footBlock(d);
      if (item.status === 'error' && !d) inner += errorBlock(item);
    }

    var cls = 'rs-card' + (item.status === 'loading' ? ' rs-card--loading' : '') +
      (item.status === 'error' ? ' rs-card--error' : '');
    return '<article class="' + cls + '" data-repo="' + attrRepo(item.fullName) +
      '" style="animation-delay:' + Math.min(index, 8) * 55 + 'ms">' +
      '<span class="rs-card-line"></span>' + inner + '</article>';
  }

  /** 分组标题：仅渲染视觉结构，卡片由调用方组装。key 为默认目录时不显示删除按钮。 */
  function groupHead(key, count, isDefault) {
    return '' +
      '<header class="rs-group-head">' +
        '<span class="rs-group-mark mono" aria-hidden="true">▎</span>' +
        '<h3 class="rs-group-name">' + esc(key) + '</h3>' +
        '<span class="rs-group-count mono">' + count + ' ' + (count === 1 ? 'REPO' : 'REPOS') + '</span>' +
        '<span class="rs-group-rule" aria-hidden="true"></span>' +
        (isDefault
          ? '<span class="rs-group-tag mono">默认目录</span>'
          : '<button class="rs-group-del mono" type="button" data-action="delete-group" data-group="' +
            esc(key) + '" title="删除该目录，项目移入默认目录">删除目录 ×</button>') +
      '</header>';
  }

  function empty() {
    return '' +
      '<div class="rs-empty">' +
        '<div class="rs-empty-mark mono">[ ]</div>' +
        '<h3>还没有收藏任何项目</h3>' +
        '<p>在上方粘贴 <code>owner/repo</code> 或 GitHub 链接，选择或新建一个分类目录，即可自动拉取项目介绍与最新 Release 下载地址。</p>' +
      '</div>';
  }

  NS.view = { esc: esc, safeUrl: safeUrl, card: card, groupHead: groupHead, empty: empty, compact: compact };
})(window);
