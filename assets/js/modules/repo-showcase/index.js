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
  var DEFAULT_GROUP = '默认';

  // 同步桥：mount() 后用内存态，未挂载（如首页）时用冷数据读写 localStorage。
  // 内核只通过注册表的 sync 字段访问，本模块不引用其它模块。
  var syncBridge = { ready: function () { return false; } };

  /** 归一化为同步可用的分组结构（热/冷路径共用） */
  function sanitizeGroups(data) {
    var incoming = Array.isArray(data && data.groups)
      ? data.groups.map(function (g) {
          return {
            name: String((g && g.name) || DEFAULT_GROUP).trim().slice(0, 24) || DEFAULT_GROUP,
            repos: Array.isArray(g && g.repos)
              ? g.repos.map(function (r) { return String(r).trim(); }).filter(Boolean)
              : []
          };
        })
      : [];
    var def = incoming.filter(function (g) { return g.name === DEFAULT_GROUP; })[0];
    if (!def) incoming.unshift({ name: DEFAULT_GROUP, repos: [] });
    else if (incoming[0].name !== DEFAULT_GROUP) {
      incoming = [incoming.splice(incoming.indexOf(def), 1)[0]].concat(incoming);
    }
    return incoming;
  }

  /** 冷读取：未挂载时从 localStorage 取用户数据；无数据或纯示例返回 null（不参与同步） */
  syncBridge.cold = function () {
    var ns = Portal.store.namespace('repo-showcase');
    var groups = ns.get('groups', null);
    if (!Array.isArray(groups)) return null;
    // 内置示例是每个设备各自生成的演示数据，不是用户数据，绝不参与同步
    if (ns.get('demo', false) === true) return null;
    return { groups: sanitizeGroups({ groups: groups }), snapshots: ns.get('snapshots', {}) || {} };
  };
  /** 冷写入：未挂载时把云端数据落盘，下次进入模块即生效 */
  syncBridge.applyCold = function (data) {
    if (!data || typeof data !== 'object') throw new Error('仓库数据格式无效');
    var ns = Portal.store.namespace('repo-showcase');
    ns.set('groups', sanitizeGroups(data));
    ns.set('snapshots', (data.snapshots && typeof data.snapshots === 'object') ? data.snapshots : {});
    ns.set('demo', false); // 云端数据已覆盖示例
  };

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

  /** 归一化分组数据：兼容旧的扁平 projects 数组，并保证一定有默认目录 */
  function normalizeGroups(raw, legacyProjects) {
    var result = [];
    function add(name, repos) {
      var key = String(name || '').trim().slice(0, 24) || DEFAULT_GROUP;
      var hit = result.filter(function (g) { return g.name === key; })[0];
      if (!hit) { hit = { name: key, repos: [] }; result.push(hit); }
      (repos || []).forEach(function (r) {
        if (hit.repos.indexOf(r) < 0) hit.repos.push(r);
      });
    }
    if (Array.isArray(raw)) {
      raw.forEach(function (g) {
        if (g && Array.isArray(g.repos)) add(g.name, g.repos);
      });
    } else if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (k) { add(k, raw[k]); });
    }
    // 首次访问：没有分组也没有旧数据 → 用模块自带的默认清单填充默认目录
    if (!result.length) {
      var initial = Array.isArray(legacyProjects) && legacyProjects.length
        ? legacyProjects : NS.defaults;
      add(DEFAULT_GROUP, initial);
    }
    if (result[0].name !== DEFAULT_GROUP) {
      result.unshift({ name: DEFAULT_GROUP, repos: [] });
    }
    return result;
  }

  function allRepos(groups) {
    var out = [];
    groups.forEach(function (g) {
      g.repos.forEach(function (r) { if (out.indexOf(r) < 0) out.push(r); });
    });
    return out;
  }

  Portal.registry.register({
    id: 'repo-showcase',
    index: '01',
    title: '开源应用',
    desc: '粘贴 GitHub 仓库地址，按分类目录整理，自动展示项目介绍与最新 Release 的下载地址。',
    path: 'module.html?id=repo-showcase',
    sync: syncBridge,
    mount: function (ctx) {
      var store = ctx.store;                              // 本模块私有存储
      var settings = Portal.store.namespace('settings');  // 跨模块共享的可选偏好
      var cacheMs = ctx.config.cacheMs || 1800000;
      var root = ctx.root;
      var esc = View.esc;

      // 迁移：旧版本用 projects 数组，新版本用 groups:[{name,repos}]
      var legacy = store.get('projects', null);
      var rawGroups = store.get('groups', null);
      // demo=true 表示当前展示的是内置示例（用户尚未增删改），这类数据不参与同步。
      // 首次访问（无任何本地数据）时用示例；以后以持久化的 demo 标记为准。
      var isDemo = store.get('demo', null);
      if (isDemo === null) isDemo = (rawGroups === null && legacy === null);
      var state = {
        groups: normalizeGroups(rawGroups, legacy),
        snapshots: store.get('snapshots', {}) || {},
        items: {},
        ui: {},                  // 每张卡的平台筛选选择，纯本地视图状态
        activeGroup: '__all__',  // 分类筛选：__all__ 表示全部目录
        demo: isDemo === true,
        token: settings.get('githubToken', '') || '',
        apiBase: settings.get('apiBase', '') || '',
        busyAll: false
      };
      if (rawGroups === null || legacy !== null) saveGroups();

      root.innerHTML = '' +
        '<div class="rs">' +
          '<div class="rs-head">' +
            '<div class="rs-head-left">' +
              '<span class="rs-index mono">01 / MODULE</span>' +
              '<h2 class="rs-title">开源应用 <span class="rs-badge mono" id="rs-count">0 REPOS</span></h2>' +
              '<p class="rs-sub">粘贴 GitHub 仓库地址，选择或新建分类目录，自动获取项目介绍与最新 Release 下载地址。</p>' +
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
            '<div class="rs-cat-wrap sel-pill" id="rs-cat-pill">' +
              '<i class="i-ico i-folder sel-lead" aria-hidden="true"></i>' +
              '<button class="sel-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="选择分类目录">' +
                '<span class="sel-value"></span>' +
                '<i class="i-ico i-chev sel-chev" aria-hidden="true"></i>' +
              '</button>' +
              '<select id="rs-group-select" aria-label="选择分类目录" hidden></select>' +
              '<ul class="sel-menu" role="listbox" aria-label="分类目录" hidden></ul>' +
              '<input class="sel-new" id="rs-group-new" type="text" maxlength="24" autocomplete="off" ' +
                'placeholder="新目录名称" aria-label="新分类目录名称" hidden>' +
            '</div>' +
            '<button class="btn btn--primary" type="submit">+ 添加项目</button>' +
          '</form>' +

          // 分类筛选条：与模块 02 的 .nt-filters 同一套视觉语言，目录入口常驻可见
          '<div class="rs-filters">' +
            '<div class="rs-filter-row" id="rs-filter-row"></div>' +
            '<div class="rs-new-group" id="rs-new-group" hidden>' +
              '<input class="field" id="rs-new-group-input" type="text" maxlength="24" ' +
                'autocomplete="off" placeholder="新目录名称" aria-label="新目录名称">' +
              '<button class="btn btn--primary" type="button" data-action="create-group">创建</button>' +
              '<button class="btn" type="button" data-action="cancel-new-group">取消</button>' +
            '</div>' +
          '</div>' +

          '<div class="rs-suggest">' +
            '<span class="rs-hint" id="rs-msg" role="status"></span>' +
          '</div>' +

          '<div class="rs-statusbar mono">' +
            '<span><i class="rs-led"></i> DATA SOURCE · GITHUB REST API · 快照缓存 30 MIN</span>' +
            '<span id="rs-rate">等待同步…</span>' +
          '</div>' +

          '<div id="rs-groups" class="rs-groups"></div>' +
        '</div>';

      var groupsEl = root.querySelector('#rs-groups');
      var form = root.querySelector('#rs-form');
      var input = root.querySelector('#rs-input');
      var groupSelect = root.querySelector('#rs-group-select');
      var groupNew = root.querySelector('#rs-group-new');
      var catPill = root.querySelector('#rs-cat-pill');
      var filterRow = root.querySelector('#rs-filter-row');
      var newGroupBox = root.querySelector('#rs-new-group');
      var newGroupInput = root.querySelector('#rs-new-group-input');
      // 自定义下拉：真实值仍在隐藏 select 中，菜单由 DOM 渲染，主题/跨平台一致
      var catSelect = global.PortalSelect ? global.PortalSelect.mount(catPill) : null;
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

      function saveGroups() {
        store.set('groups', state.groups);
        store.set('demo', state.demo);
      }
      /** 用户真正增删改后调用：此后数据属于用户，允许参与同步 */
      function touch() {
        if (state.demo) { state.demo = false; }
      }

      function renderGroupOptions(keep) {
        var chosen = keep || groupSelect.value || DEFAULT_GROUP;
        var options = state.groups.map(function (g) {
          return '<option value="' + esc(g.name) + '"' + (g.name === chosen ? ' selected' : '') + '>' +
            esc(g.name) + ' (' + g.repos.length + ')</option>';
        }).join('');
        groupSelect.innerHTML = options +
          '<option value="__new__"' + (chosen === '__new__' ? ' selected' : '') + '>＋ 新建目录…</option>';
        if (catSelect) catSelect.rebuild();
        toggleNewInput();
      }

      function toggleNewInput() {
        var isNew = groupSelect.value === '__new__';
        groupNew.hidden = !isNew;
        if (catPill) catPill.classList.toggle('is-new', isNew);
        if (isNew) groupNew.focus();
      }

      function resolveTargetGroup() {
        if (groupSelect.value !== '__new__') return groupSelect.value || DEFAULT_GROUP;
        var name = String(groupNew.value || '').trim().slice(0, 24) || '';
        if (!name) { flash('请输入新目录名称', 'error'); return null; }
        if (name === '__new__') { flash('目录名称不可用', 'error'); return null; }
        return name;
      }

      /** 分类筛选条：全部 / 各目录（含空目录）/ 常驻新建入口 */
      function renderFilterRow() {
        if (!filterRow) return;
        var total = allRepos(state.groups).length;
        function item(key, label, count) {
          var on = state.activeGroup === key;
          return '<button class="rs-filter' + (on ? ' is-active' : '') + '" type="button" ' +
            'data-action="filter-group" data-group="' + esc(key) + '">' +
            esc(label) + '<span class="mono">' + count + '</span></button>';
        }
        filterRow.innerHTML = item('__all__', '全部', total) +
          state.groups.map(function (g) { return item(g.name, g.name, g.repos.length); }).join('') +
          '<button class="rs-filter rs-filter--new" type="button" data-action="new-group">＋ 新建目录</button>';
      }
      function setNewGroupOpen(open) {
        if (!newGroupBox) return;
        newGroupBox.hidden = !open;
        if (open && newGroupInput) newGroupInput.focus();
        if (!open && newGroupInput) newGroupInput.value = '';
      }

      function render() {
        // 记住已展开的更新日志 + 已经播放过入场动画的卡片
        var openNotes = Object.create(null);
        Array.prototype.forEach.call(groupsEl.querySelectorAll('.rs-notes[open]'), function (el) {
          var cardEl = el.closest('.rs-card');
          if (cardEl) openNotes[cardEl.dataset.repo] = true;
        });

        var html = '';
        var index = 0;
        state.groups.forEach(function (g) {
          // 筛选条：只显示当前目录；「全部」时跳过空目录，单独选中空目录时给出空态
          if (state.activeGroup !== '__all__' && g.name !== state.activeGroup) return;
          if (!g.repos.length) return;
          var cards = g.repos.map(function (fullName) {
            var item = state.items[fullName] || {
              fullName: fullName,
              status: 'loading',
              data: state.snapshots[fullName] || null
            };
            return View.card(item, index++, state.ui[fullName] || {});
          }).join('');
          html += '<section class="rs-group" data-group="' + esc(g.name) + '">' +
            View.groupHead(g.name, g.repos.length, g.name === DEFAULT_GROUP) +
            '<div class="rs-grid">' + cards + '</div>' +
          '</section>';
        });

        groupsEl.innerHTML = html || View.empty();

        Array.prototype.forEach.call(groupsEl.querySelectorAll('.rs-card'), function (el) {
          var repo = el.dataset.repo;
          if (animated[repo]) el.style.animation = 'none'; else animated[repo] = true;
          var notes = el.querySelector('.rs-notes');
          if (notes && openNotes[repo]) notes.open = true;
        });

        var total = allRepos(state.groups).length;
        countEl.textContent = total + (total === 1 ? ' REPO' : ' REPOS');
        renderGroupOptions(groupSelect.value);
        renderFilterRow();
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
        return pool(allRepos(state.groups).map(function (name) {
          return function () { return load(name, force); };
        }), 3);
      }

      function add(raw) {
        var parsed = Github.parseInput(raw);
        if (!parsed.ok) { flash(parsed.error, 'error'); return; }
        var fullName = parsed.fullName;
        var all = allRepos(state.groups);
        if (all.some(function (n) { return n.toLowerCase() === fullName.toLowerCase(); })) {
          flash('这个项目已经在收藏里了', 'warn');
          return;
        }
        var groupName = resolveTargetGroup();
        if (!groupName) return;

        var group = state.groups.filter(function (g) { return g.name === groupName; })[0];
        if (!group) { group = { name: groupName, repos: [] }; state.groups.push(group); }
        group.repos.unshift(fullName);
        touch();
        saveGroups();
        input.value = '';
        state.activeGroup = groupName; // 新增后自动切到该目录，立刻能看到结果
        if (groupSelect.value === '__new__') {
          groupSelect.value = groupName;
          groupNew.value = '';
          toggleNewInput();
        }
        flash('已添加到「' + groupName + '」，正在获取 ' + fullName + ' …');
        render();
        load(fullName, true);
      }

      function remove(fullName) {
        state.groups.forEach(function (g) {
          g.repos = g.repos.filter(function (n) { return n !== fullName; });
        });
        delete state.snapshots[fullName];
        delete state.items[fullName];
        touch();
        saveGroups();
        store.set('snapshots', state.snapshots);
        render();
        flash('已移除 ' + fullName + '（只影响你自己的浏览器）');
      }

      function deleteGroup(name) {
        if (!name || name === DEFAULT_GROUP) return;
        var group = state.groups.filter(function (g) { return g.name === name; })[0];
        if (!group) return;
        var fallback = state.groups.filter(function (g) { return g.name === DEFAULT_GROUP; })[0];
        if (!fallback) { fallback = { name: DEFAULT_GROUP, repos: [] }; state.groups.unshift(fallback); }
        group.repos.forEach(function (r) { if (fallback.repos.indexOf(r) < 0) fallback.repos.push(r); });
        state.groups = state.groups.filter(function (g) { return g.name !== name; });
        if (state.activeGroup === name) state.activeGroup = DEFAULT_GROUP;
        touch();
        saveGroups();
        render();
        flash('目录「' + name + '」已删除，项目已移入默认目录');
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        add(input.value);
      });

      groupSelect.addEventListener('change', toggleNewInput);
      if (newGroupInput) newGroupInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var create = root.querySelector('[data-action="create-group"]');
          if (create) create.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setNewGroupOpen(false);
        }
      });

      root.addEventListener('click', function (e) {
        var target = e.target;
        var btn = target && target.closest ? target.closest('[data-action]') : null;
        if (!btn || !root.contains(btn)) return;
        var action = btn.dataset.action;
        var repo = btn.dataset.repo;

        if (action === 'refresh' && repo) { load(repo, true); return; }
        if (action === 'remove' && repo) { remove(repo); return; }
        if (action === 'delete-group') { deleteGroup(btn.dataset.group); return; }

        if (action === 'filter-group') {
          state.activeGroup = btn.dataset.group || '__all__';
          render();
          return;
        }
        if (action === 'new-group') { setNewGroupOpen(true); return; }
        if (action === 'cancel-new-group') { setNewGroupOpen(false); return; }
        if (action === 'create-group') {
          var name = String(newGroupInput ? newGroupInput.value : '').trim().slice(0, 24);
          if (!name) { flash('请输入新目录名称', 'error'); newGroupInput.focus(); return; }
          if (name === '__new__') { flash('目录名称不可用', 'error'); return; }
          if (state.groups.some(function (g) { return g.name === name; })) {
            flash('目录「' + name + '」已存在', 'warn');
            state.activeGroup = name;
            groupSelect.value = name;
            setNewGroupOpen(false);
            render();
            return;
          }
          state.groups.push({ name: name, repos: [] });
          state.activeGroup = name;
          touch();
          saveGroups();
          setNewGroupOpen(false);
          // 先把新目录写进下拉选项，再渲染；否则此时 select 还没有该 option，
          // 直接赋值会失败，下拉又退回「默认」。
          renderGroupOptions(name);
          flash('目录「' + name + '」已创建，接下来添加的项目会放进这里');
          render();
          return;
        }

        if (action === 'platform' && repo) {
          var ui = state.ui[repo] || (state.ui[repo] = {});
          ui.platform = btn.dataset.platform || 'auto';
          render();
          return;
        }

        if (action === 'refresh-all') {
          var total = allRepos(state.groups).length;
          if (state.busyAll || !total) return;
          state.busyAll = true;
          refreshAllBtn.disabled = true;
          flash('正在同步 ' + total + ' 个项目…');
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
            allRepos(state.groups).forEach(function (name) {
              if (state.snapshots[name]) return; // 已有实时缓存，别用旧快照覆盖
              var d = Github.fromSnapshot(snapshot, name);
              if (d) state.items[name] = { fullName: name, status: 'ready', data: d };
            });
            render();
          })
          .catch(function () { /* 快照是可选的 */ })
          .then(function () { loadAll(false); });
      }

      // ---------- 同步钩子 ----------
      // 只暴露用户数据（分类 + 项目清单 + 快照），不暴露 token 等本地偏好。
      syncBridge.ready = function () { return true; };
      syncBridge.getState = function () {
        // 纯内置示例不上传：每个设备应各自展示自己的示例，而不是把它同步到云端
        if (state.demo) return null;
        return { groups: state.groups, snapshots: state.snapshots };
      };
      syncBridge.applyState = function (data) {
        if (!data || typeof data !== 'object') throw new Error('仓库数据格式无效');
        state.demo = false; // 云端数据优先于示例
        state.groups = sanitizeGroups(data);
        if (state.activeGroup !== '__all__' &&
            !state.groups.some(function (g) { return g.name === state.activeGroup; })) {
          state.activeGroup = '__all__';
        }
        state.snapshots = (data.snapshots && typeof data.snapshots === 'object') ? data.snapshots : {};
        state.items = {};
        saveGroups();
        store.set('snapshots', state.snapshots);
        render();
        loadAll(false);
      };

      render();
      bootstrap();
    }
  });
})(window);
