/* ============================================================
   repo-showcase/index.js · 模块入口
   通过内核注册，只使用 ctx 里给的 root / store / net / bus / config。
   其它模块不需要知道本模块的存在，本模块也不引用其它模块。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var NS = Portal.moduleAssets.repoShowcase;
  var View = NS.view;
  var Github = NS.github;
  var EXAMPLES = ['yt-dlp/yt-dlp', 'qBittorrent/qBittorrent', 'FreeTubeApp/FreeTube'];

  /** 简单并发池：避免一次性打出 2N 个请求触发 GitHub 限流 */
  function pool(tasks, limit) {
    return new Promise(function (resolve) {
      if (!tasks.length) { resolve(); return; }
      var i = 0, active = 0, finished = 0;
      function next() {
        while (active < limit && i < tasks.length) {
          var task = tasks[i++];
          active++;
          Promise.resolve().then(task).catch(function (e) {
            console.error('[repo-showcase] task failed', e);
          }).then(function () {
            active--; finished++;
            if (finished === tasks.length) resolve(); else next();
          });
        }
      }
      next();
    });
  }

  Portal.registry.register({
    id: 'repo-showcase',
    title: '开源应用',
    mount: function (ctx) {
      var store = ctx.store;                              // 本模块私有存储
      var settings = Portal.store.namespace('settings');  // 跨模块共享的可选偏好
      var cacheMs = ctx.config.cacheMs || 1800000;
      var root = ctx.root;
      var esc = View.esc;

      var savedProjects = store.get('projects', null);
      var state = {
        projects: Array.isArray(savedProjects) ? savedProjects : NS.defaults.slice(),
        snapshots: store.get('snapshots', {}) || {},
        items: {},
        token: settings.get('githubToken', '') || '',
        apiBase: settings.get('apiBase', '') || '',
        busyAll: false
      };
      if (savedProjects === null) store.set('projects', state.projects);

      var exampleHtml = EXAMPLES.map(function (n) {
        return '<button type="button" class="chip" data-action="example" data-repo="' + esc(n) +
          '">+ ' + esc(n) + '</button>';
      }).join('');

      root.innerHTML = '' +
        '<div class="rs">' +
          '<div class="rs-head">' +
            '<div class="rs-head-left">' +
              '<span class="rs-index mono">01 / MODULE</span>' +
              '<h2 class="rs-title">开源应用 <span class="rs-badge mono" id="rs-count">0 REPOS</span></h2>' +
              '<p class="rs-sub">粘贴 GitHub 仓库地址，自动获取项目介绍与最新 Release 的下载地址。</p>' +
            '</div>' +
            '<div class="rs-head-actions">' +
              '<button class="btn" data-action="refresh-all" id="rs-refresh-all">↻ 全部刷新</button>' +
              '<details class="rs-settings">' +
                '<summary class="btn">⚙ 设置</summary>' +
                '<div class="rs-settings-panel">' +
                  '<label>GitHub Token <span>可选 · 把限额从 60 次/小时提升到 5000 次</span>' +
                    '<input class="field rs-setting-input" id="rs-token" type="password" autocomplete="off" placeholder="ghp_…" value="' + esc(state.token) + '">' +
                  '</label>' +
                  '<label>API 地址 <span>可选 · 访问不畅时可填镜像地址</span>' +
                    '<input class="field rs-setting-input" id="rs-api" type="text" autocomplete="off" spellcheck="false" placeholder="https://api.github.com" value="' + esc(state.apiBase) + '">' +
                  '</label>' +
                  '<div class="rs-settings-actions">' +
                    '<button class="btn btn--primary" data-action="save-settings">保存设置</button>' +
                    '<button class="btn" data-action="clear-cache">清除缓存</button>' +
                  '</div>' +
                  '<p class="rs-settings-note">设置仅保存在当前浏览器，不会写进仓库。公开站点请勿填写带权限的 Token。</p>' +
                '</div>' +
              '</details>' +
            '</div>' +
          '</div>' +

          '<form class="rs-add" id="rs-form">' +
            '<div class="rs-input-wrap">' +
              '<span class="rs-prompt mono">git@</span>' +
              '<input class="field" id="rs-input" autocomplete="off" spellcheck="false" ' +
                'placeholder="owner/repo 或 https://github.com/owner/repo" aria-label="GitHub 仓库地址">' +
            '</div>' +
            '<button class="btn btn--primary" type="submit">+ 添加项目</button>' +
          '</form>' +

          '<div class="rs-suggest">' +
            '<span class="rs-suggest-label mono">QUICK ADD</span>' + exampleHtml +
            '<span class="rs-hint" id="rs-msg" role="status"></span>' +
          '</div>' +

          '<div class="rs-statusbar mono">' +
            '<span><i class="rs-led"></i> DATA SOURCE · GITHUB REST API · 快照缓存 30 MIN</span>' +
            '<span id="rs-rate">等待同步…</span>' +
          '</div>' +

          '<div class="rs-grid" id="rs-grid"></div>' +
        '</div>';

      var grid = root.querySelector('#rs-grid');
      var form = root.querySelector('#rs-form');
      var input = root.querySelector('#rs-input');
      var msgEl = root.querySelector('#rs-msg');
      var countEl = root.querySelector('#rs-count');
      var rateEl = root.querySelector('#rs-rate');
      var refreshAllBtn = root.querySelector('#rs-refresh-all');
      var animated = Object.create(null);
      var flashTimer = null;

      function flash(text, kind) {
        msgEl.textContent = text;
        msgEl.className = 'rs-hint rs-hint--' + (kind || 'ok');
        global.clearTimeout(flashTimer);
        flashTimer = global.setTimeout(function () {
          msgEl.textContent = '';
          msgEl.className = 'rs-hint';
        }, 4200);
      }

      function friendlyError(err) {
        var msg = err && err.message ? err.message : String(err);
        return /Failed to fetch|NetworkError|Load failed/i.test(msg)
          ? '无法连接 GitHub API（网络不通、被拦截或请求被浏览器拒绝）'
          : msg;
      }

      function render() {
        // 记住已展开的更新日志 + 已经播放过入场动画的卡片
        var openNotes = Object.create(null);
        Array.prototype.forEach.call(grid.querySelectorAll('.rs-notes[open]'), function (el) {
          var card = el.closest('.rs-card');
          if (card) openNotes[card.dataset.repo] = true;
        });

        grid.innerHTML = state.projects.length
          ? state.projects.map(function (fullName, i) {
              return View.card(state.items[fullName] || {
                fullName: fullName,
                status: 'loading',
                data: state.snapshots[fullName] || null
              }, i);
            }).join('')
          : View.empty();

        Array.prototype.forEach.call(grid.querySelectorAll('.rs-card'), function (el) {
          var repo = el.dataset.repo;
          if (animated[repo]) el.style.animation = 'none'; else animated[repo] = true;
          var notes = el.querySelector('.rs-notes');
          if (notes && openNotes[repo]) notes.open = true;
        });
        countEl.textContent = state.projects.length + (state.projects.length === 1 ? ' REPO' : ' REPOS');
      }

      function load(fullName, force) {
        var current = state.items[fullName];
        // 实时缓存 / 静态快照都可以作为请求期间的占位数据
        var snap = state.snapshots[fullName] || (current && current.data) || null;
        var fresh = snap && !snap.offline && (Date.now() - (snap.fetchedAt || 0) < cacheMs);

        if (fresh && !force) {
          state.items[fullName] = { fullName: fullName, status: 'ready', data: snap };
          render();
          return Promise.resolve();
        }

        state.items[fullName] = { fullName: fullName, status: 'loading', data: snap };
        render();

        return Github.fetchSnapshot(fullName, {
          apiBase: state.apiBase || ctx.config.githubApiBase,
          token: state.token,
          cacheMs: cacheMs,
          force: !!force
        }).then(function (data) {
          state.snapshots[fullName] = data;
          store.set('snapshots', state.snapshots);
          state.items[fullName] = { fullName: fullName, status: 'ready', data: data };
        }).catch(function (err) {
          state.items[fullName] = {
            fullName: fullName,
            status: 'error',
            data: snap,
            error: friendlyError(err)
          };
        }).then(render);
      }

      function loadAll(force) {
        return pool(state.projects.map(function (name) {
          return function () { return load(name, force); };
        }), 3);
      }

      function saveProjects() {
        store.set('projects', state.projects);
      }

      function add(raw) {
        var parsed = Github.parseInput(raw);
        if (!parsed.ok) { flash(parsed.error, 'error'); return; }
        var fullName = parsed.fullName;
        if (state.projects.some(function (n) { return n.toLowerCase() === fullName.toLowerCase(); })) {
          flash('这个项目已经在收藏里了', 'warn');
          return;
        }
        state.projects.unshift(fullName);
        saveProjects();
        input.value = '';
        flash('正在获取 ' + fullName + ' …');
        render();
        load(fullName, true);
      }

      function remove(fullName) {
        state.projects = state.projects.filter(function (n) { return n !== fullName; });
        delete state.snapshots[fullName];
        delete state.items[fullName];
        saveProjects();
        store.set('snapshots', state.snapshots);
        render();
        flash('已移除 ' + fullName + '（只影响你自己的浏览器）');
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        add(input.value);
      });

      root.addEventListener('click', function (e) {
        var target = e.target;
        var btn = target && target.closest ? target.closest('[data-action]') : null;
        if (!btn || !root.contains(btn)) return;
        var action = btn.dataset.action;
        var repo = btn.dataset.repo;

        if (action === 'example' && repo) { add(repo); return; }
        if (action === 'refresh' && repo) { load(repo, true); return; }
        if (action === 'remove' && repo) { remove(repo); return; }

        if (action === 'refresh-all') {
          if (state.busyAll || !state.projects.length) return;
          state.busyAll = true;
          refreshAllBtn.disabled = true;
          flash('正在同步 ' + state.projects.length + ' 个项目…');
          loadAll(true).then(function () {
            state.busyAll = false;
            refreshAllBtn.disabled = false;
            flash('同步完成');
          });
          return;
        }

        if (action === 'save-settings') {
          state.token = root.querySelector('#rs-token').value.trim();
          state.apiBase = root.querySelector('#rs-api').value.trim().replace(/\/+$/, '');
          settings.set('githubToken', state.token);
          settings.set('apiBase', state.apiBase);
          flash('设置已保存，正在重新同步…');
          loadAll(true);
          return;
        }

        if (action === 'clear-cache') {
          Portal.net.clearCache();
          store.remove('snapshots');
          state.snapshots = {};
          state.items = {};
          render();
          loadAll(false);
          flash('缓存已清除，正在重新获取');
        }
      });

      Portal.bus.on('net:response', function (info) {
        if (info && info.remaining !== null && info.remaining !== undefined) {
          rateEl.textContent = 'API 剩余额度 ' + info.remaining + ' 次';
        }
      });

      // 首屏策略：仓库自带的静态快照先铺内容，实时 API 随后覆盖。
      // 快照缺失 / 读取超时都不阻塞主流程，最多等 1.5s。
      function bootstrap() {
        var timeout = new Promise(function (resolve) {
          global.setTimeout(function () { resolve(null); }, 1500);
        });
        Promise.race([Github.loadLocalSnapshot(), timeout])
          .then(function (snapshot) {
            if (!snapshot) return;
            state.projects.forEach(function (name) {
              if (state.snapshots[name]) return; // 已有实时缓存，别用旧快照覆盖
              var d = Github.fromSnapshot(snapshot, name);
              if (d) state.items[name] = { fullName: name, status: 'ready', data: d };
            });
            render();
          })
          .catch(function () { /* 快照是可选的 */ })
          .then(function () { loadAll(false); });
      }

      render();
      bootstrap();
    }
  });
})(window);
