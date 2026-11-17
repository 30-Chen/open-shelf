/* ============================================================
   core/sync.js · 全自动跨设备同步内核（本地优先 + GitHub Gist）
   职责：
     1. 采集各模块通过 registry.sync 暴露的 getState()/cold() 数据
     2. 本地改动自动检测 → 防抖后自动上传；云端变化自动轮询 → 自动下载
     3. 冲突按「最后修改时间戳」裁决，不静默丢数据
     4. 上传前把「当前页面未挂载模块」的云端数据合并回去，避免覆盖
     5. 悬浮面板 UI：自动开关、配置、状态、手动上传/下载

   数据只写进用户自己的私有 Gist，token 只存在本机 localStorage，
   不进入仓库、不经过任何第三方。模块之间仍互不引用，仅通过注册表通信。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var store = Portal.store.namespace('_sync');

  var API = 'https://api.github.com';
  var FILE = 'open-shelf.json';
  var DESC = 'Open Shelf · 跨设备同步（自动生成，请勿手动修改）';

  // 调度参数
  var LOCAL_TICK = 1500;    // 本地哈希检测间隔
  var CLOUD_TICK = 15000;   // 云端轮询间隔
  var DEBOUNCE = 2500;      // 本地改动后等待上传的防抖
  var SKEW = 1500;          // 时间戳裁决容差，避免双方同时认为「我更新」

  var cfg = {
    token: store.get('token', '') || '',
    gistId: store.get('gistId', '') || '',
    syncedHash: store.get('syncedHash', '') || '',   // 上次同步成功的完整 payload 哈希
    localHash: store.get('localHash', '') || '',     // 上次同步成功时本地模块数据哈希
    syncedAt: Number(store.get('syncedAt', 0)) || 0,
    localChangedAt: Number(store.get('localChangedAt', 0)) || 0,
    auto: store.get('auto', true) !== false,
    shareGistId: store.get('shareGistId', '') || '',  // 公开分享用的独立 Gist（与私有同步 Gist 分开）
    shareOwner: store.get('shareOwner', '') || '',    // 公开 Gist 所属用户名，用于拼 raw 链接
    shareAt: Number(store.get('shareAt', 0)) || 0
  };

  function saveCfg() {
    store.set('token', cfg.token);
    store.set('gistId', cfg.gistId);
    store.set('syncedHash', cfg.syncedHash);
    store.set('localHash', cfg.localHash);
    store.set('syncedAt', cfg.syncedAt);
    store.set('localChangedAt', cfg.localChangedAt);
    store.set('auto', cfg.auto);
    store.set('shareGistId', cfg.shareGistId);
    store.set('shareOwner', cfg.shareOwner);
    store.set('shareAt', cfg.shareAt);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* FNV-1a 32 位：只用于判断「内容是否变化」，不用于安全用途 */
  function hash(str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function hashModules(modules) { return hash(JSON.stringify(modules || {})); }

  /* ---------- 模块数据聚合（热数据 + 冷数据） ---------- */
  function syncDefs() {
    return Portal.registry.list().filter(function (def) {
      var s = def && def.sync;
      return s && (typeof s.getState === 'function' || typeof s.cold === 'function');
    });
  }

  /** 采集所有模块数据：已挂载用内存态，未挂载读 localStorage 冷数据 */
  function collectLocal() {
    var modules = {};
    syncDefs().forEach(function (def) {
      var s = def.sync;
      var data = null;
      try {
        if (typeof s.ready === 'function' && s.ready()) data = s.getState();
        else if (typeof s.cold === 'function') data = s.cold();
      } catch (e) { console.error('[sync] collect ' + def.id, e); }
      if (data && typeof data === 'object') modules[def.id] = data;
    });
    return modules;
  }

  /** 把云端数据写回模块：已挂载走 applyState（即时重绘），未挂载走 applyCold（写存储） */
  function applyRemote(modules) {
    var applied = [], failed = [];
    syncDefs().forEach(function (def) {
      if (!Object.prototype.hasOwnProperty.call(modules, def.id)) return;
      var s = def.sync;
      try {
        if (typeof s.ready === 'function' && s.ready() && typeof s.applyState === 'function') {
          s.applyState(modules[def.id]);
        } else if (typeof s.applyCold === 'function') {
          s.applyCold(modules[def.id]);
        } else {
          return; // 模块未挂载且未提供冷写入能力，跳过（下次挂载读旧数据）
        }
        applied.push(def.id);
      } catch (e) { console.error('[sync] apply ' + def.id, e); failed.push(def.id); }
    });
    return { applied: applied, failed: failed };
  }

  /** 上传前把「当前页面没提供的模块」从云端保留下来，避免整包覆盖丢数据 */
  function mergeModules(remoteModules, localModules) {
    var out = {};
    Object.keys(remoteModules || {}).forEach(function (k) { out[k] = remoteModules[k]; });
    Object.keys(localModules || {}).forEach(function (k) { out[k] = localModules[k]; });
    return out;
  }

  /* ---------- GitHub API ---------- */
  function friendlyError(err) {
    var status = err && err.status;
    var msg = err && err.message ? err.message : String(err);
    if (status === 401) return 'Token 无效或已过期（401），请重新生成';
    if (status === 403) return 'Token 缺少 gist 权限，或 API 额度用尽（403）';
    if (status === 404) return '找不到该 Gist（404），可能已被删除或 Token 无权访问';
    if (status === 422) return '数据格式被 GitHub 拒绝（422）';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '无法连接 GitHub API（网络不通或被拦截）';
    return msg;
  }

  function request(method, path, body) {
    var headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    var init = { method: method, headers: headers };
    if (body != null) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(API + path, init).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* 非 JSON 响应 */ }
        if (!res.ok) {
          var err = new Error((data && data.message) || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }).catch(function (e) {
      var wrapped = new Error(friendlyError(e));
      wrapped.status = e && e.status;
      throw wrapped;
    });
  }

  function parseGist(gist) {
    var file = gist && gist.files && gist.files[FILE];
    if (!file || !file.content) return null;
    try { return JSON.parse(file.content); } catch (e) { return null; }
  }

  function readRemote() {
    if (!cfg.gistId) return Promise.resolve(null);
    return request('GET', '/gists/' + encodeURIComponent(cfg.gistId)).then(function (g) {
      return { gist: g, payload: parseGist(g) };
    });
  }

  /** 把模块数据写进 Gist（不存在则创建私有 Gist） */
  function writeGist(merged, localModules, mergedHash) {
    var content = JSON.stringify({
      app: 'open-shelf', version: 1, updatedAt: Date.now(), modules: merged
    }, null, 2);
    var method = cfg.gistId ? 'PATCH' : 'POST';
    var path = cfg.gistId ? '/gists/' + encodeURIComponent(cfg.gistId) : '/gists';
    var body = cfg.gistId
      ? { files: {} }
      : { description: DESC, public: false, files: {} };
    body.files[FILE] = { content: content };
    return request(method, path, body).then(function (g) {
      cfg.gistId = g.id;
      cfg.syncedHash = mergedHash;
      cfg.localHash = hashModules(localModules);
      cfg.syncedAt = Date.now();
      saveCfg();
      return { ok: true, id: g.id, htmlUrl: g.html_url, count: Object.keys(merged).length };
    });
  }

  /* ---------- 调度器状态 ---------- */
  var syncing = false;
  var lastSeenLocalHash = null;
  var debounceTimer = null;
  var localTimer = null;
  var cloudTimer = null;
  var lastAuto = { at: 0, result: null, reason: '' };

  /** 单次对账：读云端 → 判定方向 → 上传/下载/无事 */
  function reconcile(reason) {
    reason = reason || 'manual';
    if (syncing) return Promise.resolve({ skipped: true });
    if (!cfg.token) return Promise.resolve({ error: '请先填写 GitHub Token' });
    // 允许无 gistId：本地有数据时会自动新建私有 Gist（见下方 writeGist）

    syncing = true;
    var localModules = collectLocal();
    var localHash = hashModules(localModules);

    // 404 视为云端不存在，后续重建；其它错误原样抛出
    return readRemote().catch(function (e) {
      if (e && e.status === 404) return null;
      throw e;
    }).then(function (remote) {
      var localDirty = localHash !== cfg.localHash;
      var remoteHash = remote && remote.payload ? hashModules(remote.payload.modules) : '';
      var remoteChanged = !!cfg.gistId && remoteHash !== cfg.syncedHash;

      // 云端文件缺失：用本地数据新建 Gist
      if (!remote || !remote.payload) {
        if (!Object.keys(localModules).length) return { error: '云端与本地都没有可同步的数据' };
        return writeGist(localModules, localModules, localHash);
      }

      var remoteModules = remote.payload.modules || {};
      var remoteTs = Date.parse(remote.gist.updated_at) || Number(remote.payload.updatedAt) || 0;

      if (!localDirty && !remoteChanged) {
        return { ok: true, note: 'in-sync', remoteHash: remoteHash };
      }

      // 上传方向：仅本地变；或双方都变但本地时间更新
      var localWins = localDirty && (!remoteChanged || cfg.localChangedAt > remoteTs + SKEW);
      if (localWins) {
        var merged = mergeModules(remoteModules, localModules);
        return writeGist(merged, localModules, hashModules(merged));
      }

      // 下载方向：仅云端变；或双方都变但云端更新
      var r = applyRemote(remoteModules);
      cfg.syncedHash = remoteHash;
      cfg.localHash = hashModules(collectLocal());
      cfg.syncedAt = remoteTs || Date.now();
      saveCfg();
      r.ok = true;
      r.remoteAt = remote.gist.updated_at;
      r.htmlUrl = remote.gist.html_url;
      if (r.failed.length) r.error = r.failed.length + ' 个模块应用失败，已保留本地数据';
      return r;
    }).catch(function (e) {
      return { error: e && e.message || String(e) };
    }).then(function (r) {
      syncing = false;
      lastSeenLocalHash = hashModules(collectLocal());
      lastAuto = { at: Date.now(), result: r, reason: reason };
      if (Portal.bus && Portal.bus.emit) Portal.bus.emit('sync:auto', lastAuto);
      return r;
    });
  }

  function autoRun(reason) {
    if (!cfg.auto || !cfg.token) return;
    reconcile(reason); // 内部吞掉异常，结果在 lastAuto / 事件里
  }

  function startScheduler() {
    if (localTimer) return;

    var initial = hashModules(collectLocal());
    lastSeenLocalHash = initial;
    var bootReason = null;
    // 上次同步后本地又变了（例如另一标签页编辑）
    if (cfg.localHash && initial !== cfg.localHash) {
      cfg.localChangedAt = Date.now();
      saveCfg();
      bootReason = 'startup';
    }
    // 已配置 token 但还没 Gist，且本地有数据：启动时自动建库备份
    if (!bootReason && cfg.token && !cfg.gistId && Object.keys(collectLocal()).length) {
      bootReason = 'first-upload';
    }
    if (bootReason) global.setTimeout(function () { autoRun(bootReason); }, 800);

    // 本地改动检测：允许无 Gist（首次改动会自动建私有 Gist）
    localTimer = global.setInterval(function () {
      if (!cfg.auto || !cfg.token) return;
      if (global.document && global.document.hidden) return;
      var h = hashModules(collectLocal());
      if (h === lastSeenLocalHash) return;
      lastSeenLocalHash = h;
      cfg.localChangedAt = Date.now();
      saveCfg();
      global.clearTimeout(debounceTimer);
      debounceTimer = global.setTimeout(function () { autoRun('local-change'); }, DEBOUNCE);
    }, LOCAL_TICK);

    // 云端轮询：必须已有 Gist 才有意义
    cloudTimer = global.setInterval(function () {
      if (!cfg.auto || !cfg.token || !cfg.gistId) return;
      if (global.document && global.document.hidden) return;
      autoRun('cloud-poll');
    }, CLOUD_TICK);

    if (global.document && global.document.addEventListener) {
      global.document.addEventListener('visibilitychange', function () {
        if (!global.document.hidden) autoRun('visible');
      });
    }
  }

  /* ---------- 公开只读分享（与私有同步 Gist 完全分开） ---------- */
  var SHARE_DESC = 'Open Shelf · 公开只读分享（自动生成，请勿手动修改）';

  function buildShareUrl() {
    if (!cfg.shareGistId) return '';
    var base = './';
    try {
      var href = (global.location && global.location.href) || '';
      base = href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    } catch (e) { /* 保持默认 */ }
    return base + 'share.html?id=' + encodeURIComponent(cfg.shareGistId) +
      (cfg.shareOwner ? '&owner=' + encodeURIComponent(cfg.shareOwner) : '');
  }

  /** 采集所有模块数据（含未挂载模块的冷数据），写进公开 Gist。绝不写入 token / 本地偏好。 */
  function publishShare() {
    if (!cfg.token) return Promise.resolve({ error: '请先填写 GitHub Token' });
    var modules = collectLocal();
    if (!Object.keys(modules).length) return Promise.resolve({ error: '本地还没有可分享的数据，请先添加项目或笔记' });
    var content = JSON.stringify({
      app: 'open-shelf-share', version: 1, updatedAt: Date.now(), modules: modules
    }, null, 2);
    var method = cfg.shareGistId ? 'PATCH' : 'POST';
    var path = cfg.shareGistId ? '/gists/' + encodeURIComponent(cfg.shareGistId) : '/gists';
    var body = cfg.shareGistId
      ? { files: {} }
      : { description: SHARE_DESC, public: true, files: {} };
    body.files[FILE] = { content: content };
    return request(method, path, body).then(function (g) {
      cfg.shareGistId = g.id;
      cfg.shareOwner = (g.owner && g.owner.login) || cfg.shareOwner || '';
      cfg.shareAt = Date.now();
      saveCfg();
      return { ok: true, id: g.id, owner: cfg.shareOwner, count: Object.keys(modules).length, url: buildShareUrl() };
    }).catch(function (e) {
      return { error: e && e.message || String(e) };
    });
  }

  /** 停止分享：清本地关联；removeRemote=true 时同时删除远端公开 Gist */
  function unpublishShare(removeRemote) {
    var id = cfg.shareGistId;
    cfg.shareGistId = '';
    cfg.shareOwner = '';
    cfg.shareAt = 0;
    saveCfg();
    if (!removeRemote || !id) return Promise.resolve({ ok: true });
    return request('DELETE', '/gists/' + encodeURIComponent(id))
      .then(function () { return { ok: true }; })
      .catch(function (e) { return { error: e && e.message || String(e) }; });
  }

  /* ---------- 对外操作 ---------- */
  var sync = {
    config: cfg,
    saveConfig: saveCfg,
    hash: hash,
    reconcile: reconcile,
    lastAuto: function () { return lastAuto; },

    setAuto: function (on) {
      cfg.auto = !!on;
      saveCfg();
      if (cfg.auto) autoRun('enabled');
      return cfg.auto;
    },

    /** 本地是否有未同步改动 */
    localDirty: function () {
      if (!cfg.localHash) return collectLocalModulesCount() > 0;
      return hashModules(collectLocal()) !== cfg.localHash;
    },

    /** 手动上传（保留兼容） */
    push: function (opts) {
      opts = opts || {};
      if (!cfg.token) return Promise.resolve({ error: '请先填写 GitHub Token' });
      if (!collectLocalModulesCount()) return Promise.resolve({ error: '请先进入某个模块，再执行同步' });
      var localModules = collectLocal();
      var localHash = hashModules(localModules);
      return readRemote().catch(function (e) {
        if (e && e.status === 404) return null;
        throw e;
      }).then(function (remote) {
        var remoteModules = remote && remote.payload ? (remote.payload.modules || {}) : {};
        var remoteHash = hashModules(remoteModules);
        if (cfg.gistId && remoteHash && remoteHash !== cfg.syncedHash && !opts.force) {
          return { needConfirm: true, kind: 'push' };
        }
        var merged = mergeModules(remoteModules, localModules);
        return writeGist(merged, localModules, hashModules(merged));
      }).catch(function (e) {
        return { error: e && e.message || String(e) };
      });
    },

    /** 手动下载（保留兼容） */
    pull: function (opts) {
      opts = opts || {};
      if (!cfg.token) return Promise.resolve({ error: '请先填写 GitHub Token' });
      if (!cfg.gistId) return Promise.resolve({ error: '请先填写 Gist ID（或先上传一次）' });
      if (!collectLocalModulesCount()) return Promise.resolve({ error: '请先进入某个模块，再执行同步' });
      return readRemote().then(function (remote) {
        if (!remote || !remote.payload) return { error: '云端没有找到同步数据文件（' + FILE + '）' };
        var remoteModules = remote.payload.modules || {};
        var remoteHash = hashModules(remoteModules);
        var localDirty = hashModules(collectLocal()) !== cfg.localHash;
        if (localDirty && !opts.force) return { needConfirm: true, kind: 'pull' };
        var r = applyRemote(remoteModules);
        cfg.syncedHash = remoteHash;
        cfg.localHash = hashModules(collectLocal());
        cfg.syncedAt = Date.parse(remote.gist.updated_at) || Date.now();
        saveCfg();
        r.ok = true;
        r.remoteAt = remote.gist.updated_at;
        r.htmlUrl = remote.gist.html_url;
        return r;
      }).catch(function (e) {
        return { error: e && e.message || String(e) };
      });
    },

    /** 断开：清掉关联，保留 token 与自动开关，本地数据不动 */
    disconnect: function () {
      cfg.gistId = '';
      cfg.syncedHash = '';
      cfg.localHash = '';
      cfg.syncedAt = 0;
      cfg.localChangedAt = 0;
      saveCfg();
    },

    publishShare: publishShare,
    unpublishShare: unpublishShare,
    shareUrl: buildShareUrl
  };

  function collectLocalModulesCount() { return Object.keys(collectLocal()).length; }

  Portal.sync = sync;

  /* ---------- 悬浮面板 UI ---------- */
  function fmtTime(ts) {
    if (!ts) return '从未';
    try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }
    catch (e) { return String(ts); }
  }

  function autoText() {
    var r = lastAuto.result;
    if (!lastAuto.at) return '等待首次检查';
    if (!r) return '检查中…';
    if (r.skipped) return '正在同步…';
    if (r.error) return '出错 · ' + String(r.error).slice(0, 40);
    if (r.note === 'in-sync') return '已是最新';
    if (r.ok && r.applied) return '已下载 ' + r.applied.length + ' 个模块';
    if (r.ok && r.count) return '已上传 ' + r.count + ' 个模块';
    return '检查完成';
  }

  function buildUI() {
    if (document.getElementById('sy-fab')) return;

    var fab = document.createElement('button');
    fab.id = 'sy-fab';
    fab.className = 'sy-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', '跨设备同步设置');
    fab.innerHTML = '<span class="sy-fab-icon" aria-hidden="true">☁</span>' +
      '<span class="sy-fab-dot" id="sy-dot"></span>';

    var panel = document.createElement('section');
    panel.id = 'sy-panel';
    panel.className = 'sy-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', '跨设备同步面板');
    panel.innerHTML = '' +
      '<div class="sy-head">' +
        '<div>' +
          '<span class="sy-kicker mono">AUTO SYNC / GIST</span>' +
          '<h3 class="sy-title">跨设备同步</h3>' +
        '</div>' +
        '<button class="sy-close" id="sy-close" type="button" aria-label="关闭">×</button>' +
      '</div>' +

      '<div class="sy-state" id="sy-state"></div>' +

      '<div class="sy-auto-row">' +
        '<div class="sy-auto-label">自动同步<span>本地改动自动上传，云端变化自动下载</span></div>' +
        '<button class="sy-switch" id="sy-auto" type="button" role="switch" aria-checked="false">' +
          '<span class="sy-switch-knob"></span>' +
        '</button>' +
      '</div>' +

      '<div class="sy-fields">' +
        '<label class="sy-label">GitHub Token' +
          '<span class="sy-label-hint">只需 gist 权限 · 仅存本机</span>' +
          '<input class="sy-input" id="sy-token" type="password" autocomplete="off" ' +
            'spellcheck="false" placeholder="ghp_…" value="' + esc(cfg.token) + '">' +
        '</label>' +
        '<label class="sy-label">Gist ID' +
          '<span class="sy-label-hint">首次上传后自动填写，换设备时手动填入</span>' +
          '<input class="sy-input" id="sy-gist" type="text" autocomplete="off" ' +
            'spellcheck="false" placeholder="例如 0a1b2c3d…" value="' + esc(cfg.gistId) + '">' +
        '</label>' +
      '</div>' +

      '<div class="sy-actions">' +
        '<button class="btn btn--primary sy-btn" id="sy-push" type="button">↑ 上传</button>' +
        '<button class="btn sy-btn" id="sy-pull" type="button">↓ 下载</button>' +
      '</div>' +
      '<div class="sy-actions sy-actions--sub">' +
        '<button class="sy-link" id="sy-disconnect" type="button">断开关联</button>' +
        '<a class="sy-link" href="https://github.com/settings/tokens/new?scopes=gist&description=Open%20Shelf%20Sync" ' +
          'target="_blank" rel="noopener noreferrer">获取 Token ↗</a>' +
      '</div>' +

      '<div class="sy-share">' +
        '<div class="sy-share-head">' +
          '<span class="sy-kicker mono">PUBLIC VIEW / 只读分享</span>' +
          '<span class="sy-share-pill mono" id="sy-share-pill">未发布</span>' +
        '</div>' +
        '<p class="sy-share-desc">把当前内容复制到一个<strong>公开</strong> Gist，生成只读链接。任何人可查看，但无法修改；与上面的私有同步 Gist 完全分开。</p>' +
        '<div class="sy-share-url" id="sy-share-url" hidden>' +
          '<input class="sy-input" id="sy-share-link" type="text" readonly value="">' +
          '<button class="sy-link" id="sy-share-copy" type="button">复制链接</button>' +
        '</div>' +
        '<div class="sy-actions sy-share-actions">' +
          '<button class="btn btn--primary sy-btn" id="sy-share-publish" type="button">⇧ 发布 / 更新分享</button>' +
          '<button class="btn sy-btn" id="sy-share-stop" type="button" hidden>停止分享</button>' +
        '</div>' +
      '</div>' +

      '<p class="sy-msg mono" id="sy-msg" role="status"></p>' +
      '<p class="sy-note">私有同步 Gist 仅你自己可读写；公开分享 Gist 任何人可读、仅你可写，两者独立。Token 只保存在当前浏览器，不写进仓库、不发第三方；公开分享只上传模块数据，不含 Token。自动同步每 15 秒检查云端一次，本地改动约 2 秒后自动上传。</p>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    var msgEl = panel.querySelector('#sy-msg');
    var stateEl = panel.querySelector('#sy-state');
    var tokenEl = panel.querySelector('#sy-token');
    var gistEl = panel.querySelector('#sy-gist');
    var autoBtn = panel.querySelector('#sy-auto');
    var timer = null;

    function msg(text, kind) {
      msgEl.textContent = text || '';
      msgEl.className = 'sy-msg mono' + (kind ? ' sy-msg--' + kind : '');
      global.clearTimeout(timer);
      if (text) timer = global.setTimeout(function () {
        msgEl.textContent = '';
        msgEl.className = 'sy-msg mono';
      }, 8000);
    }

    function refresh() {
      var dirty = sync.localDirty();
      var ready = !!cfg.token && !!cfg.gistId;
      var last = lastAuto.result;
      var hasError = !!(last && last.error);
      var dot = panel.querySelector('#sy-dot');
      dot.className = 'sy-fab-dot' +
        (!ready || !cfg.auto ? '' : (hasError ? ' is-error' : (dirty ? ' is-dirty' : ' is-synced')));

      autoBtn.className = 'sy-switch' + (cfg.auto ? ' is-on' : '');
      autoBtn.setAttribute('aria-checked', cfg.auto ? 'true' : 'false');

      var providers = syncDefs();
      var modules = providers.length
        ? providers.map(function (d) {
            return '<span class="sy-tag mono">' + esc(d.index || d.id) + ' ' + esc(d.title || d.id) + '</span>';
          }).join('')
        : '<span class="sy-tag sy-tag--warn mono">暂无模块</span>';

      var stateText = !ready
        ? (cfg.token ? '待关联 Gist' : '未配置')
        : (!cfg.auto ? '自动已关闭' : (dirty ? '本地有改动' : '已同步'));

      stateEl.innerHTML = '' +
        '<div class="sy-state-row"><span>状态</span><b class="' +
          (!ready || !cfg.auto ? 'sy-s0' : (hasError ? 'sy-s3' : (dirty ? 'sy-s2' : 'sy-s1'))) + '">' +
          esc(stateText) + '</b></div>' +
        '<div class="sy-state-row"><span>自动检查</span><b class="mono">' + esc(autoText()) + '</b></div>' +
        '<div class="sy-state-row"><span>Gist</span><b class="mono">' +
          (cfg.gistId ? esc(cfg.gistId.slice(0, 10)) + '…' : '—') + '</b></div>' +
        '<div class="sy-state-row"><span>上次同步</span><b class="mono">' + fmtTime(cfg.syncedAt) + '</b></div>' +
        '<div class="sy-tags">' + modules + '</div>';

      // 公开分享区：发布状态、链接、停止按钮
      var pill = panel.querySelector('#sy-share-pill');
      var urlBox = panel.querySelector('#sy-share-url');
      var linkInput = panel.querySelector('#sy-share-link');
      var stopBtn = panel.querySelector('#sy-share-stop');
      if (cfg.shareGistId) {
        pill.textContent = '已发布';
        pill.className = 'sy-share-pill mono is-live';
        urlBox.hidden = false;
        linkInput.value = buildShareUrl();
        stopBtn.hidden = false;
      } else {
        pill.textContent = '未发布';
        pill.className = 'sy-share-pill mono';
        urlBox.hidden = true;
        stopBtn.hidden = true;
      }
    }

    function commitConfig() {
      cfg.token = tokenEl.value.trim();
      cfg.gistId = gistEl.value.trim().replace(/^.*gists\//, '').replace(/[/?#].*$/, '');
      if (gistEl.value !== cfg.gistId) gistEl.value = cfg.gistId;
      saveCfg();
      refresh();
      if (cfg.token && cfg.auto) autoRun('config-change');
    }

    function run(action, force) {
      var btn = action === 'push' ? panel.querySelector('#sy-push') : panel.querySelector('#sy-pull');
      btn.disabled = true;
      msg(action === 'push' ? '正在上传…' : '正在下载…');
      sync[action]({ force: !!force }).then(function (r) {
        if (r && r.needConfirm) {
          var ok = action === 'push'
            ? global.confirm('云端已有其它设备的更新，继续上传会用本地数据覆盖云端。确定继续？')
            : global.confirm('本地有尚未上传的改动，继续下载会用云端数据覆盖本地。确定继续？');
          if (ok) return run(action, true);
          msg('已取消', 'warn');
          return;
        }
        if (r && r.error) { msg(r.error, 'error'); return; }
        if (action === 'push') {
          gistEl.value = cfg.gistId;
          msg('已上传 · Gist ' + (r.id || '').slice(0, 10) + '… · ' + r.count + ' 个模块', 'ok');
        } else {
          msg('已下载 · 更新 ' + (r.applied || []).length + ' 个模块', 'ok');
        }
      }).catch(function (e) {
        msg(e && e.message || String(e), 'error');
      }).then(function () {
        btn.disabled = false;
        refresh();
      });
    }

    // 自动同步结果只更新状态行；出错时在面板消息区提示
    if (Portal.bus && Portal.bus.on) {
      Portal.bus.on('sync:auto', function (info) {
        refresh();
        if (info && info.result && info.result.error && !panel.hidden) {
          msg('自动同步：' + info.result.error, 'error');
        }
      });
    }

    fab.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) { refresh(); tokenEl.focus(); }
    });
    panel.querySelector('#sy-close').addEventListener('click', function () { panel.hidden = true; });
    tokenEl.addEventListener('change', commitConfig);
    gistEl.addEventListener('change', commitConfig);
    autoBtn.addEventListener('click', function () {
      var on = sync.setAuto(!cfg.auto);
      refresh();
      msg(on ? '自动同步已开启' : '自动同步已关闭', on ? 'ok' : 'warn');
    });
    panel.querySelector('#sy-push').addEventListener('click', function () { commitConfig(); run('push'); });
    panel.querySelector('#sy-pull').addEventListener('click', function () { commitConfig(); run('pull'); });
    panel.querySelector('#sy-disconnect').addEventListener('click', function () {
      if (!global.confirm('断开后将不再关联云端，本地数据保持不变。确定继续？')) return;
      sync.disconnect();
      gistEl.value = '';
      refresh();
      msg('已断开关联', 'warn');
    });

    // ---- 公开只读分享 ----
    var sharePublishBtn = panel.querySelector('#sy-share-publish');
    var shareStopBtn = panel.querySelector('#sy-share-stop');
    var shareLinkInput = panel.querySelector('#sy-share-link');

    sharePublishBtn.addEventListener('click', function () {
      commitConfig(); // 确保 token 已保存
      if (!cfg.token) { msg('请先填写 GitHub Token', 'error'); tokenEl.focus(); return; }
      sharePublishBtn.disabled = true;
      msg('正在发布到公开 Gist…');
      sync.publishShare().then(function (r) {
        if (r && r.error) { msg(r.error, 'error'); return; }
        refresh();
        msg('已发布 · ' + (r.count || 0) + ' 个模块 · 链接已生成', 'ok');
      }).catch(function (e) {
        msg(e && e.message || String(e), 'error');
      }).then(function () { sharePublishBtn.disabled = false; });
    });

    panel.querySelector('#sy-share-copy').addEventListener('click', function () {
      var text = shareLinkInput.value;
      if (!text) return;
      function done() { msg('分享链接已复制', 'ok'); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          shareLinkInput.select(); document.execCommand && document.execCommand('copy'); done();
        });
      } else {
        shareLinkInput.select(); document.execCommand && document.execCommand('copy'); done();
      }
    });

    shareStopBtn.addEventListener('click', function () {
      if (!global.confirm('停止分享会删除这个公开 Gist，已发出的分享链接将立即失效。确定继续？')) return;
      shareStopBtn.disabled = true;
      sync.unpublishShare(true).then(function (r) {
        if (r && r.error) { msg('本地已停止，但远端删除失败：' + r.error, 'warn'); }
        else { msg('已停止分享，公开 Gist 已删除', 'ok'); }
        refresh();
        shareStopBtn.disabled = false;
      });
    });

    refresh();
  }

  function start() { buildUI(); startScheduler(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else { start(); }
})(window);
