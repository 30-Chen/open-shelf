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

  function normalize(repo, release, meta) {
    var fullName = repo.full_name;
    var rel = null;

    if (release) {
      var tag = release.tag_name || '';
      // 用 github.com 的归档链接，用户点击即可下载，不消耗 API 额度
      var tagSegment = tagPath(tag);
      var zip = 'https://github.com/' + fullName + '/archive/refs/tags/' + tagSegment + '.zip';
      var tar = 'https://github.com/' + fullName + '/archive/refs/tags/' + tagSegment + '.tar.gz';

      rel = {
        tag: tag,
        name: release.name || tag || 'Latest',
        publishedAt: release.published_at || '',
        url: release.html_url || 'https://github.com/' + fullName + '/releases',
        body: release.body || '',
        prerelease: !!release.prerelease,
        assets: (release.assets || []).map(function (a) {
          return {
            name: a.name || 'download',
            size: a.size || 0,
            downloads: a.download_count || 0,
            url: a.browser_download_url || '',
            type: a.content_type || ''
          };
        }),
        sourceZip: zip,
        sourceTar: tar
      };
    }

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
   * 拉取一个仓库的介绍 + 最新 Release（/releases/latest 自动排除草稿与预发布）
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
    var relUrl = base + '/repos/' + fullName + '/releases/latest';

    return Promise.all([
      Portal.net.getJSON(repoUrl, common),
      // 404 = 该项目从未发布过 Release，属于正常状态，不当作错误
      Portal.net.getJSON(relUrl, common).catch(function (err) {
        if (err.status === 404) return null;
        throw err;
      })
    ]).then(function (res) {
      return normalize(res[0].data, res[1] ? res[1].data : null, {
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
    return normalize(hit.repo, hit.release || null, {
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
    fromSnapshot: fromSnapshot
  };
})(window);
