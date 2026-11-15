/* ============================================================
   core/net.js · 请求层（GET JSON + 可选 TTL 缓存）
   模块不直接 fetch，统一走这里，方便日后换成镜像 / Actions 生成的静态 JSON。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var cache = Portal.store.namespace('_net');

  function cacheKey(url, token) { return 'get:' + (token ? 'auth:' : '') + url; }

  function friendlyError(res) {
    var msg;
    if (res.status === 404) msg = '仓库不存在或暂无 Release（404）';
    else if (res.status === 403) msg = 'GitHub API 请求额度已用完（403），可稍后再试或配置 Token';
    else if (res.status === 401) msg = 'Token 无效（401）';
    else if (res.status === 422) msg = '仓库地址无效（422）';
    else msg = '请求失败（HTTP ' + res.status + '）';
    var err = new Error(msg);
    err.status = res.status;
    return err;
  }

  Portal.net = {
    /**
     * @param {string} url
     * @param {object}  opts { token, cacheMs, force, headers }
     * @returns {Promise<{data:*, cached:boolean, remaining:(string|null)}>}
     */
    getJSON: function (url, opts) {
      opts = opts || {};
      var ttl = opts.cacheMs || 0;
      var key = cacheKey(url, opts.token);

      if (!opts.force && ttl > 0) {
        var hit = cache.get(key, null);
        if (hit && (Date.now() - hit.at) < ttl) {
          return Promise.resolve({ data: hit.data, cached: true, remaining: null });
        }
      }

      var headers = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
      if (opts.headers) Object.keys(opts.headers).forEach(function (k) { headers[k] = opts.headers[k]; });

      return global.fetch(url, { headers: headers }).then(function (res) {
        if (!res.ok) return Promise.reject(friendlyError(res));
        return res.json().then(function (data) {
          var remaining = res.headers.get('x-ratelimit-remaining');
          if (ttl > 0) cache.set(key, { at: Date.now(), data: data });
          if (Portal.bus) Portal.bus.emit('net:response', { remaining: remaining, url: url });
          return { data: data, cached: false, remaining: remaining };
        });
      });
    },

    /** 清空请求缓存（不影响模块自己的数据） */
    clearCache: function () { cache.clear(); }
  };
})(window);
