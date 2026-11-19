/* ============================================================
   core/share-view.js · 只读分享页渲染层（无状态、无请求、无编辑入口）
   只消费公开 Gist 里的 open-shelf.json，渲染成纯展示视图。
   所有文本先转义再拼接；链接仅放行 http/https；正文复用 notes/markdown.js
   的安全渲染，确保即使是他人发布的 Gist 也无法注入脚本。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var NS = Portal.shareView = {};

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function safeUrl(url) {
    try {
      var p = new URL(String(url));
      return (p.protocol === 'https:' || p.protocol === 'http:') ? esc(url) : '#';
    } catch (e) { return '#'; }
  }

  function date(v) {
    if (!v) return '—';
    var d = new Date(v);
    return isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
  }

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

  var LANG_COLORS = {
    Dart: '#00B4AB', TypeScript: '#3178c6', JavaScript: '#f1e05a', Rust: '#dea584',
    Go: '#00ADD8', Python: '#3572A5', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600',
    Java: '#b07219', Kotlin: '#A97BFF', Swift: '#F05138', Vue: '#41b883'
  };

  var PRIMARY_RE = /\.(exe|msi|appx|dmg|pkg|app|AppImage|deb|rpm|apk|ipa|zip|7z|rar|tar\.gz|tgz|bin|jar)$/i;
  var SECONDARY_RE = /(checksums?|sha\d+|md5|sig|asc|pem|signature|\.txt$|\.sha\d+$|source[-_]?code|sources?\.jar)/i;
  var SOURCE_RE = /(source|src)[-_.]?(code)?\.(zip|tar|tgz|7z)/i;

  function assetScore(a) {
    var name = String(a.name || '');
    var s = 0;
    if (PRIMARY_RE.test(name)) s += 100;
    if (SOURCE_RE.test(name)) s -= 60;
    else if (SECONDARY_RE.test(name)) s -= 80;
    s += Math.min(Number(a.downloads) || 0, 100000) / 100000;
    return s;
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

  function releaseBlock(d) {
    var r = d.release;
    if (!r) {
      return '<div class="rs-release rs-release--empty">' +
        '<div class="rs-release-head"><span class="rs-kicker mono">LATEST RELEASE</span>' +
        '<span class="rs-tag rs-tag--none mono">暂无发布版本</span></div>' +
        '<p class="rs-no-assets">该仓库还没有正式 Release。</p>' +
        '<div class="rs-source mono"><a href="' + safeUrl((d.htmlUrl || '') + '/releases') +
        '" target="_blank" rel="noopener noreferrer">查看 Releases 页面 <i class="i-ico i-ext" aria-hidden="true"></i></a></div></div>';
    }
    var MAX = 3;
    var ordered = (r.assets || []).slice().sort(function (a, b) { return assetScore(b) - assetScore(a); });
    var visible = ordered.slice(0, MAX);
    var rest = ordered.length - visible.length;
    var assets = visible.length
      ? '<div class="rs-assets">' + visible.map(assetRow).join('') +
          (rest > 0 ? '<a class="rs-asset-more mono" href="' + safeUrl(r.url) +
            '" target="_blank" rel="noopener noreferrer">还有 ' + rest + ' 个文件 · 前往 Release 页面查看全部 <i class="i-ico i-ext" aria-hidden="true"></i></a>' : '') +
        '</div>'
      : '<p class="rs-no-assets">该版本没有上传安装包。</p>';
    var notes = r.body && r.body.trim()
      ? '<details class="rs-notes"><summary class="mono">更新日志 / RELEASE NOTES</summary><pre>' +
          esc(String(r.body).trim().slice(0, 1600)) + '</pre></details>'
      : '';
    return '<div class="rs-release">' +
      '<div class="rs-release-head"><span class="rs-kicker mono">LATEST RELEASE</span>' +
        '<span class="rs-tag mono">' + esc(r.tag) + '</span>' +
        '<span class="rs-date mono">' + esc(date(r.publishedAt)) + '</span></div>' +
      (r.name && r.name !== r.tag ? '<div class="rs-release-name">' + esc(r.name) + '</div>' : '') +
      assets +
      '<div class="rs-source mono">' +
        (r.sourceZip ? '<a href="' + safeUrl(r.sourceZip) + '" target="_blank" rel="noopener noreferrer">↓ 源码 .zip</a>' : '') +
        (r.sourceTar ? '<a href="' + safeUrl(r.sourceTar) + '" target="_blank" rel="noopener noreferrer">↓ 源码 .tar.gz</a>' : '') +
        '<a href="' + safeUrl(r.url) + '" target="_blank" rel="noopener noreferrer">查看 Release <i class="i-ico i-ext" aria-hidden="true"></i></a>' +
      '</div>' + notes + '</div>';
  }

  function repoCard(fullName, d, index) {
    var color = LANG_COLORS[d.language] || '#71829d';
    var meta = [];
    if (d.language) meta.push('<span class="rs-lang"><i style="background:' + esc(color) + '"></i>' + esc(d.language) + '</span>');
    meta.push('<span title="Star 数">★ ' + esc(compact(d.stars)) + '</span>');
    if (d.license) meta.push('<span>' + esc(d.license) + '</span>');
    if (d.homepage) meta.push('<a href="' + safeUrl(d.homepage) + '" target="_blank" rel="noopener noreferrer">官网 <i class="i-ico i-ext" aria-hidden="true"></i></a>');
    var num = String(index + 1).padStart(2, '0');
    return '<article class="rs-card" data-repo="' + esc(fullName) + '" style="animation-delay:' + Math.min(index, 8) * 55 + 'ms">' +
      '<span class="rs-card-line"></span>' +
      '<header class="rs-card-head">' +
        '<span class="rs-num mono">' + num + '</span>' +
        '<a class="rs-path mono" href="' + safeUrl(d.htmlUrl || ('https://github.com/' + fullName)) +
          '" target="_blank" rel="noopener noreferrer">' + esc(fullName) + ' <i class="i-ico i-ext" aria-hidden="true"></i></a>' +
      '</header>' +
      '<div class="rs-repo">' +
        (d.avatar ? '<img class="rs-avatar" src="' + safeUrl(d.avatar + (d.avatar.indexOf('?') >= 0 ? '&' : '?') + 's=96') + '" alt="" loading="lazy">' : '') +
        '<div class="rs-repo-main"><h3 class="rs-name">' + esc(d.name || fullName) + '</h3>' +
          '<div class="rs-meta mono">' + meta.join('') + '</div></div>' +
      '</div>' +
      '<p class="rs-description">' + esc(d.description) + '</p>' +
      releaseBlock(d) +
      '<div class="rs-card-foot mono"><span>' +
        (d.offline ? '静态快照 · ' + esc(date(d.generatedAt)) : '分享快照 · ' + esc(date(d.fetchedAt))) +
      '</span><a href="' + safeUrl((d.htmlUrl || '') + '/releases') + '" target="_blank" rel="noopener noreferrer">全部版本 <i class="i-ico i-ext" aria-hidden="true"></i></a></div>' +
    '</article>';
  }

  function repos(data) {
    var groups = (data && Array.isArray(data.groups)) ? data.groups : [];
    var snaps = (data && data.snapshots && typeof data.snapshots === 'object') ? data.snapshots : {};
    var html = '', index = 0, total = 0;
    groups.forEach(function (g) {
      var repos = (g && Array.isArray(g.repos)) ? g.repos : [];
      if (!repos.length) return;
      var cards = repos.map(function (name) {
        var d = snaps[name];
        return d && typeof d === 'object' ? repoCard(name, d, index++) : '';
      }).join('');
      if (!cards) return;
      total += repos.length;
      html += '<section class="rs-group" data-group="' + esc(g.name) + '">' +
        '<header class="rs-group-head"><span class="rs-group-mark mono" aria-hidden="true">▎</span>' +
        '<h3 class="rs-group-name">' + esc(g.name) + '</h3>' +
        '<span class="rs-group-count mono">' + repos.length + ' ' + (repos.length === 1 ? 'REPO' : 'REPOS') + '</span>' +
        '<span class="rs-group-rule" aria-hidden="true"></span></header>' +
        '<div class="rs-grid">' + cards + '</div></section>';
    });
    if (!html) {
      return '<div class="rs-empty"><div class="rs-empty-mark mono">[ ]</div>' +
        '<h3>分享里还没有项目</h3><p>发布者尚未收藏开源项目。</p></div>';
    }
    return '<div class="rs" data-total="' + total + '">' + html + '</div>';
  }

  function noteTagList(tags) {
    if (!Array.isArray(tags) || !tags.length) return '';
    return '<div class="nt-tags">' + tags.slice(0, 5).map(function (t) {
      return '<span class="nt-tag mono">#' + esc(t) + '</span>';
    }).join('') + '</div>';
  }

  function notes(data, MD) {
    var list = (data && Array.isArray(data.notes)) ? data.notes.slice() : [];
    list.sort(function (a, b) { return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0); });
    if (!list.length) {
      return '<div class="nt-empty"><div class="nt-empty-mark mono">[ ]</div>' +
        '<h3>分享里还没有笔记</h3><p>发布者尚未发布任何笔记。</p></div>';
    }
    var cards = list.map(function (n, i) {
      var cover = MD.coverOf(n.body);
      var excerpt = MD.excerpt(n.body, 108);
      return '<article class="nt-card" data-note="' + esc(n.id) + '">' +
        (cover ? '<div class="nt-card-cover"><img loading="lazy" src="' + cover + '" alt=""></div>'
               : '<div class="nt-card-cover nt-card-cover--ph"><span class="mono">NT / ' + esc(String(n.id).slice(0, 6)) + '</span></div>') +
        '<div class="nt-card-body">' +
          '<div class="nt-card-meta mono"><span class="nt-cat-pill">' + esc(n.category || '未分类') + '</span>' +
            '<time>' + esc(date(n.updatedAt)) + '</time></div>' +
          '<h3 class="nt-card-title">' + esc(n.title || '无标题') + '</h3>' +
          '<p class="nt-card-excerpt">' + esc(excerpt) + '</p>' + noteTagList(n.tags) +
        '</div>' +
        '<div class="nt-card-foot"><button class="nt-text-btn" data-read="' + esc(n.id) + '">阅读 →</button></div>' +
      '</article>';
    }).join('');

    // 阅读面板：全部正文预渲染，点击切换显示（纯前端，无编辑）
    var readers = list.map(function (n) {
      return '<article class="nt-article" data-reader="' + esc(n.id) + '" hidden>' +
        '<div class="nt-reader-bar"><button class="nt-back mono" data-back><i class="i-ico i-back" aria-hidden="true"></i> 返回列表</button></div>' +
        '<div class="nt-article-head">' +
          '<div class="nt-card-meta mono"><span class="nt-cat-pill">' + esc(n.category || '未分类') + '</span>' +
            '<time>更新于 ' + esc(date(n.updatedAt)) + '</time></div>' +
          '<h1 class="nt-article-title">' + esc(n.title || '无标题') + '</h1>' + noteTagList(n.tags) +
        '</div>' +
        '<div class="nt-markdown">' + MD.render(n.body) + '</div>' +
      '</article>';
    }).join('');

    return '<div class="nt nt--shared">' +
      '<div class="nt-head"><div class="nt-head-left">' +
        '<span class="nt-index mono">02 / NOTES</span>' +
        '<h2 class="nt-title">笔记 / 博客 <span class="nt-badge mono">' + list.length + ' NOTES</span></h2>' +
        '<p class="nt-sub">发布者公开的教程与灵感，支持图文、代码与内嵌视频。</p>' +
      '</div></div>' +
      '<div class="nt-statusbar mono"><span><i class="nt-led"></i> PUBLIC VIEW · 只读分享</span>' +
        '<span id="sh-note-count">' + list.length + ' 篇笔记</span></div>' +
      '<div class="nt-grid" id="sh-note-list">' + cards + '</div>' +
      '<div id="sh-note-readers">' + readers + '</div>' +
    '</div>';
  }

  NS.esc = esc;
  NS.repos = repos;
  NS.notes = notes;
})(window);
