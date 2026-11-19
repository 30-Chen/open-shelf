/* ============================================================
   repo-showcase/github.js · 数据适配层
   只负责「输入解析 + 调 GitHub API + 归一化数据结构」。
   不碰 DOM，方便日后替换数据源（例如换成 Actions 生成的 JSON）。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var NS = Portal.moduleAssets.repoShowcase;
  var NAME_RE = /^[A-Za-z0-9_.-]+$/;
  var MAX_RELEASES = 5;

  /* ---------- 平台识别（给下载文件按系统分类） ---------- */
  // 按「扩展名 → 关键字」的优先级判断，避免 x86_64.dmg 被误判成 Windows。
  function platformOf(rawName) {
    var n = String(rawName || '').toLowerCase();
    if (/\.apk$/.test(n) || /android/.test(n)) return 'android';
    if (/\.ipa$/.test(n) || /iphone|\bios\b/.test(n)) return 'ios';
    if (/\.(exe|msi|appx|msix)$/.test(n) || /windows|win32|win64|(^|[-_.])win([-_.]|$)/.test(n)) return 'windows';
    if (/\.(dmg|pkg|app|app\.tar\.gz)$/.test(n) || /macos|darwin|osx|\bmac\b|apple/.test(n)) return 'macos';
    if (/\.(deb|rpm|appimage|snap)$/.test(n) || /linux|gnu/.test(n)) return 'linux';
    return 'other';
  }

  /** 探测访问者当前设备平台；识别不了返回 ''（此时不优先任何平台） */
  function currentPlatform() {
    try {
      var nav = global.navigator || {};
      var ud = nav.userAgentData || {};
      var s = String(ud.platform || nav.platform || '').toLowerCase();
      var ua = String(nav.userAgent || '').toLowerCase();
      if (/android/.test(s) || /android/.test(ua)) return 'android';
      if (/iphone|ipad|ipod/.test(s) || /iphone|ipad|ipod/.test(ua)) return 'ios';
      if (/win/.test(s) || /windows/.test(ua)) return 'windows';
      if (/mac/.test(s) || /macintosh/.test(ua)) return 'macos';
      if (/linux|x11|cros/.test(s) || /linux|X11/i.test(ua)) return 'linux';
    } catch (e) { /* 环境不支持 navigator 时忽略 */ }
    return '';
  }

  /** 接受 owner/repo、github.com/owner/repo、完整链接、.git 结尾 */
  function parseInput(raw) {
    var text = String(raw || '').trim();
    if (!text) return { ok: false, error: '请输入 GitHub 仓库地址' };

    var parts;
    if (/^https?:\/\//i.test(text) || /^github\.com\//i.test(text)) {
      var url;
      try { url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text); }
      catch (e) { return { ok: false, error: '链接格式不正确' }; }
      if (url.hostname.toLowerCase() !== 'github.com') {
        return { ok: false, error: '只支持 github.com 的仓库地址' };
      }
      parts = url.pathname.split('/').filter(Boolean);
    } else {
      parts = text.split('/');
    }

    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return { ok: false, error: '格式应为 owner/repo 或完整的 GitHub 链接' };
    }
    var owner = parts[0];
    var repo = parts[1].replace(/\.git$/i, '');
    if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
      return { ok: false, error: '仓库名只能包含字母、数字、. _ -' };
    }
    return { ok: true, fullName: owner + '/' + repo };
  }

  function tagPath(tag) {
    // tag 里可能含斜杠（如 release/v1.2），分段编码才不会破坏路径
    return String(tag).split('/').map(encodeURIComponent).join('/');
  }

  /** 把一条 GitHub release 归一化；assets 附带识别出的平台 */
  function normalizeRelease(release, fullName) {
    var tag = release.tag_name || '';
    // 用 github.com 的归档链接，用户点击即可下载，不消耗 API 额度
    var tagSegment = tagPath(tag);
    var zip = 'https://github.com/' + fullName + '/archive/refs/tags/' + tagSegment + '.zip';
    var tar = 'https://github.com/' + fullName + '/archive/refs/tags/' + tagSegment + '.tar.gz';
    return {
      tag: tag,
      name: release.name || tag || 'Latest',
      publishedAt: release.published_at || '',
      url: release.html_url || 'https://github.com/' + fullName + '/releases',
      body: release.body || '',
      prerelease: !!release.prerelease,
      assets: (release.assets || []).map(function (a) {
        var name = a.name || 'download';
        return {
          name: name,
          size: a.size || 0,
          downloads: a.download_count || 0,
          url: a.browser_download_url || '',
          type: a.content_type || '',
          platform: platformOf(name)
        };
      }),
      sourceZip: zip,
      sourceTar: tar
    };
  }

  /**
   * 归一化仓库 +  releases。release 既兼容旧的单条对象，也接受多条数组。
   * d.release 永远指向最新版本，d.releases 保存全部版本。
   */
  function normalize(repo, releases, meta) {
    var fullName = repo.full_name;
    var list = Array.isArray(releases) ? releases : (releases ? [releases] : []);
    var normalized = list.map(function (r) { return normalizeRelease(r, fullName); });
    // 稳定版优先、预览版靠后；同档按发布时间倒序
    var rank = function (r) { return r.prerelease ? 1 : 0; };
    normalized.sort(function (a, b) {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    });
    var rel = normalized[0] || null;

    return {
      fullName: fullName,
      name: repo.name || fullName,
      owner: (repo.owner && repo.owner.login) || fullName.split('/')[0],
      htmlUrl: repo.html_url || 'https://github.com/' + fullName,
      description: repo.description || '该项目暂未填写介绍。',
      homepage: repo.homepage || '',
      language: repo.language || '',
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      license: (repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION')
        ? repo.license.spdx_id : '',
      topics: (repo.topics || []).slice(0, 6),
      avatar: (repo.owner && repo.owner.avatar_url) || '',
      release: rel,
      releases: normalized.slice(0, MAX_RELEASES),
      cached: !!meta.cached,
      remaining: meta.remaining,
      offline: !!meta.offline,
      generatedAt: meta.generatedAt || null,
      fetchedAt: (meta.offline && meta.generatedAt)
        ? (new Date(meta.generatedAt).getTime() || Date.now())
        : Date.now()
    };
  }

  /**
   * 拉取一个仓库的介绍 + 最近多个 Release（按 per_page 取前若干条，已过滤草稿）
   * @returns Promise<normalized>
   */
  function fetchSnapshot(fullName, opts) {
    opts = opts || {};
    var base = String(opts.apiBase || 'https://api.github.com').replace(/\/+$/, '');
    var common = {
      token: opts.token || '',
      cacheMs: opts.cacheMs || 0,
      force: !!opts.force
    };
    var repoUrl = base + '/repos/' + fullName;
    // 取稍多几条再本地裁剪：GitHub 会把草稿/预发布也列进来，这里统一过滤。
    var relUrl = base + '/repos/' + fullName + '/releases?per_page=' + (MAX_RELEASES + 5);

    return Promise.all([
      Portal.net.getJSON(repoUrl, common),
      // 404 = 该项目从未发布过 Release，属于正常状态，不当作错误
      Portal.net.getJSON(relUrl, common).catch(function (err) {
        if (err.status === 404) return null;
        throw err;
      })
    ]).then(function (res) {
      var raw = res[1] && Array.isArray(res[1].data) ? res[1].data : [];
      // 去掉草稿（draft 不对外可见），归一化时再排除多余条目
      raw = raw.filter(function (r) { return r && !r.draft; });
      return normalize(res[0].data, raw, {
        cached: res[0].cached && (!res[1] || res[1].cached),
        remaining: res[0].remaining
      });
    });
  }

  /**
   * 读取仓库里可选的静态快照（由 tools/update-snapshot.mjs 生成）。
   * 文件不存在、file:// 下被 CORS 拦截、网络异常时一律返回 null，不影响主流程。
   */
  function loadLocalSnapshot(url) {
    return global.fetch(url || 'data/snapshot.json', { headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  /** 把快照里的原始 repo/release 交给同一个 normalize，保证两种数据源结构一致 */
  function fromSnapshot(snapshot, fullName) {
    if (!snapshot || !snapshot.repos) return null;
    var hit = snapshot.repos[fullName];
    if (!hit && snapshot.repos) {
      var key = Object.keys(snapshot.repos).filter(function (k) {
        return k.toLowerCase() === String(fullName).toLowerCase();
      })[0];
      hit = key ? snapshot.repos[key] : null;
    }
    if (!hit || !hit.repo) return null;
    // 新快照带 releases 数组；旧快照只有单条 release，normalize 会统一处理
    var releases = Array.isArray(hit.releases) ? hit.releases : hit.release;
    return normalize(hit.repo, releases || null, {
      cached: true,
      remaining: null,
      offline: true,
      generatedAt: snapshot.generatedAt
    });
  }

  NS.github = {
    parseInput: parseInput,
    fetchSnapshot: fetchSnapshot,
    loadLocalSnapshot: loadLocalSnapshot,
    fromSnapshot: fromSnapshot,
    platformOf: platformOf,
    currentPlatform: currentPlatform,
    MAX_RELEASES: MAX_RELEASES
  };
})(window);
