/* ============================================================
   core/sync.js · 全自动跨设备同步内核（本地优先 + GitHub Gist）
   职责：
     1. 采集各模块通过 registry.sync 暴露的 getState()/cold() 数据
     2. 本地改动自动检测 → 防抖后自动上传；云端变化自动轮询 → 自动下载
     3. 冲突按「最后修改时间戳」裁决，不静默丢数据
     4. 上传前把「当前页面未挂载模块」的云端数据合并回去，避免覆盖
     5. 页头 ☁ SYNC 触发按钮 + 下拉面板：自动开关、配置、状态、手动上传/下载、公开分享

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
    shareAt: Number(store.get('shareAt', 0)) || 0,
    vaultCode: store.get('vaultCode', '') || '',      // 恢复短码（6 位）
    vaultGistId: store.get('vaultGistId', '') || '',  // 存密文的公开保险箱 Gist ID
    vaultOwner: store.get('vaultOwner', '') || ''     // 保险箱所属用户名，用于拼兜底链接
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
    store.set('vaultCode', cfg.vaultCode);
    store.set('vaultGistId', cfg.vaultGistId);
    store.set('vaultOwner', cfg.vaultOwner);
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
      // 时间戳必须同一时钟域：cfg.localChangedAt 是本机 Date.now()，
      // 因此云端时间优先取写入方写进 payload 的 updatedAt（同为客户端时钟）；
      // 不能拿 GitHub 服务器的 updated_at 跟本机时钟比——设备时钟稍慢，
      // 本地的「删除」就永远判输，云端旧示例会被反复下载回来。
      var remoteTs = Number(remote.payload.updatedAt) ||
        Date.parse(remote.gist.updated_at) || 0;

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

  /* ---------- 配置口令 / 恢复码（Web Crypto：PBKDF2 + AES-GCM） ----------
     目的：把难记的 token + gistId 用用户自设口令加密成一串「恢复码」。
     换设备时只输入同一个口令 + 粘贴恢复码即可还原配置，口令本身不落盘、不上传。
     恢复码格式：OS1.<base64url(salt)>.<base64url(iv)>.<base64url(ciphertext)> */
  var RECOVERY_PREFIX = 'OS1';
  var PBKDF2_ITER = 120000;

  function getCrypto() { return (global.crypto || (typeof crypto !== 'undefined' ? crypto : null)); }
  function subtle() { var c = getCrypto(); return c && c.subtle ? c.subtle : null; }
  function hasCodec() {
    return typeof global.TextEncoder === 'function' && typeof global.TextDecoder === 'function';
  }
  function b64urlEncode(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function deriveKey(passphrase, salt) {
    var s = subtle();
    return s.importKey('raw', new global.TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then(function (baseKey) {
        return s.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
          baseKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  /** 把当前同步配置（含分享 Gist）用口令加密成恢复码。口令不落盘。 */
  function makeRecovery(passphrase) {
    passphrase = String(passphrase || '');
    if (passphrase.length < 6) return Promise.resolve({ error: '口令至少 6 位，越长越安全' });
    var s = subtle(), c = getCrypto();
    if (!s || !c || !c.getRandomValues || !hasCodec()) {
      return Promise.resolve({ error: '当前环境不支持加密，请在 HTTPS 或 localhost 下使用' });
    }
    if (!cfg.token) return Promise.resolve({ error: '请先填入 GitHub Token，再生成恢复码' });
    var payload = {
      v: 1,
      token: cfg.token,
      gistId: cfg.gistId || '',
      shareGistId: cfg.shareGistId || '',
      shareOwner: cfg.shareOwner || ''
    };
    var salt = new Uint8Array(16), iv = new Uint8Array(12);
    c.getRandomValues(salt);
    c.getRandomValues(iv);
    return deriveKey(passphrase, salt).then(function (key) {
      return s.encrypt({ name: 'AES-GCM', iv: iv }, key, new global.TextEncoder().encode(JSON.stringify(payload)));
    }).then(function (buf) {
      return {
        ok: true,
        code: RECOVERY_PREFIX + '.' + b64urlEncode(salt) + '.' + b64urlEncode(iv) + '.' +
          b64urlEncode(new Uint8Array(buf))
      };
    }).catch(function (e) {
      return { error: '生成失败：' + (e && e.message || String(e)) };
    });
  }

  /** 用口令解密恢复码，回填配置；成功后本地哈希清零，下次对账以云端为准。 */
  function restoreRecovery(passphrase, code) {
    passphrase = String(passphrase || '');
    if (passphrase.length < 6) return Promise.resolve({ error: '口令至少 6 位' });
    var s = subtle();
    if (!s || !hasCodec()) {
      return Promise.resolve({ error: '当前环境不支持解密，请在 HTTPS 或 localhost 下使用' });
    }
    var parts = String(code || '').trim().split('.');
    if (parts.length !== 4 || parts[0] !== RECOVERY_PREFIX) {
      return Promise.resolve({ error: '恢复码格式不正确（应包含 OS1. 前缀）' });
    }
    var salt, iv, data;
    try {
      salt = b64urlDecode(parts[1]);
      iv = b64urlDecode(parts[2]);
      data = b64urlDecode(parts[3]);
    } catch (e) { return Promise.resolve({ error: '恢复码内容损坏' }); }
    return deriveKey(passphrase, salt).then(function (key) {
      return s.decrypt({ name: 'AES-GCM', iv: iv }, key, data);
    }).then(function (buf) {
      var payload;
      try { payload = JSON.parse(new global.TextDecoder().decode(buf)); }
      catch (e) { throw new Error('恢复码内容无法解析'); }
      if (!payload || !payload.token) throw new Error('恢复码内没有有效的 Token');
      cfg.token = String(payload.token);
      cfg.gistId = String(payload.gistId || '');
      cfg.shareGistId = String(payload.shareGistId || '');
      cfg.shareOwner = String(payload.shareOwner || '');
      // 新设备以云端为准：清空同步哈希，让下次对账走下载方向
      cfg.syncedHash = '';
      cfg.localHash = '';
      cfg.localChangedAt = 0;
      cfg.auto = true;
      saveCfg();
      return { ok: true, gistId: cfg.gistId, shareGistId: cfg.shareGistId };
    }).catch(function (e) {
      var m = e && e.message || String(e);
      if (/OperationError|InvalidAccess|The operation failed|auth/i.test(m)) {
        return { error: '口令错误，或恢复码已被篡改' };
      }
      return { error: '恢复失败：' + m };
    });
  }

  /* ---------- 恢复短码 / 保险箱（6 位短码 + 口令，密文存公开 Gist） ----------
     思路：把 token + gistId 等配置用口令加密成密文，存进用户自己的【公开】Gist
     「保险箱」。对外只暴露 6 位短码（写在 Gist description 里），换设备时：
       短码 → 搜索定位保险箱 → 拉密文 → 口令解密 → 回填配置。
     安全模型：短码只是「地址」（泄露无妨），口令才是「钥匙」；保险箱内只有密文，
     GitHub / 他人均看不到明文 token。另支持直接贴保险箱链接作为搜索兜底。
     兼容：仍可输入旧版 OS1. 恢复码，自动转交旧逻辑处理。 */
  var VAULT_FILE = 'open-shelf-vault.txt';
  var VAULT_TAG = 'OSVAULT';
  var VAULT_PREFIX = 'OSV1';
  var CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去掉 0/O/1/I/l 等易混字符

  function randomCode(len) {
    var c = getCrypto();
    if (!c || !c.getRandomValues) return '';
    var bytes = new Uint8Array(len);
    c.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    return out;
  }

  function parseGistId(input) {
    var s = String(input || '').trim();
    // gist.github.com/<owner>/<id>、api.github.com/gists/<id> 或纯 32 位 id
    // 统一取文本里的第一段 32 位十六进制串；短码只有 6 位，不会误匹配。
    var m = s.match(/([0-9a-fA-F]{32})/);
    return m ? m[1] : '';
  }
  function cleanCode(input) {
    return String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  }

  /** 生成 / 更新短码保险箱。返回短码与保险箱链接。 */
  function makeVault(passphrase) {
    passphrase = String(passphrase || '');
    if (passphrase.length < 6) return Promise.resolve({ error: '口令至少 6 位，越长越安全' });
    var s = subtle(), c = getCrypto();
    if (!s || !c || !c.getRandomValues || !hasCodec()) {
      return Promise.resolve({ error: '当前环境不支持加密，请在 HTTPS 或 localhost 下使用' });
    }
    if (!cfg.token) return Promise.resolve({ error: '请先填入 GitHub Token，再生成恢复短码' });
    var payload = {
      v: 2,
      token: cfg.token,
      gistId: cfg.gistId || '',
      shareGistId: cfg.shareGistId || '',
      shareOwner: cfg.shareOwner || ''
    };
    var salt = new Uint8Array(16), iv = new Uint8Array(12);
    c.getRandomValues(salt);
    c.getRandomValues(iv);
    var code = cfg.vaultCode || randomCode(6);
    if (!code) return Promise.resolve({ error: '无法生成短码：随机数不可用' });
    var desc = VAULT_TAG + '-' + code + ' · Open Shelf 恢复保险箱（自动生成，请勿删除）';
    return deriveKey(passphrase, salt).then(function (key) {
      return s.encrypt({ name: 'AES-GCM', iv: iv }, key, new global.TextEncoder().encode(JSON.stringify(payload)));
    }).then(function (buf) {
      var content = VAULT_PREFIX + '.' + b64urlEncode(salt) + '.' + b64urlEncode(iv) + '.' +
        b64urlEncode(new Uint8Array(buf));
      var method = cfg.vaultGistId ? 'PATCH' : 'POST';
      var path = cfg.vaultGistId ? '/gists/' + encodeURIComponent(cfg.vaultGistId) : '/gists';
      var body = cfg.vaultGistId
        ? { description: desc, files: {} }
        : { description: desc, public: true, files: {} };
      body.files[VAULT_FILE] = { content: content };
      return request(method, path, body).then(function (g) {
        cfg.vaultCode = code;
        cfg.vaultGistId = g.id;
        cfg.vaultOwner = (g.owner && g.owner.login) || cfg.vaultOwner || '';
        saveCfg();
        return {
          ok: true, code: code, gistUrl: g.html_url, owner: cfg.vaultOwner,
          renewed: method === 'PATCH'
        };
      });
    }).catch(function (e) {
      return { error: '生成失败：' + (e && e.message || String(e)) };
    });
  }

  function findVaultByCode(code, owner) {
    // GitHub 没有「按描述搜索 Gist」的 API（/search/gists 不存在），
    // 但 GET /users/{owner}/gists 可免 token 列出某人的公开 Gist。
    // 因此短码定位需要「用户名 + 短码」两个短标识，都记在密码管理器即可。
    owner = String(owner || '').trim().replace(/^@/, '');
    if (!owner) return Promise.resolve(null);
    var markers = [VAULT_TAG + '-' + code];
    return request('GET', '/users/' + encodeURIComponent(owner) + '/gists?per_page=100')
      .then(function (items) {
        var list = Array.isArray(items) ? items : [];
        var hits = list.filter(function (g) {
          var d = String(g.description || '');
          return markers.some(function (m) { return d.indexOf(m) >= 0; }) &&
            g.files && g.files[VAULT_FILE];
        });
        return hits.length ? hits[0] : null;
      }).catch(function () { return null; });
  }

  function parseVaultContent(gist) {
    var file = gist && gist.files && gist.files[VAULT_FILE];
    var raw = file && file.content;
    if (!raw) return null;
    var parts = String(raw).trim().split('.');
    if (parts.length !== 4 || parts[0] !== VAULT_PREFIX) return null;
    try {
      return { salt: b64urlDecode(parts[1]), iv: b64urlDecode(parts[2]), data: b64urlDecode(parts[3]) };
    } catch (e) { return null; }
  }

  /** 恢复：input 可为 6 位短码、保险箱链接/Gist ID，或旧版 OS1. 恢复码。
      owner 为生成保险箱的 GitHub 用户名（短码定位需要用户名 + 短码两个短标识）。 */
  function restoreVault(passphrase, input, owner) {
    passphrase = String(passphrase || '');
    input = String(input || '').trim();
    if (passphrase.length < 6) return Promise.resolve({ error: '口令至少 6 位' });
    if (!input) return Promise.resolve({ error: '请输入恢复短码或保险箱链接' });
    if (input.indexOf('OS1.') === 0) return restoreRecovery(passphrase, input); // 兼容旧恢复码

    var s = subtle();
    if (!s || !hasCodec()) {
      return Promise.resolve({ error: '当前环境不支持解密，请在 HTTPS 或 localhost 下使用' });
    }

    var gistId = parseGistId(input);
    var code = cleanCode(input);
    var resolvedOwner = '';
    var locate;
    if (gistId) {
      // 保险箱链接自带 Gist ID，无需用户名即可直接读取
      locate = Promise.resolve({ id: gistId });
    } else if (code.length === 6) {
      var own = String(owner || cfg.vaultOwner || '').trim().replace(/^@/, '');
      if (!own) return Promise.resolve({ error: '用短码恢复还需填写生成保险箱时的 GitHub 用户名' });
      locate = findVaultByCode(code, own).then(function (g) {
        if (!g) return null;
        resolvedOwner = (g.owner && g.owner.login) || own;
        return { id: g.id, owner: resolvedOwner };
      });
    } else {
      return Promise.resolve({ error: '请输入 6 位恢复短码，或粘贴保险箱链接' });
    }

    return locate.then(function (hit) {
      if (!hit) return Promise.reject(new Error('没找到保险箱：请确认「用户名 + 短码」是否正确，且保险箱 Gist 仍为公开状态；也可直接粘贴保险箱链接恢复'));
      resolvedOwner = hit.owner || resolvedOwner;
      return request('GET', '/gists/' + encodeURIComponent(hit.id)).then(function (g) {
        return g;
      });
    }).then(function (g) {
      var box = parseVaultContent(g);
      if (!box) throw new Error('保险箱内容为空或格式不正确');
      return deriveKey(passphrase, box.salt).then(function (key) {
        return s.decrypt({ name: 'AES-GCM', iv: box.iv }, key, box.data);
      });
    }).then(function (buf) {
      var payload;
      try { payload = JSON.parse(new global.TextDecoder().decode(buf)); }
      catch (e) { throw new Error('恢复内容无法解析'); }
      if (!payload || !payload.token) throw new Error('保险箱内没有有效的 Token');
      cfg.token = String(payload.token);
      cfg.gistId = String(payload.gistId || '');
      cfg.shareGistId = String(payload.shareGistId || '');
      cfg.shareOwner = String(payload.shareOwner || '');
      cfg.vaultCode = cfg.vaultCode || (code.length === 6 ? code : '');
      if (resolvedOwner) cfg.vaultOwner = resolvedOwner;
      cfg.syncedHash = '';
      cfg.localHash = '';
      cfg.localChangedAt = 0;
      cfg.auto = true;
      saveCfg();
      return { ok: true, gistId: cfg.gistId, shareGistId: cfg.shareGistId };
    }).catch(function (e) {
      var m = e && e.message || String(e);
      if (/OperationError|InvalidAccess|The operation failed/i.test(m)) {
        return { error: '口令错误，或保险箱已被篡改' };
      }
      return { error: '恢复失败：' + m };
    });
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
    shareUrl: buildShareUrl,
    makeRecovery: makeRecovery,
    restoreRecovery: restoreRecovery,
    makeVault: makeVault,
    restoreVault: restoreVault
  };

  function collectLocalModulesCount() { return Object.keys(collectLocal()).length; }

  Portal.sync = sync;

  /* ---------- 页头触发按钮 + 下拉面板 UI ---------- */
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
    if (document.getElementById('sy-wrap')) return;

    // 把同步入口做进页头：一个包裹层放触发按钮 + 面板，锚定在状态标签旁
    var wrap = document.createElement('div');
    wrap.id = 'sy-wrap';
    wrap.className = 'sy-wrap';

    var fab = document.createElement('button');
    fab.id = 'sy-trigger';
    fab.className = 'sy-trigger';
    fab.type = 'button';
    fab.setAttribute('aria-label', '跨设备同步设置');
    fab.title = '跨设备同步设置';
    fab.setAttribute('aria-expanded', 'false');
    // 纯图标按钮；同步状态仍由右上角小圆点表达，文字说明放在 aria-label / title
    fab.innerHTML = '<i class="sy-trigger-ico" aria-hidden="true"></i>' +
      '<span class="sy-trigger-dot" id="sy-dot"></span>';

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

      '<div class="sy-pass">' +
        '<div class="sy-pass-head">' +
          '<span class="sy-kicker mono">VAULT CODE / 换设备免记 Token</span>' +
        '</div>' +
        '<p class="sy-pass-desc">设一个口令，把 Token 加密存进你的<strong>云端保险箱</strong>，只记「用户名 + 6 位短码 + 口令」。换设备时填这三项即可自动配好，无需再找长 Token。用户名与短码是地址（泄露无妨），口令是钥匙（忘了无法找回）。</p>' +
        '<label class="sy-label">配置口令' +
          '<span class="sy-label-hint">至少 6 位，自己记牢；忘了无法找回</span>' +
          '<input class="sy-input" id="sy-pass" type="password" autocomplete="new-password" ' +
            'spellcheck="false" placeholder="自己设一个好记的口令">' +
        '</label>' +
        '<div class="sy-vault-seal" id="sy-vault-seal" hidden>' +
          '<span class="sy-vault-seal-label mono">你的恢复凭证</span>' +
          '<span class="sy-vault-seal-code mono" id="sy-vault-seal-code">——</span>' +
          '<span class="sy-vault-seal-tip" id="sy-vault-seal-tip">记牢「用户名 + 短码 + 口令」</span>' +
        '</div>' +
        '<label class="sy-label">GitHub 用户名' +
          '<span class="sy-label-hint">保险箱所属账号；生成后自动填好</span>' +
          '<input class="sy-input" id="sy-owner" type="text" autocomplete="off" ' +
            'spellcheck="false" placeholder="例如 octocat" value="' + esc(cfg.vaultOwner) + '">' +
        '</label>' +
        '<label class="sy-label sy-pass-code-label">恢复短码 / 保险箱链接' +
          '<span class="sy-label-hint">换设备时填 6 位短码，或粘贴保险箱链接</span>' +
          '<input class="sy-input sy-code-input" id="sy-code" type="text" spellcheck="false" ' +
            'autocomplete="off" placeholder="例如 K7M2QX">' +
        '</label>' +
        '<div class="sy-actions sy-pass-actions">' +
          '<button class="btn sy-btn" id="sy-pass-make" type="button">生成短码</button>' +
          '<button class="btn btn--primary sy-btn" id="sy-pass-restore" type="button">用短码恢复</button>' +
        '</div>' +
        '<div class="sy-actions sy-actions--sub">' +
          '<button class="sy-link" id="sy-code-copy" type="button">复制短码</button>' +
          '<button class="sy-link" id="sy-vault-link-copy" type="button">复制保险箱链接（备用）</button>' +
        '</div>' +
      '</div>' +

      '<div class="sy-actions">' +
        '<button class="btn btn--primary sy-btn" id="sy-push" type="button">↑ 上传</button>' +
        '<button class="btn sy-btn" id="sy-pull" type="button">↓ 下载</button>' +
      '</div>' +
      '<div class="sy-actions sy-actions--sub">' +
        '<button class="sy-link" id="sy-disconnect" type="button">断开关联</button>' +
        '<a class="sy-link" href="https://github.com/settings/tokens/new?scopes=gist&description=Open%20Shelf%20Sync" ' +
          'target="_blank" rel="noopener noreferrer">获取 Token <i class="i-ico i-ext" aria-hidden="true"></i></a>' +
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
      '<p class="sy-note">换设备不用重新申请 Token：设一个口令生成 <strong>6 位短码</strong>，只记「GitHub 用户名 + 短码 + 口令」。用户名与短码用于在云端定位你的保险箱（一个公开 Gist，但里面只有密文，看不到明文 Token），口令经 PBKDF2 派生密钥、用 AES-GCM 加密，口令本身不保存也不上传。用户名/短码泄露无妨（别人没口令解不开），但口令忘了就无法找回。若登录的 GitHub 账号无法列出保险箱，可改贴「保险箱链接」直接恢复，建议一并保存。私有同步 Gist 仅你自己可读写。自动同步每 15 秒检查云端一次，本地改动约 2 秒后自动上传。</p>';

    wrap.appendChild(fab);
    wrap.appendChild(panel);

    // 优先插入页头 .header-meta（状态标签旁）；找不到时降级挂到 body
    var headerMeta = document.querySelector('.header-meta');
    if (headerMeta) {
      var statusEl = headerMeta.querySelector('.status');
      if (statusEl && statusEl.parentNode) statusEl.parentNode.insertBefore(wrap, statusEl.nextSibling);
      else headerMeta.appendChild(wrap);
      // SYNC 紧跟状态标签；主题按钮无论脚本顺序如何都保持在最后
      var themeEl = headerMeta.querySelector('#theme-toggle');
      if (themeEl && themeEl.nextSibling) headerMeta.appendChild(themeEl);
    } else {
      wrap.classList.add('sy-wrap--floating');
      document.body.appendChild(wrap);
    }

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
      // 状态点在触发按钮内（不是 panel 内）——必须用全局查找并做空值保护，
      // 否则 panel.querySelector 返回 null，dot.className 抛错会中断整个 refresh。
      var dot = document.getElementById('sy-dot');
      if (dot) dot.className = 'sy-trigger-dot' +
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

    function setOpen(open) {
      panel.hidden = !open;
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) refresh();
    }

    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(panel.hidden);
    });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { if (!panel.hidden) setOpen(false); });
    panel.querySelector('#sy-close').addEventListener('click', function () { setOpen(false); });
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

    // ---- 恢复短码 / 保险箱 ----
    var passEl = panel.querySelector('#sy-pass');
    var codeEl = panel.querySelector('#sy-code');
    var ownerEl = panel.querySelector('#sy-owner');
    var makeBtn = panel.querySelector('#sy-pass-make');
    var restoreBtn = panel.querySelector('#sy-pass-restore');
    var seal = panel.querySelector('#sy-vault-seal');
    var sealCode = panel.querySelector('#sy-vault-seal-code');
    var sealTip = panel.querySelector('#sy-vault-seal-tip');

    function vaultLink() {
      if (!cfg.vaultGistId) return '';
      return 'https://gist.github.com/' +
        (cfg.vaultOwner ? cfg.vaultOwner + '/' : '') + cfg.vaultGistId;
    }
    function showSeal(code, owner) {
      var who = String(owner || cfg.vaultOwner || ownerEl.value || '').trim();
      if (!code && !who) { seal.hidden = true; return; }
      seal.hidden = false;
      sealCode.textContent = (who ? who + ' / ' : '') +
        (code ? code.replace(/(.{3})/g, '$1 ').trim() : '——');
      sealTip.textContent = '记牢「' + (who || '用户名') + ' + ' +
        (code || '短码') + ' + 口令」，换设备时填下方即可';
    }
    showSeal(cfg.vaultCode, cfg.vaultOwner);

    ownerEl.addEventListener('change', function () {
      cfg.vaultOwner = ownerEl.value.trim().replace(/^@/, '');
      saveCfg();
      showSeal(cfg.vaultCode, cfg.vaultOwner);
    });

    makeBtn.addEventListener('click', function () {
      commitConfig(); // 确保 token/gist 已保存
      if (!cfg.token) { msg('请先填入 GitHub Token，再生成恢复短码', 'error'); tokenEl.focus(); return; }
      if (passEl.value.length < 6) { msg('请先设一个至少 6 位的配置口令', 'error'); passEl.focus(); return; }
      makeBtn.disabled = true;
      msg('正在创建云端保险箱…');
      sync.makeVault(passEl.value).then(function (r) {
        if (r && r.error) { msg(r.error, 'error'); return; }
        codeEl.value = r.code;
        if (r.owner) ownerEl.value = r.owner;
        showSeal(r.code, r.owner);
        passEl.value = '';
        msg('短码已生成 · ' + r.code + ' · 记牢「用户名 + 短码 + 口令」即可换设备', 'ok');
      }).catch(function (e) {
        msg(e && e.message || String(e), 'error');
      }).then(function () { makeBtn.disabled = false; });
    });

    restoreBtn.addEventListener('click', function () {
      var code = codeEl.value.trim();
      if (!code) { msg('请填写恢复短码或保险箱链接', 'error'); codeEl.focus(); return; }
      if (!passEl.value) { msg('请输入生成短码时用的口令', 'error'); passEl.focus(); return; }
      restoreBtn.disabled = true;
      msg('正在打开保险箱恢复配置…');
      sync.restoreVault(passEl.value, code, ownerEl.value).then(function (r) {
        if (r && r.error) { msg(r.error, 'error'); return; }
        // 回填输入框与短码封印，让状态与底层配置一致
        tokenEl.value = cfg.token;
        gistEl.value = cfg.gistId;
        passEl.value = '';
        codeEl.value = cfg.vaultCode || '';
        if (cfg.vaultOwner) ownerEl.value = cfg.vaultOwner;
        showSeal(cfg.vaultCode, cfg.vaultOwner);
        refresh();
        var bits = ['配置已恢复'];
        if (r.gistId) bits.push('Gist 已关联');
        if (r.shareGistId) bits.push('分享链接已恢复');
        msg(bits.join(' · ') + ' · 正在从云端拉取最新数据…', 'ok');
        // 恢复后立即对账：新设备以云端为准下载
        return sync.reconcile('restore');
      }).then(function (r2) {
        if (r2 && r2.error) msg('配置已恢复，但拉取失败：' + r2.error, 'warn');
        else if (r2 && (r2.applied || r2.note === 'in-sync' || r2.count)) {
          msg('配置已恢复 · 云端数据已同步', 'ok');
          refresh();
        }
      }).catch(function (e) {
        msg(e && e.message || String(e), 'error');
      }).then(function () { restoreBtn.disabled = false; });
    });

    panel.querySelector('#sy-code-copy').addEventListener('click', function () {
      var text = (cfg.vaultCode || codeEl.value || '').replace(/\s/g, '');
      if (!text) { msg('还没有可复制的短码', 'warn'); return; }
      function done() { msg('短码已复制 · 配合口令使用', 'ok'); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { done(); });
      } else { done(); }
    });

    panel.querySelector('#sy-vault-link-copy').addEventListener('click', function () {
      var text = vaultLink();
      if (!text) { msg('本地还没有保险箱链接；可先用短码恢复一次', 'warn'); return; }
      function done() { msg('保险箱链接已复制 · 作备用保存', 'ok'); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { done(); });
      } else { done(); }
    });

    refresh();
  }

  function start() { buildUI(); startScheduler(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else { start(); }
})(window);
