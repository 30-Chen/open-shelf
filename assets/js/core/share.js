/* ============================================================
   core/share.js · 只读分享页控制器
   读取公开 Gist 中的 open-shelf.json → 解析 → 交给 share-view 渲染。
     - 读取顺序：gist.githubusercontent.com 的 raw（无 API 限流）→ 失败回退 api.github.com
     - 无 token、无编辑、无 localStorage 写入；访客无法增删任何内容
     - URL: share.html?id=<gistId>&owner=<login>
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var View = Portal.shareView;
  var MD = Portal.moduleAssets && Portal.moduleAssets.notes && Portal.moduleAssets.notes.markdown;
  var FILE = 'open-shelf.json';

  function query(name) {
    try { return new URLSearchParams(global.location.search).get(name); }
    catch (e) { return null; }
  }

  function setStatus(text, kind) {
    var el = document.getElementById('sh-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'sh-status mono' + (kind ? ' sh-status--' + kind : '');
  }

  function parseGistText(text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('分享文件内容不是有效的 JSON'); }
    if (!data || typeof data !== 'object') throw new Error('分享文件格式无效');
    if (!data.modules || typeof data.modules !== 'object') throw new Error('分享文件里没有模块数据');
    return data.modules;
  }

  function getText(url) {
    return fetch(url, { headers: { 'Accept': 'text/plain' } }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    });
  }

  function loadModules(id, owner) {
    if (!id) return Promise.reject(new Error('缺少分享 ID'));
    var rawBase = 'https://gist.githubusercontent.com/' +
      encodeURIComponent(owner || 'anonymous') + '/' + encodeURIComponent(id) + '/raw';
    var rawUrl = rawBase + '/' + FILE;
    // 优先 raw（CDN，无 API 限流），失败回退 API（公开 Gist 可匿名读取）
    return getText(rawUrl).catch(function () {
      return fetch('https://api.github.com/gists/' + encodeURIComponent(id), {
        headers: { 'Accept': 'application/vnd.github+json' }
      }).then(function (res) {
        if (!res.ok) throw new Error(res.status === 404 ? '找不到该分享（404），链接可能已失效' : ('HTTP ' + res.status));
        return res.json();
      }).then(function (g) {
        var f = g && g.files && g.files[FILE];
        if (!f) throw new Error('分享文件不存在');
        return f.content != null ? f.content : getText(f.raw_url);
      });
    }).then(parseGistText);
  }

  function fmtUpdated(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }
    catch (e) { return ''; }
  }

  function render(modules, meta) {
    var repos = modules['repo-showcase'];
    var notes = modules['notes'];
    var hasRepos = repos && Array.isArray(repos.groups) && repos.groups.some(function (g) {
      return g && Array.isArray(g.repos) && g.repos.length;
    });
    var hasNotes = notes && Array.isArray(notes.notes) && notes.notes.length;

    document.getElementById('sh-repos').innerHTML = View.repos(repos || null);
    document.getElementById('sh-notes').innerHTML = View.notes(notes || null, MD);

    // Tab 可用性：只显示有内容的模块
    var tabRepos = document.querySelector('[data-tab="repos"]');
    var tabNotes = document.querySelector('[data-tab="notes"]');
    tabRepos.hidden = !hasRepos;
    tabNotes.hidden = !hasNotes;

    var first = hasRepos ? 'repos' : (hasNotes ? 'notes' : null);
    if (first) switchTab(first);
    else {
      document.getElementById('sh-repos').hidden = false;
      document.getElementById('sh-notes').hidden = true;
    }

    var countEl = document.getElementById('sh-count');
    if (countEl) {
      var rp = (repos && repos.groups || []).reduce(function (n, g) { return n + ((g.repos || []).length); }, 0);
      countEl.textContent = (rp ? rp + ' 项目' : '') + (rp && hasNotes ? ' · ' : '') + (hasNotes ? (notes.notes.length + ' 笔记') : '');
    }
    var updEl = document.getElementById('sh-updated');
    if (updEl && meta && meta.updatedAt) updEl.textContent = '更新于 ' + fmtUpdated(meta.updatedAt);

    document.getElementById('sh-loading').hidden = true;
    document.getElementById('sh-content').hidden = false;
  }

  function switchTab(name) {
    ['repos', 'notes'].forEach(function (n) {
      var on = n === name;
      var btn = document.querySelector('[data-tab="' + n + '"]');
      var pane = document.getElementById('sh-' + n);
      if (btn) {
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (pane) pane.hidden = !on;
    });
    closeReader();
    global.scrollTo && global.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openReader(id) {
    var list = document.getElementById('sh-note-list');
    var readers = document.getElementById('sh-note-readers');
    if (!list || !readers) return;
    list.hidden = true;
    Array.prototype.forEach.call(readers.querySelectorAll('.nt-article'), function (a) {
      a.hidden = a.getAttribute('data-reader') !== id;
    });
    readers.scrollIntoView && readers.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeReader() {
    var list = document.getElementById('sh-note-list');
    var readers = document.getElementById('sh-note-readers');
    if (list) list.hidden = false;
    if (readers) Array.prototype.forEach.call(readers.querySelectorAll('.nt-article'), function (a) { a.hidden = true; });
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var tab = t.closest('[data-tab]');
      if (tab) { switchTab(tab.getAttribute('data-tab')); return; }
      if (t.closest('[data-back]')) { closeReader(); return; }
      var read = t.closest('[data-read]');
      if (read) { openReader(read.getAttribute('data-read')); return; }
    });
  }

  function boot() {
    bind();
    var id = query('id');
    var owner = query('owner') || '';
    if (!id) {
      setStatus('缺少分享 ID：请使用发布者提供的完整链接', 'error');
      document.getElementById('sh-loading').hidden = true;
      return;
    }
    setStatus('正在读取公开分享…');
    loadModules(id, owner).then(function (modules) {
      setStatus('', '');
      render(modules, { updatedAt: null });
    }).catch(function (err) {
      var msg = err && err.message || String(err);
      setStatus('无法加载分享：' + msg, 'error');
      document.getElementById('sh-loading').hidden = true;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})(window);
