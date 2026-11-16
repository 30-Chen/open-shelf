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
          '" target="_blank" rel="noopener noreferrer">' + esc(fullName) + ' <span>↗</span></a>' +
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
    if (d.homepage) meta.push('<a href="' + safeUrl(d.homepage) + '" target="_blank" rel="noopener noreferrer">官网 ↗</a>');

    var topics = (d.topics || []).length
      ? '<div class="rs-topics">' + d.topics.map(function (t) { return '<span>#' + esc(t) + '</span>'; }).join('') + '</div>'
      : '';

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
      '<p class="rs-description">' + esc(d.description) + '</p>' +
      topics;
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

  function assetScore(a) {
    var name = String(a.name || '');
    var s = 0;
    if (PRIMARY_RE.test(name)) s += 100;
    if (SOURCE_RE.test(name)) s -= 60;
    else if (SECONDARY_RE.test(name)) s -= 80;
    // 同档位内按下载量排序，越常用越靠前
    s += Math.min(Number(a.downloads) || 0, 100000) / 100000;
    return s;
  }

  function releaseBlock(d) {
    var r = d.release;
    if (!r) {
      return '' +
        '<div class="rs-release rs-release--empty">' +
          '<div class="rs-release-head"><span class="rs-kicker mono">LATEST RELEASE</span>' +
          '<span class="rs-tag rs-tag--none mono">暂无发布版本</span></div>' +
          '<p class="rs-no-assets">该仓库还没有正式 Release，可直接前往仓库查看源码或预发布版本。</p>' +
          '<div class="rs-source mono"><a href="' + safeUrl(d.htmlUrl + '/releases') +
            '" target="_blank" rel="noopener noreferrer">查看 Releases 页面 ↗</a></div>' +
        '</div>';
    }

    var MAX = 3;
    var ordered = r.assets.slice().sort(function (a, b) {
      return assetScore(b) - assetScore(a);
    });
    var visible = ordered.slice(0, MAX);
    var rest = ordered.length - visible.length;
    var assets = visible.length
      ? '<div class="rs-assets">' + visible.map(assetRow).join('') +
          (rest > 0 ? '<a class="rs-asset-more mono" href="' + safeUrl(r.url) +
            '" target="_blank" rel="noopener noreferrer">还有 ' + rest + ' 个文件 · 前往 Release 页面查看全部 ↗</a>' : '') +
        '</div>'
      : '<p class="rs-no-assets">该版本没有上传安装包，可下载源码归档或查看 Release 页面。</p>';

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
          '<span class="rs-date mono">' + esc(date(r.publishedAt)) + '</span>' +
        '</div>' +
        (r.name && r.name !== r.tag ? '<div class="rs-release-name">' + esc(r.name) + '</div>' : '') +
        assets +
        '<div class="rs-source mono">' +
          '<a href="' + safeUrl(r.sourceZip) + '" target="_blank" rel="noopener noreferrer">↓ 源码 .zip</a>' +
          '<a href="' + safeUrl(r.sourceTar) + '" target="_blank" rel="noopener noreferrer">↓ 源码 .tar.gz</a>' +
          '<a href="' + safeUrl(r.url) + '" target="_blank" rel="noopener noreferrer">查看 Release ↗</a>' +
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
        '<a href="' + safeUrl(d.htmlUrl + '/releases') + '" target="_blank" rel="noopener noreferrer">全部版本 ↗</a>' +
      '</div>';
  }

  /** item: { fullName, status: loading|ready|error, data?, error? } */
  function card(item, index) {
    var d = item.data;
    var inner = '';

    if (item.status === 'loading' && !d) {
      inner = headBlock(item.fullName, index) + loadingBlock();
    } else {
      inner = headBlock(item.fullName, index, d ? d.htmlUrl : null);
      if (item.status === 'error' && d) inner += staleBar(item);
      if (d) inner += repoBlock(d) + releaseBlock(d) + footBlock(d);
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
