/* ============================================================
   core/sync.js · 全自动跨设备同步内核（本地优先 + GitHub Gist）
   职责：
     1. 采集各模块通过 registry.sync 暴露的 getState()/cold() 数据
     2. 本地改动自动检测 → 防抖后自动上传；云端变化自动轮询 → 自动下载
     3. 冲突按三方合并（共同祖先快照）逐条裁决，不依赖设备时钟、不静默丢数据
     4. 上传前把「当前页面未挂载模块」的云端数据合并回去，避免覆盖
     5. 页头 ☁ SYNC 触发按钮 + 下拉面板（两步）：连接云端、换设备；同步状态在标题行
     6. 一键重置：清空本机模块数据 + 云端文件，保留 Token 与恢复凭证，用于超限断流后重来

   数据只写进用户自己的私有 Gist，token 只存在本机 localStorage，
   不进入仓库、不经过任何第三方。模块之间仍互不引用，仅通过注册表通信。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var store = Portal.store.namespace('_sync');

  var API = 'https://api.github.com';
  var FILE = 'open-shelf.json';
  // 图片独立文件前缀：主 JSON 只留媒体映射，图片 data URI 拆到同 Gist 的独立文件，
  // 突破单文件 1MB 限制。文件命名 osimg-<媒体ID>.<ext>，读取时再注入回 media[id].d。
  var IMG_PREFIX = 'osimg-';
  var DESC = 'SHELF / ONLINE · 跨设备同步（自动生成，请勿手动修改）';

  // 调度参数
  var LOCAL_TICK = 1500;    // 本地哈希检测间隔
  var CLOUD_TICK = 15000;   // 云端轮询间隔
  var DEBOUNCE = 2500;      // 本地改动后等待上传的防抖
  var SKEW = 1500;          // 时间戳裁决容差，避免双方同时认为「我更新」
  var REQ_TIMEOUT = 30000;  // 单次请求超时：半开连接/断流时 abort，避免 syncing 永久卡死

  /** 带超时的 fetch：AbortController 到点中断，超时用一个带 code 的 Error 抛出，
   *  让上层 catch 能区分「超时」与「HTTP 错误」，并能正常收尾复位 syncing。 */
  function fetchTimeout(url, init) {
    if (typeof AbortController === 'undefined') return fetch(url, init); // 老浏览器降级
    var ctrl = new AbortController();
    var opts = {};
    if (init) Object.keys(init).forEach(function (k) { opts[k] = init[k]; });
    opts.signal = ctrl.signal;
    var timer = global.setTimeout(function () { ctrl.abort(); }, REQ_TIMEOUT);
    return fetch(url, opts).then(function (res) {
      global.clearTimeout(timer);
      return res;
    }, function (e) {
      global.clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        var t = new Error('请求超时（' + Math.round(REQ_TIMEOUT / 1000) + ' 秒），网络可能已断流，请重试');
        t.code = 'ETIMEDOUT';
        throw t;
      }
      throw e;
    });
  }

  var cfg = {
    token: store.get('token', '') || '',
    gistId: store.get('gistId', '') || '',
    syncedHash: store.get('syncedHash', '') || '',   // 上次同步成功的完整 payload 哈希
    localHash: store.get('localHash', '') || '',     // 上次同步成功时本地模块数据哈希
    syncedAt: Number(store.get('syncedAt', 0)) || 0,
    localChangedAt: Number(store.get('localChangedAt', 0)) || 0,
    auto: store.get('auto', true) !== false,
    vaultCode: store.get('vaultCode', '') || '',      // 恢复短码（6 位）
    vaultGistId: store.get('vaultGistId', '') || '',  // 存密文的公开保险箱 Gist ID
    vaultOwner: store.get('vaultOwner', '') || '',    // 保险箱所属用户名，用于拼兜底链接
    // 断开关联时的本地快照：用来识别「断开后又新增的内容」，恢复时不再静默覆盖
    detachedHash: store.get('detachedHash', '') || '',
    detachedHashes: store.get('detachedHashes', null) || null,
    detachedAt: Number(store.get('detachedAt', 0)) || 0,
    // 三方合并的共同祖先：上次同步成功后云端各模块的快照。
    // 有了它，双方同时改动时能按条目做三方合并，而不是整模块覆盖、静默丢数据。
    baseSnapshot: store.get('baseSnapshot', null) || null,
    // 上次写入云端的图片文件清单：文件名 → data URI 哈希。
    // 用于差量 PATCH（内容没变就不重复上传）与删除不再被引用的图片文件。
    imageFiles: store.get('imageFiles', null) || {}
  };

  // 上次广播出去的 Token。模块1（repo-showcase）会在云同步 Token 变化时自动复用，
  // 避免用户在两个地方重复粘贴同一个 Token；仅在真正变化时广播，防止无意义重渲染。
  var lastNotifiedToken = cfg.token;

  function saveCfg() {
    store.set('token', cfg.token);
    store.set('gistId', cfg.gistId);
    store.set('syncedHash', cfg.syncedHash);
    store.set('localHash', cfg.localHash);
    store.set('syncedAt', cfg.syncedAt);
    store.set('localChangedAt', cfg.localChangedAt);
    store.set('auto', cfg.auto);
    store.set('vaultCode', cfg.vaultCode);
    store.set('vaultGistId', cfg.vaultGistId);
    store.set('vaultOwner', cfg.vaultOwner);
    store.set('detachedHash', cfg.detachedHash);
    store.set('detachedHashes', cfg.detachedHashes);
    store.set('detachedAt', cfg.detachedAt);
    store.set('baseSnapshot', cfg.baseSnapshot);
    store.set('imageFiles', cfg.imageFiles);
    if (cfg.token !== lastNotifiedToken) {
      lastNotifiedToken = cfg.token;
      if (Portal.bus && Portal.bus.emit) Portal.bus.emit('sync:token-change', { token: cfg.token });
    }
  }

  /** 供其它模块读取云同步 Token（只暴露只读值，不暴露其它同步凭证） */
  Portal.getSyncToken = function () { return cfg.token || ''; };

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
  /** 深拷贝模块快照：避免 baseSnapshot 持有 collectLocal() 的引用后被后续编辑污染 */
  function snapshotOf(modules) {
    try { return JSON.parse(JSON.stringify(modules || {})); }
    catch (e) { return modules || {}; }
  }
  /** 逐模块哈希：断开时记下快照，恢复时才知道是哪些模块后来被改过 */
  function moduleHashes(modules) {
    var out = {};
    Object.keys(modules || {}).forEach(function (k) { out[k] = hashModules(modules[k]); });
    return out;
  }
  function clearDetached() {
    cfg.detachedHash = '';
    cfg.detachedHashes = null;
    cfg.detachedAt = 0;
  }
  function changedModuleIds(localModules) {
    var before = cfg.detachedHashes || {};
    var now = moduleHashes(localModules);
    var ids = [];
    Object.keys(now).forEach(function (k) { if (before[k] !== now[k]) ids.push(k); });
    Object.keys(before).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(now, k)) ids.push(k);
    });
    return ids;
  }

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

  /* ---------- 三方合并（three-way merge） ----------
     旧逻辑：双方都改 → 比时间戳，输的一整块被覆盖 → 另一台设备新增的条目静默丢失，
     且设备时钟不一致时裁决错乱。新逻辑：以「上次同步成功的云端快照」为共同祖先 base，
     对模块数据做结构化三方合并：
       · 对象：按 key 递归合并
       · 带 id/name 的对象数组：按 id/name 对齐后逐条合并（笔记、仓库分组）
       · 普通数组：按「base 有、某侧删」判断删除，否则取并集（分类、repos、置顶）
       · 标量：一侧未动取另一侧，两侧都动取本地（情绪数据以本机为准，绝不静默吞）
     这样三台设备交替增删都能收敛，不依赖时钟。 */
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function isArr(v) { return Array.isArray(v); }
  function sameVal(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }
  function unionKeys(groups) {
    var out = [], seen = Object.create(null);
    groups.forEach(function (arr) {
      (arr || []).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(seen, k)) { seen[k] = 1; out.push(k); }
      });
    });
    return out;
  }
  function arrayKey(sample) {
    if (sample && typeof sample === 'object') {
      if (sample.id !== undefined) return 'id';
      if (sample.name !== undefined) return 'name';
    }
    return null;
  }
  function mergeVal(base, local, remote) {
    // 一侧缺失（视为删除）：另一侧没动过就删；另一侧改过就保留另一侧，避免吞掉改动
    if (local === undefined) {
      if (remote === undefined) return undefined;
      if (sameVal(remote, base)) return undefined;
      return remote;
    }
    if (remote === undefined) {
      if (base !== undefined && sameVal(local, base)) return undefined;
      return local;
    }
    if (isArr(local) || isArr(remote) || isArr(base)) return mergeArr(base, local, remote);
    if (isObj(local) || isObj(remote) || isObj(base)) return mergeObj(base, local, remote);
    // 标量
    if (sameVal(local, base)) return remote;
    if (sameVal(remote, base)) return local;
    return local;
  }
  function mergeObj(base, local, remote) {
    base = isObj(base) ? base : {};
    local = isObj(local) ? local : {};
    remote = isObj(remote) ? remote : {};
    var out = {};
    unionKeys([Object.keys(base), Object.keys(local), Object.keys(remote)]).forEach(function (k) {
      var v = mergeVal(base[k], local[k], remote[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  function mergeArr(base, local, remote) {
    base = isArr(base) ? base : [];
    local = isArr(local) ? local : [];
    remote = isArr(remote) ? remote : [];
    var sample = local[0] || remote[0] || base[0];
    var key = arrayKey(sample);
    if (key) {
      // 对象数组按 id/name 对齐
      var bm = Object.create(null), lm = Object.create(null), rm = Object.create(null);
      base.forEach(function (o) { if (o && o[key] != null) bm[o[key]] = o; });
      local.forEach(function (o) { if (o && o[key] != null) lm[o[key]] = o; });
      remote.forEach(function (o) { if (o && o[key] != null) rm[o[key]] = o; });
      var out = [];
      unionKeys([Object.keys(bm), Object.keys(lm), Object.keys(rm)]).forEach(function (k) {
        var v = mergeVal(bm[k], lm[k], rm[k]);
        if (v !== undefined) out.push(v);
      });
      return out;
    }
    // 普通数组（字符串，如分类目录 / repos / 置顶列表）：
    // 以 base 为共同祖先，任一侧「相对 base 的删除」都要生效，否则 A 删除的目录
    // 会被 B 的旧本地列表重新带回云端，跨设备看起来就像没删掉。
    // 顺序仍以本地为主，另一侧新增的项追加在后。
    var bset = Object.create(null), lset = Object.create(null), rset = Object.create(null);
    base.forEach(function (x) { bset[x] = 1; });
    local.forEach(function (x) { lset[x] = 1; });
    remote.forEach(function (x) { rset[x] = 1; });
    var out2 = [];
    local.forEach(function (x) {
      // base 里有、云端已删 → 本地未独立改动，接受删除
      if (bset[x] && !rset[x]) return;
      if (out2.indexOf(x) < 0) out2.push(x);
    });
    remote.forEach(function (x) {
      // base 里有、本地已删 → 云端旧值不能再把目录带回来
      if (bset[x] && !lset[x]) return;
      if (out2.indexOf(x) < 0) out2.push(x);
    });
    return out2;
  }

  /** 用 base 快照把本地与云端做三方合并，得到最终要写入/落地的模块集合 */
  function threeWayMergeModules(baseModules, localModules, remoteModules) {
    var all = unionKeys([
      Object.keys(baseModules || {}),
      Object.keys(localModules || {}),
      Object.keys(remoteModules || {})
    ]);
    var out = {};
    all.forEach(function (id) {
      var merged = mergeObj(
        (baseModules || {})[id],
        (localModules || {})[id],
        (remoteModules || {})[id]
      );
      // 只有当某模块至少在一侧存在时才产出，避免凭空生成空模块
      if ((localModules && localModules[id]) || (remoteModules && remoteModules[id])) out[id] = merged;
    });
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
    if (err && err.code === 'ETIMEDOUT') return msg; // 超时提示已在 fetchTimeout 里写清楚
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
    return fetchTimeout(API + path, init).then(function (res) {
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

  /* ---------- 媒体拆分：本地全量 data URI ⇄ 云端主 JSON + 独立图片文件 ----------
     设计原则：本地模块数据（localStorage / collectLocal / applyRemote / 三方合并 /
     baseSnapshot）始终保持完整 data URI，不引入新格式；只在「写云端」与「读云端」
     两个边界做转换。这样 notes 模块、合并算法、导出导入都无需改动。
       · 写云端：detachMedia 把 media[id].d 抽成独立文件 osimg-<id>.<ext>，
                 主 JSON 里该条目只保留 {t, n, f}（f=文件名）。
       · 读云端：attachMedia 把每个条目的 f 从 gist.files 读回，填回 d。
     旧 Gist 的条目含 d 无 f，读时原样保留；下次写入时自动迁移为新格式。 */
  function mediaSlots(modules) {
    var slots = [];
    Object.keys(modules || {}).forEach(function (id) {
      var m = modules[id];
      if (m && typeof m === 'object' && !Array.isArray(m) &&
          m.media && typeof m.media === 'object' && !Array.isArray(m.media)) {
        slots.push({ id: id, dict: m.media });
      }
    });
    return slots;
  }

  function mediaFileName(id, dataUri) {
    var m = /^data:([^;,]+)/.exec(String(dataUri || ''));
    var ext = 'bin';
    if (m) {
      var sub = String(m[1]).split('/')[1] || '';
      ext = sub.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12) || 'bin';
      if (ext === 'jpeg') ext = 'jpg';
      if (ext === 'svgxml') ext = 'svg';
    }
    return IMG_PREFIX + id + '.' + ext;
  }

  /** 非破坏性：抽离所有媒体 data URI，返回瘦身模块与图片文件表 */
  function detachMedia(modules) {
    var files = {}, slim = {};
    Object.keys(modules || {}).forEach(function (mid) {
      var m = modules[mid];
      if (!m || typeof m !== 'object' || Array.isArray(m)) { slim[mid] = m; return; }
      var copy = {};
      Object.keys(m).forEach(function (k) { copy[k] = m[k]; });
      if (m.media && typeof m.media === 'object' && !Array.isArray(m.media)) {
        var media = {};
        Object.keys(m.media).forEach(function (id) {
          var e = m.media[id];
          if (!e || typeof e !== 'object') { media[id] = e; return; }
          var d = e.d;
          if (typeof d === 'string' && /^data:(?:image|video)\//i.test(d)) {
            var fname = mediaFileName(id, d);
            files[fname] = d;
            var entry = {};
            if (e.t !== undefined) entry.t = e.t;
            if (e.n !== undefined) entry.n = e.n;
            entry.f = fname;
            media[id] = entry;
          } else {
            media[id] = e; // 无 data URI 的异常项或旧格式：原样保留
          }
        });
        copy.media = media;
      }
      slim[mid] = copy;
    });
    return { modules: slim, files: files };
  }

  /** 把云端图片文件内容注入回瘦身模块，还原完整 data URI。
   *  关键：注入后必须删掉 f，使云端读回的 media 条目 {t,n,d} 与本地、baseSnapshot
   *  结构完全一致——否则三方合并的 sameVal 失效（删除被误判为冲突）、remoteHash
   *  也永远对不上 syncedHash（每轮都误判云端有变化）。 */
  function attachMedia(payload, gistFiles) {
    if (!payload || !payload.modules) return payload;
    mediaSlots(payload.modules).forEach(function (slot) {
      Object.keys(slot.dict).forEach(function (id) {
        var e = slot.dict[id];
        if (!e || typeof e !== 'object' || !e.f || typeof e.d === 'string') return;
        var file = gistFiles && gistFiles[e.f];
        if (file && typeof file.content === 'string' && file.content) {
          e.d = file.content;
        }
        delete e.f; // 无论图片是否成功注入，都不把云端映射字段带进合并域
      });
    });
    return payload;
  }

  function parseGist(gist) {
    var file = gist && gist.files && gist.files[FILE];
    if (!file || !file.content) return null;
    try { return JSON.parse(file.content); } catch (e) { return null; }
  }

  /** 读取单个 raw 文件的完整文本。
   *  Gist raw URL 是「能力 URL」：私有 Gist 也无需 Authorization 即可读取，且响应带
   *  Access-Control-Allow-Origin: *，因此浏览器可直接 fetch（简单 GET，不能带自定义
   *  header，否则触发预检被 403 拒绝）。绝不能走 request()——它会加 Authorization
   *  并打 api.github.com，既拿不到 raw 内容也会触发预检。 */
  function fetchRaw(url) {
    return fetchTimeout(url).then(function (res) {
      if (!res.ok) throw new Error('读取图片失败（HTTP ' + res.status + '）');
      return res.text();
    });
  }

  /** 该文件的 content 是否完整。
   *  GitHub Gist 详情接口 GET /gists/<id> 对「整个响应里所有文件的 content」有约
   *  900KB 的总预算，按文件名顺序累加，超出后把后续文件的 content 截断甚至置空——
   *  但 size 字段仍是原始 UTF-8 字节数。必须按字节数比较（主 JSON 含中文，一个中文
   *  占 3 字节，字符数会远小于字节数），图片是纯 ASCII 两者相等。被截断的内容若直接
   *  注入会导致图片损坏，且 hash 与本地不一致、每轮都误判「云端变化」而无法收敛。 */
  function contentComplete(file) {
    if (!file || typeof file.content !== 'string') return false;
    var size = Number(file.size);
    // 无 size 信息（罕见）时无法判定，按「有内容即完整」处理，避免无谓的 raw 请求
    if (!isFinite(size) || size <= 0) return file.content.length > 0;
    return utf8Len(file.content) === size;
  }

  // raw 完整内容缓存：文件名 → { size, text }。被截断的文件每轮详情都只有半截内容，
  // 若 size 未变（内容没更新）就复用缓存，避免云端轮询每 15 秒重复下载所有大图。
  // 只存内存不落盘（不占 localStorage 配额），刷新页面后最多补下载一次。
  var rawCache = {};

  function readRemote() {
    if (!cfg.gistId) return Promise.resolve(null);
    return request('GET', '/gists/' + encodeURIComponent(cfg.gistId)).then(function (g) {
      var gistFiles = (g && g.files) || {};

      // 先把详情接口里被截断/置空的图片（含主 JSON）用 raw_url 补齐。
      // 只补不完整的，完整的直接用 content，避免每次同步都重复下载所有图片。
      var names = Object.keys(gistFiles);
      var fixes = [];
      var failed = {}; // 补齐失败的文件名：内容不可信，绝不能注入半截数据
      names.forEach(function (name) {
        var f = gistFiles[name];
        if (contentComplete(f)) return;
        var size = Number(f.size);
        // 命中缓存：同一文件 size 未变（内容没更新），直接复用上轮补齐的完整文本
        var cached = rawCache[name];
        if (cached && cached.size === size && utf8Len(cached.text) === size) {
          f.content = cached.text;
          return;
        }
        if (typeof f.raw_url !== 'string' || !f.raw_url) return;
        fixes.push(fetchRaw(f.raw_url).then(function (text) {
          // raw 偶发也会因网络只返回部分内容；长度不符视为失败，绝不注入半截数据。
          if (utf8Len(text) !== size) {
            throw new Error('raw 内容长度 ' + utf8Len(text) + ' 与声明 ' + size + ' 不符');
          }
          f.content = text; // 就地补齐；f 是 gistFiles 里的同一引用
          rawCache[name] = { size: size, text: text }; // 缓存，供后续轮询复用
        }).catch(function (e) {
          // 补齐失败：清空被截断的 content，使 attachMedia 跳过注入、seen 不计入，
          // 绝不用半截 data URI 覆盖本地完整图片（那会显示损坏图且 hash 永不收敛）。
          failed[name] = true;
          f.content = '';
          console.error('[sync] raw 补齐失败 ' + name, e);
        }));
      });

      return Promise.all(fixes).then(function () {
        // 云端图片清单以「实际读到的文件」为准：换设备、外部改动 Gist 后也不会误判。
        // 差量写入与孤儿文件清理都依赖这份清单。
        var seen = {};
        Object.keys(gistFiles).forEach(function (name) {
          if (name.indexOf(IMG_PREFIX) === 0 &&
              typeof gistFiles[name].content === 'string' &&
              contentComplete(gistFiles[name])) {
            seen[name] = hash(gistFiles[name].content);
          }
        });
        cfg.imageFiles = seen;
        // Gist API 对单个文件只返回最多 1MB；被截断的 JSON 不能当作「云端无数据」，
        // 否则会把本地内容误判为更新并静默覆盖云端。标记为 truncated，交给上层
        // 走「用本地重建云端」的确认流程——既不静默覆盖，也不让同步彻底死锁。
        var file = gistFiles[FILE];
        // truncated 仅当「补齐后主 JSON 仍不完整」才成立：若已用 raw 成功补回完整内容，
        // 就不能再当云端无数据处理（否则会误触发重建确认）。补齐失败的文件内容已被清空，
        // 主 JSON 失败时必须走重建确认，绝不能当成云端无数据而用本地整包覆盖。
        if (file && (failed[FILE] || (file.truncated && !contentComplete(file)))) {
          return { gist: g, payload: null, truncated: true };
        }
        var payload = parseGist(g);
        if (payload) attachMedia(payload, gistFiles); // 图片文件注入回 media[id].d
        return { gist: g, payload: payload };
      });
    });
  }

  /** UTF-8 字节数：GitHub 的 1MB 上限按字节算，JS 的 .length 会严重低估中文体积 */
  function utf8Len(str) {
    try { return new global.TextEncoder().encode(str).length; }
    catch (e) { return unescape(encodeURIComponent(str)).length; }
  }

  /** Gist 单文件安全上限（UTF-8 字节），给 1MB 硬限留余量 */
  var SYNC_LIMIT = 950 * 1024;

  /** 统一的主 JSON 序列化：写入与体积估算共用，保证阈值判断完全同源。
   *  version 2：媒体 data URI 已拆到独立文件，modules.*.media 只留 {t,n,f} 映射。 */
  function serializeGist(merged) {
    return JSON.stringify({
      app: 'open-shelf', version: 2, updatedAt: Date.now(), modules: merged
    }, null, 2);
  }

  /** 构造图片文件变更集：POST 全量写入；PATCH 只写变化的文件、删除不再引用的孤儿文件 */
  function imageChanges(desired, isPost) {
    var body = {}, prev = cfg.imageFiles || {};
    if (isPost) {
      Object.keys(desired).forEach(function (n) { body[n] = { content: desired[n] }; });
    } else {
      Object.keys(desired).forEach(function (n) {
        if (prev[n] !== hash(desired[n])) body[n] = { content: desired[n] };
      });
      Object.keys(prev).forEach(function (n) {
        if (!desired[n]) body[n] = null; // null = 删除该 Gist 文件
      });
    }
    return body;
  }

  /** 把模块数据写进 Gist：主 JSON（正文+映射）+ 每张图片一个独立文件。
   *  finalSnapshot：本次落地后的实际模块数据（完整 data URI），作为下次三方合并的共同祖先。 */
  function writeGist(merged, localModules, mergedHash, finalSnapshot) {
    var myEpoch = epoch; // 写入请求期间若用户断开，结果作废，不再写回配置
    var split = detachMedia(merged);
    var content = serializeGist(split.modules);
    // 主 JSON 留出安全余量，避免读取时被截断（Gist 单文件 1MB，按 UTF-8 字节计）。
    // 图片已拆到独立文件，不再挤占这份配额；中文 1 字符 UTF-8 占 3 字节，
    // 必须按真实字节数判断而非 .length。
    var bytes = utf8Len(content);
    if (bytes > SYNC_LIMIT) {
      return Promise.reject(new Error(
        '笔记正文 ' + Math.round(bytes / 1024) + 'KB 超过单文件上限（约 950KB），' +
        '请精简文字内容'
      ));
    }
    // 每张图片也必须是独立文件里的完整内容，不能超单文件上限，否则读取时被截断。
    var desired = split.files;
    var names = Object.keys(desired);
    for (var i = 0; i < names.length; i++) {
      var ib = utf8Len(desired[names[i]]);
      if (ib > SYNC_LIMIT) {
        return Promise.reject(new Error(
          '图片 ' + names[i] + ' 约 ' + Math.round(ib / 1024) + 'KB，超过单文件上限（约 950KB），' +
          '请换一张更小的图片'
        ));
      }
    }

    function finish(g, rebuilt) {
      if (myEpoch !== epoch) return { skipped: true, reason: 'disconnected' };
      cfg.gistId = g.id;
      cfg.syncedHash = mergedHash;
      cfg.localHash = hashModules(localModules);
      // 深拷贝隔离：merged 可能就是 collectLocal() 返回的模块引用，若直接持有，
      // 用户随后编辑 state.media 会连带污染 baseSnapshot，使三方合并失去共同祖先。
      cfg.baseSnapshot = snapshotOf(finalSnapshot || merged);
      var next = {};
      names.forEach(function (n) { next[n] = hash(desired[n]); });
      cfg.imageFiles = next;
      cfg.syncedAt = Date.now();
      clearDetached(); // 成功上传后，断开快照已过期，避免下次恢复误报「本地新增」
      saveCfg();
      return {
        ok: true, id: g.id, htmlUrl: g.html_url,
        count: Object.keys(merged).length, images: names.length, rebuilt: !!rebuilt
      };
    }

    var method = cfg.gistId ? 'PATCH' : 'POST';
    var path = cfg.gistId ? '/gists/' + encodeURIComponent(cfg.gistId) : '/gists';
    var body = cfg.gistId
      ? { files: {} }
      : { description: DESC, public: false, files: {} };
    body.files[FILE] = { content: content };
    var changes = imageChanges(desired, method === 'POST');
    Object.keys(changes).forEach(function (n) { body.files[n] = changes[n]; });
    return request(method, path, body).then(function (g) {
      return finish(g, method === 'POST');
    }).catch(function (e) {
      // 自救：PATCH 一个已被删除或无权访问的 Gist 会返回 404。清空旧 ID 改用
      // POST 新建（全量写入所有图片），自动重建关联——否则「Gist 丢失后同步全失败」死锁。
      if (method === 'PATCH' && e && e.status === 404 && myEpoch === epoch) {
        cfg.gistId = '';
        var fresh = { description: DESC, public: false, files: {} };
        fresh.files[FILE] = { content: content };
        var all = imageChanges(desired, true);
        Object.keys(all).forEach(function (n) { fresh.files[n] = all[n]; });
        return request('POST', '/gists', fresh).then(function (g) {
          return finish(g, true);
        });
      }
      throw e;
    });
  }

  /* ---------- 调度器状态 ---------- */
  var syncing = false;
  var epoch = 0; // 每次「断开关联」自增，使在途的读写结果失效
  var lastSeenLocalHash = null;
  var debounceTimer = null;
  var localTimer = null;
  var cloudTimer = null;
  var lastAuto = { at: 0, result: null, reason: '' };
  var pendingRestore = null; // 恢复配置时检测到本地新增内容，等待用户选择上传/下载

  /** 单次对账：读云端 → 判定方向 → 上传/下载/无事 */
  function reconcile(reason) {
    reason = reason || 'manual';
    if (syncing) return Promise.resolve({ skipped: true });
    if (!cfg.token) return Promise.resolve({ error: '请先填写 GitHub Token' });
    var myEpoch = epoch;
    // 允许无 gistId：本地有数据时会自动新建私有 Gist（见下方 writeGist）

    syncing = true;
    // 同步开始时通知面板：胶囊内箭头淡入并旋转；结束时成对通知隐藏
    if (Portal.bus && Portal.bus.emit) Portal.bus.emit('sync:progress', { active: true, reason: reason });
    var localModules = collectLocal();
    var localHash = hashModules(localModules);

    // 404 视为云端不存在，后续重建；其它错误原样抛出
    return readRemote().catch(function (e) {
      if (e && e.status === 404) return null;
      throw e;
    }).then(function (remote) {
      if (myEpoch !== epoch) return { skipped: true, reason: 'disconnected' };

      // 云端文件被截断（历史超限数据）：内容不可信，绝不静默覆盖。
      // 返回确认请求，让用户在面板选择「用本地重建云端」或「稍后处理」。
      if (remote && remote.truncated) {
        return {
          needConfirm: true, kind: 'cloud-truncated',
          rebuildable: !!Object.keys(localModules).length,
          gistUrl: remote.gist && remote.gist.html_url
        };
      }

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

      // 新设备首次关联云端（syncedHash 为空）：无条件以云端为准。
      // 否则本地时间戳（本机 Date.now()，可能比写入云端的设备时钟新很多）会被误判为
      // 「本地更新」从而上传，把新设备上的示例/空数据整包覆盖掉云端真实数据。
      // 首次关联时本地数据一律视为不可信，必须先把云端数据拉下来。
      var firstLink = !cfg.syncedHash;

      // 同一台设备「断开关联 → 本地继续编辑 → 恢复配置」：
      // 此时 syncedHash 已被清空，按普通首次关联会直接下载云端，把本地新增内容冲掉。
      // 若断开时记下了本地快照，且现在确实变了，先交用户选择，不擅自覆盖任何一侧。
      var hasDetached = !!(cfg.detachedHash || cfg.detachedHashes);
      var changed = hasDetached ? changedModuleIds(localModules) : [];
      if (firstLink && hasDetached && (localHash !== cfg.detachedHash || changed.length)) {
        pendingRestore = {
          remoteHash: remoteHash,
          remoteTs: remoteTs,
          localHash: localHash,
          changed: changed,
          at: Date.now()
        };
        return {
          needConfirm: true, kind: 'local-after-disconnect',
          changed: changed, remoteHash: remoteHash, localHash: localHash
        };
      }

      var base = cfg.baseSnapshot || {};

      // 双方都改：不再用「本机时钟」裁决整模块覆盖（那会静默吞掉另一台设备新增的条目，
      // 且设备时钟不一致时裁决错乱）。改为三方合并：以 base 为共同祖先，逐条合并
      // 本地与云端，然后把合并结果同时落回本地与云端。不依赖任何设备时钟。
      if (!firstLink && localDirty && remoteChanged) {
        var mergedBoth = threeWayMergeModules(base, localModules, remoteModules);
        var mergedHash = hashModules(mergedBoth);
        // 合并结果先落到本地（重绘/写盘），再写云端；localHash 取「合并后重新采集」的值，
        // 这样落地的归一化结果就是新基线，避免下一轮反复判脏。
        var applyBoth = applyRemote(mergedBoth);
        var landedModules = collectLocal();
        if (mergedHash === remoteHash && applyBoth.failed.length === 0) {
          // 合并结果与云端一致（可能另一台设备已写入相同内容），无需再写，直接收敛基线
          cfg.syncedHash = remoteHash;
          cfg.localHash = hashModules(landedModules);
          cfg.baseSnapshot = snapshotOf(mergedBoth);
          cfg.syncedAt = remoteTs || Date.now();
          saveCfg();
          applyBoth.ok = true;
          applyBoth.note = 'merged-in-sync';
          applyBoth.htmlUrl = remote.gist.html_url;
          return applyBoth;
        }
        return writeGist(mergedBoth, landedModules, mergedHash, mergedBoth)
          .then(function (r) {
            if (r && r.ok) {
              r.merged = true;
              r.applied = applyBoth.applied;
              r.failed = (r.failed || []).concat(applyBoth.failed);
              if (applyBoth.failed.length) r.error = applyBoth.failed.length + ' 个模块应用失败，已保留本地数据';
            }
            return r;
          });
      }

      // 仅本地变（云端没动）：三方合并退化为「本地覆盖 + 保留云端独有模块」，写入云端。
      // 用三方合并而非整模块覆盖，可在 base 缺失时仍保住云端独有的模块数据。
      var localWins = !firstLink && localDirty;
      if (localWins) {
        var mergedLocal = threeWayMergeModules(base, localModules, remoteModules);
        return writeGist(mergedLocal, localModules, hashModules(mergedLocal), mergedLocal);
      }

      // 仅云端变（本地没动）：以云端为准落地，并把云端快照记为新基线。
      // 同样经过三方合并，保住本地冷数据里可能存在的独有模块。
      var mergedRemote = firstLink ? remoteModules : threeWayMergeModules(base, localModules, remoteModules);
      var r = applyRemote(mergedRemote);
      cfg.syncedHash = remoteHash;
      cfg.localHash = hashModules(collectLocal());
      cfg.baseSnapshot = snapshotOf(mergedRemote);
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
      if (Portal.bus && Portal.bus.emit) Portal.bus.emit('sync:progress', { active: false, reason: reason });
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

  /** 把当前同步配置用口令加密成恢复码。口令不落盘。 */
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
      gistId: cfg.gistId || ''
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
      // 新设备以云端为准：清空同步哈希，让下次对账走下载方向
      cfg.syncedHash = '';
      cfg.localHash = '';
      cfg.localChangedAt = 0;
      cfg.baseSnapshot = null;
      cfg.auto = true;
      saveCfg();
      return { ok: true, gistId: cfg.gistId };
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
      gistId: cfg.gistId || ''
    };
    var salt = new Uint8Array(16), iv = new Uint8Array(12);
    c.getRandomValues(salt);
    c.getRandomValues(iv);
    var code = cfg.vaultCode || randomCode(6);
    if (!code) return Promise.resolve({ error: '无法生成短码：随机数不可用' });
    var desc = VAULT_TAG + '-' + code + ' · SHELF / ONLINE 恢复保险箱（自动生成，请勿删除）';
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
      cfg.vaultCode = cfg.vaultCode || (code.length === 6 ? code : '');
      if (resolvedOwner) cfg.vaultOwner = resolvedOwner;
      cfg.syncedHash = '';
      cfg.localHash = '';
      cfg.localChangedAt = 0;
      cfg.baseSnapshot = null;
      cfg.auto = true;
      saveCfg();
      return { ok: true, gistId: cfg.gistId };
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

    /** 同步数据上限（字节），供编辑器等 UI 显示同一阈值 */
    limitBytes: SYNC_LIMIT,

    /**
     * 估算「当前数据若同步到云端」的体积，与 writeGist 完全同源。
     * 图片已拆到独立文件，bytes 只统计主 JSON（正文+映射），另返回图片体积供参考。
     * @param {Object} [override] 覆盖某个模块的内存草稿，如 { notes: {notes,media,categories} }
     * @returns {{ bytes:number, limit:number, ratio:number, imageBytes:number, images:number }}
     */
    estimate: function (override) {
      var modules = collectLocal();
      if (override && typeof override === 'object') {
        Object.keys(override).forEach(function (id) {
          if (override[id] && typeof override[id] === 'object') modules[id] = override[id];
        });
      }
      var split = detachMedia(modules);
      var bytes = utf8Len(serializeGist(split.modules));
      var names = Object.keys(split.files);
      var imageBytes = names.reduce(function (n, k) { return n + utf8Len(split.files[k]); }, 0);
      return {
        bytes: bytes, limit: SYNC_LIMIT, ratio: bytes / SYNC_LIMIT,
        imageBytes: imageBytes, images: names.length
      };
    },

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
        var merged = threeWayMergeModules(cfg.baseSnapshot || {}, localModules, remoteModules);
        return writeGist(merged, localModules, hashModules(merged), merged);
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
        // force 下载：明确以云端为准，base 也重置为云端，下一次正常对账从同一起点出发
        var r = applyRemote(remoteModules);
        cfg.syncedHash = remoteHash;
        cfg.localHash = hashModules(collectLocal());
        cfg.baseSnapshot = snapshotOf(opts.force ? remoteModules : threeWayMergeModules(cfg.baseSnapshot || {}, collectLocal(), remoteModules));
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

    /**
     * 恢复配置时用户对「本地新增内容」的选择：
     *   upload   —— 把断开后的本地改动上传（云端同模块内容会被替换）
     *   download —— 以云端为准（本地断开后的改动会被替换）
     *   later    —— 什么都不改，下次同步再问
     */
    resolveRestore: function (choice) {
      var p = pendingRestore;
      if (!p) return Promise.resolve({ error: '没有待确认的本地改动，或确认已过期' });
      if (choice === 'upload') {
        // 让下一次 reconcile 走「本地更新」方向：云端哈希视为已同步，本地基线视为断开时的快照
        cfg.syncedHash = p.remoteHash || '';
        cfg.localHash = cfg.detachedHash || '';
        cfg.localChangedAt = Date.now();
        clearDetached();
        saveCfg();
        pendingRestore = null;
        return reconcile('restore-upload');
      }
      if (choice === 'download') {
        clearDetached();
        saveCfg();
        pendingRestore = null;
        return reconcile('restore-download');
      }
      pendingRestore = null; // 保留 detached 快照，下次同步仍会提醒
      return Promise.resolve({ ok: true, note: 'postponed' });
    },

    /**
     * 云端数据被截断/损坏后的自救：明确用本地数据覆盖重建云端 Gist。
     * 仅由用户在确认卡里主动触发，绝不自动调用。绕过 readRemote 的截断判定，
     * 直接把本地模块写成一个全新的 payload；体积仍受 writeGist 保护。
     */
    rebuildCloud: function () {
      var localModules = collectLocal();
      if (!Object.keys(localModules).length) {
        return Promise.resolve({ error: '本地没有数据，无法重建云端。请先在模块里添加内容。' });
      }
      // 先清掉旧 Gist ID：截断文件无法增量修复，直接新建一份干净的私有 Gist，
      // 旧的可疑 Gist 保留在用户账号里（不会删除用户任何数据），由用户自行处理。
      epoch++; // 作废在途请求，避免旧结果把 gistId 写回
      cfg.gistId = '';
      cfg.syncedHash = '';
      cfg.localHash = '';
      cfg.detachedHash = '';
      cfg.detachedHashes = null;
      cfg.baseSnapshot = null;
      saveCfg();
      return writeGist(localModules, localModules, hashModules(localModules), localModules);
    },

    /** 断开：清掉本机 Token 与关联，后台同步随之停止；本地数据不动 */
    disconnect: function () {
      // 只清 gistId 不够：token 还在时 localTimer / visibilitychange 会触发 autoRun，
      // 无 gistId 的 reconcile 会新建私有 Gist，等于「断开」后又静默关联了云端。
      epoch++; // 在途请求的结果全部作废，避免断开后又把 gistId 写回来
      // 记下此刻的本地快照，恢复时才能分辨「断开后新增的内容」。
      // 模块2在断开关联后会恢复内置示例，不再属于「断开后的本地改动」，
      // 所以从快照里剔除，避免下次恢复配置时被误判成冲突。
      var detached = collectLocal();
      delete detached.notes;
      cfg.detachedHash = hashModules(detached);
      cfg.detachedHashes = moduleHashes(detached);
      cfg.detachedAt = Date.now();
      cfg.token = '';
      cfg.gistId = '';
      cfg.syncedHash = '';
      cfg.localHash = '';
      cfg.baseSnapshot = null;
      cfg.syncedAt = 0;
      cfg.localChangedAt = 0;
      saveCfg();
      // 未挂载模块时也要回到示例态：直接清掉笔记冷数据，
      // 已挂载时由下面的事件让模块立即重绘，不必等刷新页面。
      try { Portal.store.namespace('notes').clear(); } catch (e) { /* noop */ }
      lastAuto = { at: Date.now(), result: null, reason: 'disconnect' };
      if (Portal.bus && Portal.bus.emit) {
        Portal.bus.emit('sync:auto', lastAuto);
        Portal.bus.emit('sync:disconnect', { at: cfg.detachedAt, reason: 'disconnect' });
      }
    },

    /**
     * 一键重置到初始状态（完全出厂）：清空本机模块数据 + 云端文件 + 本机全部凭证。
     * 用于历史超限大文件导致云端截断、同步反复断流后的彻底重来。
     * 顺序至关重要：先用凭证写空云端（唯一需要凭证的一步），成功后才清本地数据与凭证。
     * 只在用户在面板二次确认后调用，绝不自动触发。
     */
    resetAll: function () {
      // 作废一切在途读写并停表：否则清理过程中本地检测/云端轮询会把内存里的
      // 旧数据重新写回云端，或在途请求把旧基线写回配置。
      epoch++;
      syncing = false;
      if (localTimer) { global.clearInterval(localTimer); localTimer = null; }
      if (cloudTimer) { global.clearInterval(cloudTimer); cloudTimer = null; }
      global.clearTimeout(debounceTimer);
      debounceTimer = null;
      lastSeenLocalHash = null;

      // 先把云端文件重写为空 payload —— 这一步不依赖本地内存态，直接传空对象。
      // 只有云端清理成功才继续清本机，避免「云端没清掉、本地却丢了」的最坏结果。
      // writeGist 已按 UTF-8 算体积，空数据必然安全，旧超限文件被彻底替换。
      return writeGist({}, {}, hashModules({}), {}).then(function (r) {
        if (r && r.skipped) return r;
        // 云端已清空：清掉两个模块（及共享设置）的本地数据。页面重载后模块
        // 读不到数据会自动回到内置示例（demo 态不参与同步），即「初始状态」。
        ['notes', 'repo-showcase', 'settings'].forEach(function (id) {
          try { Portal.store.namespace(id).clear(); } catch (e) { /* noop */ }
        });
        // 最后一步才清凭证与全部基线 —— 回到完全未配置的出厂状态。
        // 必须在 writeGist 成功之后：写空云端是唯一需要 Token/Gist 的动作。
        cfg.token = '';
        cfg.gistId = '';
        cfg.syncedHash = '';
        cfg.localHash = '';
        cfg.syncedAt = 0;
        cfg.localChangedAt = 0;
        cfg.vaultCode = '';
        cfg.vaultGistId = '';
        cfg.vaultOwner = '';
        cfg.baseSnapshot = null;
        clearDetached();
        lastSeenLocalHash = null;
        lastAuto = { at: Date.now(), result: null, reason: 'reset' };
        saveCfg();
        if (Portal.bus && Portal.bus.emit) {
          Portal.bus.emit('sync:auto', lastAuto);
          Portal.bus.emit('sync:disconnect', { at: Date.now(), reason: 'reset' });
        }
        // 不重启调度器：凭证已清空，页面重载后是全新实例，等待用户重新配置。
        r.localCleared = true;
        return r;
      }).catch(function (e) {
        // 云端清理失败：本地数据保持不动，把错误交给 UI 明确提示，绝不静默。
        return { ok: false, error: (e && e.message || String(e)) };
      });
    },

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
    if (r.note === 'in-sync' || r.note === 'merged-in-sync') return '已是最新';
    if (r.merged && r.ok) return '已合并云端改动';
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
      // 标题行：自动开关与同步状态合并成一颗可点击胶囊，位置就是状态胶囊的位置
      '<div class="sy-head">' +
        '<div class="sy-head-main">' +
          '<span class="sy-kicker mono">AUTO SYNC / GIST</span>' +
          '<div class="sy-head-line">' +
            '<h3 class="sy-title">跨设备同步</h3>' +
            '<button class="sy-status-pill sy-combo" id="sy-auto" type="button" role="switch" ' +
              'aria-checked="false" title="点击开启或暂停自动同步">' +
              '<i class="sy-status-dot" aria-hidden="true"></i>' +
              '<span id="sy-status">未配置</span>' +
              '<i class="sy-auto-ico" aria-hidden="true"></i>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="sy-head-actions">' +
          '<button class="sy-close" id="sy-close" type="button" aria-label="关闭">×</button>' +
        '</div>' +
      '</div>' +

      // 恢复配置时发现本地新增内容的确认卡：紧贴标题行，出现即可见
      '<div class="sy-restore-choice" id="sy-restore-choice" hidden>' +
        '<div class="sy-restore-choice-head" id="sy-restore-head">本地有新增内容 · 请选择</div>' +
        '<p class="sy-restore-choice-desc" id="sy-restore-desc"></p>' +
        '<div class="sy-restore-choice-actions">' +
          '<button class="btn btn--primary sy-btn" id="sy-restore-upload" type="button">上传本地</button>' +
          '<button class="btn sy-btn" id="sy-restore-download" type="button">下载云端</button>' +
          '<button class="sy-link" id="sy-restore-later" type="button">稍后处理</button>' +
        '</div>' +
      '</div>' +

      // 第 1 步：连接云端（日常只需 Token + 立即同步；强制操作收进更多设置）
      '<section class="sy-step">' +
        '<div class="sy-step-head"><span class="sy-step-no mono">1</span><span>连接云端</span></div>' +
        '<label class="sy-label">GitHub Token' +
          '<span class="sy-label-hint">只需 gist 权限 · 仅存本机</span>' +
          '<input class="sy-input" id="sy-token" type="password" autocomplete="off" ' +
            'spellcheck="false" placeholder="ghp_…" value="' + esc(cfg.token) + '">' +
        '</label>' +
        '<div class="sy-actions sy-actions--sync">' +
          '<button class="btn btn--primary sy-btn" id="sy-sync-now" type="button"><i class="i-ico i-refresh" aria-hidden="true"></i> 立即同步</button>' +
          '<button class="btn sy-btn sy-more-toggle" id="sy-more-toggle" type="button" ' +
            'aria-expanded="false" aria-controls="sy-more-body">更多设置 ' +
            '<i class="i-ico i-chev sy-more-chev" aria-hidden="true"></i>' +
          '</button>' +
        '</div>' +
        '<div class="sy-more-body" id="sy-more-body" hidden>' +
          '<label class="sy-label">Gist ID' +
            '<span class="sy-label-hint">首次同步后自动填写；换设备时也可手动填入</span>' +
            '<input class="sy-input" id="sy-gist" type="text" autocomplete="off" ' +
              'spellcheck="false" placeholder="例如 0a1b2c3d…" value="' + esc(cfg.gistId) + '">' +
          '</label>' +
          '<p class="sy-more-hint">强制操作仅在冲突恢复时使用；日常请用「立即同步」，它会自动判断上传或下载，不会静默覆盖数据。</p>' +
          '<div class="sy-actions sy-actions--sub">' +
            '<button class="sy-link" id="sy-push" type="button">强制上传</button>' +
            '<button class="sy-link" id="sy-pull" type="button">强制下载</button>' +
          '</div>' +
          '<div class="sy-actions sy-actions--sub">' +
            '<button class="sy-link" id="sy-disconnect" type="button">断开关联</button>' +
            '<a class="sy-link" href="https://github.com/settings/tokens/new?scopes=gist&description=Open%20Shelf%20Sync" ' +
              'target="_blank" rel="noopener noreferrer">获取 Token ↗</a>' +
          '</div>' +
          '<div class="sy-actions sy-actions--sub sy-danger-row">' +
            '<button class="sy-link sy-link--danger" id="sy-reset" type="button">' +
              '<i class="i-ico i-reset" aria-hidden="true"></i> 重置到初始状态</button>' +
            '<span class="sy-danger-hint">清空本机与云端数据</span>' +
          '</div>' +
        '</div>' +
      '</section>' +

      // 第 2 步：换设备（两个场景用 Tab 分开：生成凭证 / 恢复配置）
      '<section class="sy-step">' +
        '<div class="sy-step-head"><span class="sy-step-no mono">2</span><span>换设备</span></div>' +
        '<p class="sy-step-desc">设一次口令生成凭证；在其它设备填凭证即可恢复，无需再抄长 Token。</p>' +
        '<div class="sy-vtabs" role="tablist">' +
          '<button class="sy-vtab is-active" id="sy-vtab-make" type="button" role="tab" aria-selected="true">生成凭证</button>' +
          '<button class="sy-vtab" id="sy-vtab-restore" type="button" role="tab" aria-selected="false">恢复配置</button>' +
        '</div>' +
        // 场景 A：生成凭证（只需设口令）
        '<div class="sy-vpanel" id="sy-vpanel-make">' +
          '<label class="sy-label">设置口令' +
            '<span class="sy-label-hint">至少 6 位，自己记牢；忘了无法找回</span>' +
            '<input class="sy-input" id="sy-pass" type="password" autocomplete="new-password" ' +
              'spellcheck="false" placeholder="自己设一个好记的口令">' +
          '</label>' +
          '<div class="sy-actions sy-pass-actions">' +
            '<button class="btn btn--primary sy-btn" id="sy-pass-make" type="button">生成凭证</button>' +
          '</div>' +
          '<div class="sy-vault-seal" id="sy-vault-seal" hidden>' +
            '<span class="sy-vault-seal-label">你的恢复凭证 · 口令自己记牢</span>' +
            '<span class="sy-vault-seal-code mono" id="sy-vault-seal-code">——</span>' +
            '<div class="sy-seal-links">' +
              '<button class="sy-link" id="sy-code-copy" type="button">复制凭证</button>' +
              '<button class="sy-link sy-link--sub" id="sy-vault-link-copy" type="button">复制备用链接</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // 场景 B：恢复配置（用户名 + 短码 + 口令）
        '<div class="sy-vpanel" id="sy-vpanel-restore" hidden>' +
          '<label class="sy-label">GitHub 用户名' +
            '<span class="sy-label-hint">凭证所属账号；用备用链接时可留空</span>' +
            '<input class="sy-input" id="sy-owner" type="text" autocomplete="off" ' +
              'spellcheck="false" placeholder="例如 octocat" value="' + esc(cfg.vaultOwner) + '">' +
          '</label>' +
          '<label class="sy-label">恢复短码' +
            '<span class="sy-label-hint">6 位短码，也可粘贴备用链接</span>' +
            '<input class="sy-input sy-code-input" id="sy-code" type="text" spellcheck="false" ' +
              'autocomplete="off" placeholder="例如 K7M2QX">' +
          '</label>' +
          '<label class="sy-label">口令' +
            '<span class="sy-label-hint">生成凭证时设的同一个</span>' +
            '<input class="sy-input" id="sy-restore-pass" type="password" autocomplete="off" ' +
              'spellcheck="false" placeholder="你的配置口令">' +
          '</label>' +
          '<div class="sy-actions sy-pass-actions">' +
            '<button class="btn btn--primary sy-btn" id="sy-pass-restore" type="button">恢复配置</button>' +
          '</div>' +
        '</div>' +
      '</section>' +

      '<p class="sy-msg mono" id="sy-msg" role="status"></p>' +
      '<p class="sy-note">数据只存进你自己的私有 Gist；自动同步约每 15 秒检查云端，本地改动约 2 秒后上传。</p>';

    wrap.appendChild(fab);
    wrap.appendChild(panel);

    // 优先插入页头 .header-meta（状态标签旁）；找不到时降级挂到 body
    var headerMeta = document.querySelector('.header-meta');
    if (headerMeta) {
      var statusEl = headerMeta.querySelector('.status');
      if (statusEl && statusEl.parentNode) {
        // MODULE 状态是可点击的切换器（含二级菜单），整组作为一个锚点，避免把面板插进按钮与菜单之间
        var anchor = statusEl.closest ? (statusEl.closest('.module-switch') || statusEl) : statusEl;
        headerMeta.insertBefore(wrap, anchor.nextSibling);
      } else headerMeta.appendChild(wrap);
      // SYNC 紧跟状态标签；主题按钮始终位于 GitHub 外链之前（与主题脚本互相兜底）。
      var themeEl = headerMeta.querySelector('#theme-toggle');
      var ghEl = headerMeta.querySelector('.site-github-link');
      if (themeEl && ghEl && ghEl.parentNode) headerMeta.insertBefore(themeEl, ghEl);
    } else {
      wrap.classList.add('sy-wrap--floating');
      document.body.appendChild(wrap);
    }

    var msgEl = panel.querySelector('#sy-msg');
    var statusEl = panel.querySelector('#sy-status');
    var tokenEl = panel.querySelector('#sy-token');
    var gistEl = panel.querySelector('#sy-gist');
    var autoBtn = panel.querySelector('#sy-auto');
    var moreBtn = panel.querySelector('#sy-more-toggle');
    var moreBody = panel.querySelector('#sy-more-body');
    var choiceBox = panel.querySelector('#sy-restore-choice');
    var choiceKind = 'local-after-disconnect'; // 当前确认卡类型，决定「上传」按钮的语义
    var choiceHead = panel.querySelector('#sy-restore-head');
    var choiceDesc = panel.querySelector('#sy-restore-desc');
    var choiceUpload = panel.querySelector('#sy-restore-upload');
    var choiceDownload = panel.querySelector('#sy-restore-download');
    var choiceLater = panel.querySelector('#sy-restore-later');
    var timer = null;
    var busyDepth = 0, busy = false, popping = false;

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
      // 幂等赋值：Windows 的 Chromium 对「写入相同 className」也会重启元素上的
      // CSS animation，自动同步每次 progress/auto 事件都刷新时会让呼吸/旋转图标
      // 反复从头播放，表现为频率异常变快。类名未变时绝不写 DOM。
      var dotCls = 'sy-trigger-dot' +
        (!ready || !cfg.auto ? '' : (hasError ? ' is-error' : (dirty ? ' is-dirty' : ' is-synced')));
      if (dot && dot.className !== dotCls) dot.className = dotCls;

      // 自动开关与状态是同一颗胶囊：颜色/圆点表达状态，点击切换自动同步
      var kind = !ready || !cfg.auto ? 'is-off' : (hasError ? 'is-error' : (dirty ? 'is-dirty' : 'is-synced'));
      var text = !ready ? (cfg.token ? '待关联' : '未配置')
        : (!cfg.auto ? '自动已暂停'
          : '自动 · ' + (hasError ? '同步出错' : (dirty ? '有改动' : '已同步')));
      var detail = (cfg.syncedAt ? '上次同步：' + fmtTime(cfg.syncedAt) + ' · ' : '尚未同步 · ') + autoText() +
        (cfg.gistId ? ' · Gist ' + cfg.gistId.slice(0, 10) + '…' : '');
      var btnCls = 'sy-status-pill sy-combo ' + kind + (cfg.auto ? ' is-on' : ' is-off') +
        (busy ? ' is-busy' : '') + (popping ? ' is-pop' : '');
      if (autoBtn.className !== btnCls) autoBtn.className = btnCls;
      autoBtn.setAttribute('aria-checked', cfg.auto ? 'true' : 'false');
      autoBtn.title = (cfg.auto ? '自动同步已开启 · 点击暂停' : '自动同步已暂停 · 点击开启') + '\n' + detail;
      statusEl.textContent = text;
    }

    // 手动同步与后台对账可能重叠；用计数避免先结束的那个把忙碌态提前清掉
    function setBusy(on) {
      busyDepth = Math.max(0, busyDepth + (on ? 1 : -1));
      busy = busyDepth > 0;
      refresh();
    }
    function pop() {
      popping = true; refresh();
      global.setTimeout(function () { popping = false; refresh(); }, 360);
    }
    function setMoreOpen(open) {
      moreBody.hidden = !open;
      moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      moreBtn.classList.toggle('is-open', open);
    }

    /** 恢复配置后检测到本地新增内容：给出明确选择，绝不静默覆盖任一侧 */
    function showRestoreChoice(r) {
      var kind = r && r.kind;
      choiceKind = kind || 'local-after-disconnect';
      if (kind === 'cloud-truncated') {
        choiceHead.textContent = '云端数据已损坏 · 需要处理';
        choiceDesc.textContent = '云端同步文件超过 Gist 单文件 1MB 上限，内容已被截断、无法安全读取。' +
          (r.rebuildable
            ? '为保护数据没有自动覆盖。可用本地数据重建一份干净的云端备份（旧文件会保留在你的 Gist 列表里，不会删除）。'
            : '当前本地也没有数据，请先在模块里添加内容，或到 GitHub 手动删除超限的 Gist 文件后重试。');
        choiceUpload.textContent = '用本地重建云端';
        choiceUpload.hidden = !r.rebuildable;
        choiceDownload.hidden = true;
        choiceLater.textContent = '稍后处理';
        choiceBox.hidden = false;
        msg('云端数据超限被截断，已暂停同步以避免覆盖', 'warn');
        return;
      }
      choiceHead.textContent = '本地有新增内容 · 请选择';
      choiceDesc.textContent = '检测到' +
        ((r && r.changed || []).length ? '「' + r.changed.map(function (id) {
          var d = syncDefs().filter(function (x) { return x.id === id; })[0];
          return (d && d.title) || id;
        }).join('、') + '」' : '本地数据') +
        '在断开关联后有改动。上传会用本地内容替换云端对应模块；下载会用云端内容替换本地改动。';
      choiceUpload.textContent = '上传本地';
      choiceUpload.hidden = false;
      choiceDownload.hidden = false;
      choiceLater.textContent = '稍后处理';
      choiceBox.hidden = false;
      msg('请先选择保留哪一侧的数据', 'warn');
    }
    function hideRestoreChoice() { choiceBox.hidden = true; }
    function resolveChoice(choice) {
      [choiceUpload, choiceDownload, choiceLater].forEach(function (b) { b.disabled = true; });
      var action = choice === 'rebuild' ? sync.rebuildCloud() : sync.resolveRestore(choice);
      action.then(function (r) {
        hideRestoreChoice();
        refresh();
        if (r && r.error) msg(r.error, 'error');
        else if (choice === 'rebuild') msg('已用本地数据重建云端备份', 'ok');
        else if (choice === 'upload') msg('本地改动已上传到云端', 'ok');
        else if (choice === 'download') msg('已按云端数据恢复', 'ok');
        else msg('已保留本地数据，暂未同步', 'warn');
      }).catch(function (e) {
        msg(e && e.message || String(e), 'error');
      }).then(function () {
        [choiceUpload, choiceDownload, choiceLater].forEach(function (b) { b.disabled = false; });
      });
    }

    function commitConfig(silent) {
      cfg.token = tokenEl.value.trim();
      cfg.gistId = gistEl.value.trim().replace(/^.*gists\//, '').replace(/[/?#].*$/, '');
      if (gistEl.value !== cfg.gistId) gistEl.value = cfg.gistId;
      saveCfg();
      refresh();
      // 手动点同步时不要再触发一次后台对账，否则两次 reconcile 会互相跳过
      if (!silent && cfg.token && cfg.auto) autoRun('config-change');
    }

    function run(action, force) {
      var btn = action === 'push' ? panel.querySelector('#sy-push') : panel.querySelector('#sy-pull');
      btn.disabled = true;
      setBusy(true);
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
        setBusy(false);
      });
    }

    /** 立即同步：走与后台相同的智能对账，自动判断上传/下载，避免手动方向选错 */
    function runNow() {
      commitConfig(true);
      var btn = panel.querySelector('#sy-sync-now');
      btn.disabled = true;
      setBusy(true);
      msg('正在同步…');
      sync.reconcile('manual').then(function (r) {
        if (!r) return;
        if (r.needConfirm && (r.kind === 'local-after-disconnect' || r.kind === 'cloud-truncated')) {
          showRestoreChoice(r);
          return;
        }
        if (r.skipped) {
          msg(r.reason === 'disconnected' ? '已断开关联，本次同步已取消' : '已有同步在进行中，请稍候', 'warn');
          return;
        }
        if (r.error) { msg(r.error, 'error'); return; }
        gistEl.value = cfg.gistId;
        if (r.note === 'in-sync' || r.note === 'merged-in-sync') msg('已是最新', 'ok');
        else if (r.merged && r.ok) msg('已合并云端改动 · ' + (r.applied || []).length + ' 个模块', 'ok');
        else if (r.applied) msg('已下载 · 更新 ' + r.applied.length + ' 个模块', 'ok');
        else if (r.count) msg('已上传 · ' + r.count + ' 个模块', 'ok');
        else msg('同步完成', 'ok');
      }).catch(function (e) {
        msg(e && e.message || String(e), 'error');
      }).then(function () {
        btn.disabled = false;
        setBusy(false);
      });
    }

    // 后台同步进行时也显示旋转箭头；结果只更新标题行状态，出错时提示
    if (Portal.bus && Portal.bus.on) {
      Portal.bus.on('sync:progress', function (info) { setBusy(!!(info && info.active)); });
      Portal.bus.on('sync:auto', function (info) {
        refresh();
        if (!info || !info.result || panel.hidden) return;
        if (info.result.needConfirm &&
            (info.result.kind === 'local-after-disconnect' || info.result.kind === 'cloud-truncated')) {
          showRestoreChoice(info.result);
          return;
        }
        if (info.result.error) msg('自动同步：' + info.result.error, 'error');
      });
    }

    function setOpen(open) {
      if (open) Portal.popovers.closeAll('sync-panel'); // 打开自己前先收起其它浮层
      panel.hidden = !open;
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) refresh();
    }
    Portal.popovers.register('sync-panel', function () { setOpen(false); });

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
      pop();
      msg(on ? '自动同步已开启' : '自动同步已关闭', on ? 'ok' : 'warn');
    });
    panel.querySelector('#sy-sync-now').addEventListener('click', runNow);
    moreBtn.addEventListener('click', function () { setMoreOpen(moreBody.hidden); });
    panel.querySelector('#sy-push').addEventListener('click', function () { commitConfig(true); run('push'); });
    panel.querySelector('#sy-pull').addEventListener('click', function () { commitConfig(true); run('pull'); });
    panel.querySelector('#sy-disconnect').addEventListener('click', function () {
      if (!global.confirm('断开后将清除本机保存的 Token 与云端关联，并停止自动同步；模块 2「笔记」会恢复为内置示例，模块 1 的本地数据保持不变。确定继续？')) return;
      sync.disconnect();
      // 底层清掉 token 后，输入框也要同步清空，否则再次点「立即同步」会把旧 Token 写回去
      tokenEl.value = '';
      gistEl.value = '';
      setMoreOpen(false);
      hideRestoreChoice();
      switchVTab('restore'); // 已无 Token，切回「恢复配置」更符合当前场景
      refresh();
      msg('已断开关联，自动同步已停止', 'warn');
    });

    // 重置到初始状态：两级确认，避免误触清空全部数据
    panel.querySelector('#sy-reset').addEventListener('click', function () {
      if (!global.confirm(
        '重置会先清空云端同步文件，再清空本机两个模块的数据，最后连本机保存的 Token、Gist 关联与恢复凭证一起清除，恢复到完全未配置的初始状态。\n\n' +
        '重要：其它已关联的设备需要各自点一次「重置到初始状态」，否则它们上的旧数据会再次同步回来。\n\n' +
        '此操作不可撤销，确定继续？')) return;
      if (!global.confirm('再次确认：真的要清空本机与云端的所有数据、并清除凭证吗？这一步无法撤销。')) return;
      var btn = panel.querySelector('#sy-reset');
      btn.disabled = true;
      msg('正在重置…');
      sync.resetAll().then(function (r) {
        btn.disabled = false;
        if (!r || r.error || r.skipped) {
          msg('重置失败：' + ((r && r.error) || (r && r.reason) || '未知错误') + '。本地数据未改动，请重试。', 'error');
          return;
        }
        // 凭证已清空，输入框同步清空，避免页面重载前残留旧值误导
        tokenEl.value = '';
        gistEl.value = '';
        msg('已重置 · 正在重新载入页面…', 'ok');
        setMoreOpen(false);
        refresh();
        global.setTimeout(function () { global.location.reload(); }, 600);
      });
    });

    // ---- 换设备：生成凭证 / 恢复配置（两个 Tab）----
    var passEl = panel.querySelector('#sy-pass');            // 生成口令
    var restorePassEl = panel.querySelector('#sy-restore-pass'); // 恢复口令
    var codeEl = panel.querySelector('#sy-code');
    var ownerEl = panel.querySelector('#sy-owner');
    var makeBtn = panel.querySelector('#sy-pass-make');
    var restoreBtn = panel.querySelector('#sy-pass-restore');
    var seal = panel.querySelector('#sy-vault-seal');
    var sealCode = panel.querySelector('#sy-vault-seal-code');
    var tabMake = panel.querySelector('#sy-vtab-make');
    var tabRestore = panel.querySelector('#sy-vtab-restore');
    var panelMake = panel.querySelector('#sy-vpanel-make');
    var panelRestore = panel.querySelector('#sy-vpanel-restore');

    // 切换场景；新设备（未配置）默认进「恢复配置」，本机已配好默认进「生成凭证」
    function switchVTab(which) {
      var make = which === 'make';
      tabMake.classList.toggle('is-active', make);
      tabRestore.classList.toggle('is-active', !make);
      tabMake.setAttribute('aria-selected', make ? 'true' : 'false');
      tabRestore.setAttribute('aria-selected', make ? 'false' : 'true');
      panelMake.hidden = !make;
      panelRestore.hidden = make;
    }
    tabMake.addEventListener('click', function () { switchVTab('make'); });
    tabRestore.addEventListener('click', function () { switchVTab('restore'); });
    switchVTab(cfg.token && cfg.gistId ? 'make' : 'restore');

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
    }
    showSeal(cfg.vaultCode, cfg.vaultOwner);

    ownerEl.addEventListener('change', function () {
      cfg.vaultOwner = ownerEl.value.trim().replace(/^@/, '');
      saveCfg();
      showSeal(cfg.vaultCode, cfg.vaultOwner);
    });

    makeBtn.addEventListener('click', function () {
      commitConfig(); // 确保 token/gist 已保存
      if (!cfg.token) { switchVTab('make'); msg('请先在第 1 步填入 GitHub Token', 'error'); tokenEl.focus(); return; }
      if (passEl.value.length < 6) { msg('请设置至少 6 位的口令', 'error'); passEl.focus(); return; }
      makeBtn.disabled = true;
      msg('正在生成凭证…');
      sync.makeVault(passEl.value).then(function (r) {
        if (r && r.error) { msg(r.error, 'error'); return; }
        if (r.owner) ownerEl.value = r.owner;
        showSeal(r.code, r.owner);
        passEl.value = '';
        msg('凭证已生成 · 点「复制凭证」保存后即可换设备', 'ok');
      }).catch(function (e) {
        msg(e && e.message || String(e), 'error');
      }).then(function () { makeBtn.disabled = false; });
    });

    restoreBtn.addEventListener('click', function () {
      var code = codeEl.value.trim();
      if (!code) { msg('请填写恢复短码或备用链接', 'error'); codeEl.focus(); return; }
      var pass = restorePassEl.value;
      if (!pass) { msg('请输入生成凭证时设的口令', 'error'); restorePassEl.focus(); return; }
      restoreBtn.disabled = true;
      msg('正在恢复配置…');
      sync.restoreVault(pass, code, ownerEl.value).then(function (r) {
        if (r && r.error) { msg(r.error, 'error'); return; }
        // 回填输入框与凭证卡，让状态与底层配置一致
        tokenEl.value = cfg.token;
        gistEl.value = cfg.gistId;
        restorePassEl.value = '';
        codeEl.value = cfg.vaultCode || '';
        if (cfg.vaultOwner) ownerEl.value = cfg.vaultOwner;
        showSeal(cfg.vaultCode, cfg.vaultOwner);
        refresh();
        msg('配置已恢复 · 正在从云端拉取最新数据…', 'ok');
        // 恢复后立即对账：新设备以云端为准下载
        return sync.reconcile('restore');
      }).then(function (r2) {
        if (r2 && r2.needConfirm && r2.kind === 'local-after-disconnect') {
          showRestoreChoice(r2);
          return;
        }
        if (r2 && r2.error) msg('配置已恢复，但拉取失败：' + r2.error, 'warn');
        else if (r2 && (r2.applied || r2.note === 'in-sync' || r2.count)) {
          msg('配置已恢复 · 云端数据已同步', 'ok');
          refresh();
        }
      }).catch(function (e) {
        msg(e && e.message || String(e), 'error');
      }).then(function () { restoreBtn.disabled = false; });
    });

    choiceUpload.addEventListener('click', function () {
      resolveChoice(choiceKind === 'cloud-truncated' ? 'rebuild' : 'upload');
    });
    choiceDownload.addEventListener('click', function () { resolveChoice('download'); });
    choiceLater.addEventListener('click', function () { resolveChoice('later'); });

    // 复制凭证：一次性复制「用户名 / 短码」，口令自己记
    panel.querySelector('#sy-code-copy').addEventListener('click', function () {
      var who = (cfg.vaultOwner || ownerEl.value || '').trim();
      var code = (cfg.vaultCode || '').replace(/\s/g, '');
      if (!who && !code) { msg('还没有可复制的凭证，请先生成', 'warn'); return; }
      var text = (who ? who + ' / ' : '') + code;
      function done() { msg('凭证已复制 · 口令需自己记牢', 'ok'); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { done(); });
      } else { done(); }
    });

    panel.querySelector('#sy-vault-link-copy').addEventListener('click', function () {
      var text = vaultLink();
      if (!text) { msg('本地还没有备用链接；可先在其它设备恢复一次', 'warn'); return; }
      function done() { msg('备用链接已复制 · 短码失效时可用它恢复', 'ok'); }
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
