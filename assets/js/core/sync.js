/* ============================================================
   core/sync.js · 跨设备同步内核（本地优先 + GitHub Gist）
   职责：
     1. 采集各模块通过 registry 暴露的 sync.getState() 数据
     2. 推送到用户的私有 Gist / 从 Gist 拉取并分发给模块 sync.applyState()
     3. 冲突检测：以内容哈希判断「本地未上传」或「云端已变更」，明确提示后覆盖
     4. 悬浮面板 UI（配置 token / gist、上传、下载、状态）

   数据只写进用户自己的 Gist，token 只存在本机 localStorage，
   不进入仓库、不经过任何第三方。模块之间仍互不引用，仅通过注册表通信。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var store = Portal.store.namespace('_sync');

  var API = 'https://api.github.com';
  var FILE = 'open-shelf.json';
  var DESC = 'Open Shelf · 跨设备同步（自动生成，请勿手动修改）';

  var cfg = {
    token: store.get('token', '') || '',
    gistId: store.get('gistId', '') || '',
    syncedHash: store.get('syncedHash', '') || '',
    syncedAt: Number(store.get('syncedAt', 0)) || 0
  };

  function saveCfg() {
    store.set('token', cfg.token);
    store.set('gistId', cfg.gistId);
    store.set('syncedHash', cfg.syncedHash);
    store.set('syncedAt', cfg.syncedAt);
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

  /* ---------- 模块数据聚合 ---------- */
  function liveProviders() {
    var out = [];
    Portal.registry.list().forEach(function (def) {
      var s = def.sync;
      if (!s) return;
      // ready() 由模块在 mount() 后置为 true：首页只注册不挂载，不能参与同步，
      // 否则会用空数据覆盖云端。
      if (typeof s.ready === 'function' && !s.ready()) return;
      if (typeof s.getState === 'function' && typeof s.applyState === 'function') out.push(def);
    });
    return out;
  }

  function buildPayload() {
    var modules = {};
    liveProviders().forEach(function (def) {
      try {
        var s = def.sync.getState();
        if (s && typeof s === 'object') modules[def.id] = s;
      } catch (e) { console.error('[sync] getState ' + def.id, e); }
    });
    return { app: 'open-shelf', version: 1, updatedAt: Date.now(), modules: modules };
  }

  function applyPayload(payload, sourceHash) {
    var modules = payload && payload.modules && typeof payload.modules === 'object'
      ? payload.modules : {};
    var applied = [], failed = [];
    liveProviders().forEach(function (def) {
      if (!Object.prototype.hasOwnProperty.call(modules, def.id)) return;
      try { def.sync.applyState(modules[def.id]); applied.push(def.id); }
      catch (e) { console.error('[sync] applyState ' + def.id, e); failed.push(def.id); }
    });
    cfg.syncedHash = sourceHash;
    cfg.syncedAt = Number(payload && payload.updatedAt) || Date.now();
    saveCfg();
    return { applied: applied, failed: failed };
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

  /* ---------- 对外操作 ---------- */
  var sync = {
    config: cfg,
    saveConfig: saveCfg,
    hash: hash,

    /** 本地是否有未上传改动 */
    localDirty: function () {
      if (!cfg.syncedHash) return liveProviders().length > 0;
      return hashModules(buildPayload().modules) !== cfg.syncedHash;
    },

    /** 上传：云端有别人改动时先返回 needConfirm，force 后覆盖 */
    push: function (opts) {
      opts = opts || {};
      if (!cfg.token) return Promise.resolve({ error: '请先填写 GitHub Token' });
      if (!liveProviders().length) return Promise.resolve({ error: '请先进入某个模块，再执行同步' });

      var payload = buildPayload();
      var hashValue = hashModules(payload.modules);
      var content = JSON.stringify(payload, null, 2);

      return readRemote().then(function (remote) {
        var remoteHash = remote && remote.payload ? hashModules(remote.payload.modules) : '';
        if (cfg.gistId && remoteHash && remoteHash !== cfg.syncedHash && !opts.force) {
          return { needConfirm: true, kind: 'push' };
        }
        var method = cfg.gistId ? 'PATCH' : 'POST';
        var path = cfg.gistId ? '/gists/' + encodeURIComponent(cfg.gistId) : '/gists';
        var body = cfg.gistId
          ? { files: {} }
          : { description: DESC, public: false, files: {} };
        body.files[FILE] = { content: content };
        return request(method, path, body).then(function (g) {
          cfg.gistId = g.id;
          cfg.syncedHash = hashValue;
          cfg.syncedAt = Date.now();
          saveCfg();
          return { ok: true, id: g.id, htmlUrl: g.html_url, count: Object.keys(payload.modules).length };
        });
      }).catch(function (e) {
        return { error: e && e.message || String(e) };
      });
    },

    /** 下载：本地有未上传改动时先返回 needConfirm，force 后覆盖 */
    pull: function (opts) {
      opts = opts || {};
      if (!cfg.token) return Promise.resolve({ error: '请先填写 GitHub Token' });
      if (!cfg.gistId) return Promise.resolve({ error: '请先填写 Gist ID（或先上传一次）' });
      if (!liveProviders().length) return Promise.resolve({ error: '请先进入某个模块，再执行同步' });

      return readRemote().then(function (remote) {
        if (!remote || !remote.payload) return { error: '云端没有找到同步数据文件（' + FILE + '）' };
        var remoteHash = hashModules(remote.payload.modules);
        var localHash = hashModules(buildPayload().modules);
        if (localHash !== cfg.syncedHash && !opts.force) {
          return { needConfirm: true, kind: 'pull' };
        }
        var r = applyPayload(remote.payload, remoteHash);
        r.ok = true;
        r.remoteAt = remote.gist.updated_at;
        r.htmlUrl = remote.gist.html_url;
        return r;
      }).catch(function (e) {
        return { error: e && e.message || String(e) };
      });
    },

    /** 断开：清掉关联，保留 token，本地数据不动 */
    disconnect: function () {
      cfg.gistId = '';
      cfg.syncedHash = '';
      cfg.syncedAt = 0;
      saveCfg();
    }
  };
  Portal.sync = sync;

  /* ---------- 悬浮面板 UI ---------- */
  function fmtTime(ts) {
    if (!ts) return '从未';
    try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }
    catch (e) { return String(ts); }
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
          '<span class="sy-kicker mono">LOCAL-FIRST / GIST</span>' +
          '<h3 class="sy-title">跨设备同步</h3>' +
        '</div>' +
        '<button class="sy-close" id="sy-close" type="button" aria-label="关闭">×</button>' +
      '</div>' +

      '<div class="sy-state" id="sy-state"></div>' +

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

      '<p class="sy-msg mono" id="sy-msg" role="status"></p>' +
      '<p class="sy-note">数据只写进你自己的私有 Gist；Token 仅保存在当前浏览器，不会写进仓库或发给第三方。上传会覆盖云端，下载会覆盖本地，冲突时均会先确认。</p>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    var msgEl = panel.querySelector('#sy-msg');
    var stateEl = panel.querySelector('#sy-state');
    var tokenEl = panel.querySelector('#sy-token');
    var gistEl = panel.querySelector('#sy-gist');
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
      var dot = panel.querySelector('#sy-dot');
      dot.className = 'sy-fab-dot' + (!ready ? '' : (dirty ? ' is-dirty' : ' is-synced'));

      var providers = liveProviders();
      var modules = providers.length
        ? providers.map(function (d) {
            return '<span class="sy-tag mono">' + esc(d.index || d.id) + ' ' + esc(d.title || d.id) + '</span>';
          }).join('')
        : '<span class="sy-tag sy-tag--warn mono">请进入模块后同步</span>';

      stateEl.innerHTML = '' +
        '<div class="sy-state-row"><span>状态</span><b class="' +
          (!ready ? 'sy-s0' : (dirty ? 'sy-s2' : 'sy-s1')) + '">' +
          (!ready ? (cfg.token ? '待关联 Gist' : '未配置') : (dirty ? '本地有改动' : '已同步')) +
        '</b></div>' +
        '<div class="sy-state-row"><span>Gist</span><b class="mono">' +
          (cfg.gistId ? esc(cfg.gistId.slice(0, 10)) + '…' : '—') + '</b></div>' +
        '<div class="sy-state-row"><span>上次同步</span><b class="mono">' + fmtTime(cfg.syncedAt) + '</b></div>' +
        '<div class="sy-tags">' + modules + '</div>';
    }

    function commitConfig() {
      cfg.token = tokenEl.value.trim();
      cfg.gistId = gistEl.value.trim().replace(/^.*gists\//, '').replace(/[/?#].*$/, '');
      if (gistEl.value !== cfg.gistId) gistEl.value = cfg.gistId;
      saveCfg();
      refresh();
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
          var names = (r.applied || []).length;
          msg('已下载 · 更新 ' + names + ' 个模块' +
            ((r.failed || []).length ? '，' + r.failed.length + ' 个失败' : ''), 'ok');
        }
      }).catch(function (e) {
        msg(e && e.message || String(e), 'error');
      }).then(function () {
        btn.disabled = false;
        refresh();
      });
    }

    fab.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) { refresh(); tokenEl.focus(); }
    });
    panel.querySelector('#sy-close').addEventListener('click', function () { panel.hidden = true; });
    tokenEl.addEventListener('change', commitConfig);
    gistEl.addEventListener('change', commitConfig);
    panel.querySelector('#sy-push').addEventListener('click', function () { commitConfig(); run('push'); });
    panel.querySelector('#sy-pull').addEventListener('click', function () { commitConfig(); run('pull'); });
    panel.querySelector('#sy-disconnect').addEventListener('click', function () {
      if (!global.confirm('断开后将不再关联云端，本地数据保持不变。确定继续？')) return;
      sync.disconnect();
      gistEl.value = '';
      refresh();
      msg('已断开关联', 'warn');
    });

    refresh();
  }

  function start() { buildUI(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else { start(); }
})(window);
