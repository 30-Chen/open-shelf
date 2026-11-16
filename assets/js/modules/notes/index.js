/* ============================================================
   notes/index.js · 笔记模块入口
   通过内核注册，只使用 ctx 提供的 root / store / bus / config。
   不引用其它业务模块，完全自包含。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var NS = Portal.moduleAssets.notes;
  var View = NS.view;
  var MD = NS.markdown;

  var STORE_KEY = 'notes-v1';
  var ALL = '__all__';

  // 同步桥：仅 mount() 完成后 ready，内核通过注册表读写，不引用其它模块。
  var syncBridge = { ready: function () { return false; } };

  function uid() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function blankNote() {
    return { id: uid(), title: '', category: '', tags: [], body: '', updatedAt: Date.now() };
  }

  /** 归一化单条笔记，容忍导入的脏数据 */
  function normalizeNote(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var tags = Array.isArray(raw.tags)
      ? raw.tags.map(function (t) { return String(t).trim().slice(0, 20); }).filter(Boolean)
      : String(raw.tags || '').split(/[,，]/).map(function (t) { return t.trim().slice(0, 20); }).filter(Boolean);
    return {
      id: String(raw.id || uid()),
      title: String(raw.title || '').slice(0, 120),
      category: String(raw.category || '').trim().slice(0, 24) || '未分类',
      tags: tags.slice(0, 8),
      body: String(raw.body || ''),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  Portal.registry.register({
    id: 'notes',
    index: '02',
    title: '笔记 / 博客',
    desc: '用 Markdown 收藏教程与灵感，支持图文、代码和内嵌视频，按分类整理、搜索与导出。',
    path: 'module.html?id=notes',
    sync: syncBridge,
    mount: function (ctx) {
      var store = ctx.store;              // 私有命名空间 portal:v1:notes:*
      var root = ctx.root;
      var esc = View.esc;

      // 数据：首次访问用内置示例，之后完全用本地存储
      var saved = store.get(STORE_KEY, null);
      var state = {
        notes: [],
        categories: [],
        view: 'list',       // list | read | edit
        currentId: null,
        draft: null,
        isNew: false,
        query: '',
        category: ALL,
        flashTimer: null
      };

      function seed() {
        var notes = (NS.defaults || []).map(normalizeNote).filter(Boolean);
        var cats = (NS.defaultCategories || []).slice();
        notes.forEach(function (n) { if (cats.indexOf(n.category) < 0) cats.push(n.category); });
        return { notes: notes, categories: cats };
      }

      if (saved && Array.isArray(saved.notes)) {
        state.notes = saved.notes.map(normalizeNote).filter(Boolean);
        state.categories = Array.isArray(saved.categories)
          ? saved.categories.slice() : [];
      } else {
        var seeded = seed();
        state.notes = seeded.notes;
        state.categories = seeded.categories;
        persist();
      }
      state.notes.forEach(function (n) {
        if (state.categories.indexOf(n.category) < 0) state.categories.push(n.category);
      });

      function persist() {
        store.set(STORE_KEY, { notes: state.notes, categories: state.categories });
      }

      function counts() {
        var c = {};
        state.notes.forEach(function (n) { c[n.category] = (c[n.category] || 0) + 1; });
        c[ALL] = state.notes.length;
        return c;
      }

      function visibleNotes() {
        var q = String(state.query || '').trim().toLowerCase();
        return state.notes.filter(function (n) {
          if (state.category !== ALL && n.category !== state.category) return false;
          if (!q) return true;
          var hay = [n.title, n.category, n.body].join(' ').toLowerCase() + ' ' +
            (n.tags || []).join(' ').toLowerCase();
          return hay.indexOf(q) >= 0;
        }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      }

      function flash(text, kind) {
        var el = root.querySelector('#nt-flash');
        if (!el) {
          el = document.createElement('div');
          el.id = 'nt-flash';
          el.className = 'nt-flash mono';
          root.appendChild(el);
        }
        el.textContent = text;
        el.className = 'nt-flash mono is-show' + (kind ? ' nt-flash--' + kind : '');
        global.clearTimeout(state.flashTimer);
        state.flashTimer = global.setTimeout(function () { el.className = 'nt-flash mono'; }, 3200);
      }

      function render() {
        if (state.view === 'read') {
          var note = state.notes.filter(function (n) { return n.id === state.currentId; })[0];
          root.innerHTML = note ? View.reader(note) : View.list(state, visibleNotes(), counts());
          return;
        }
        if (state.view === 'edit') {
          root.innerHTML = View.editor(state.draft, state.categories, state.isNew);
          return;
        }
        root.innerHTML = View.list(state, visibleNotes(), counts());
      }

      function goList() {
        state.view = 'list';
        state.currentId = null;
        state.draft = null;
        render();
      }

      function openRead(id) {
        if (!state.notes.some(function (n) { return n.id === id; })) return;
        state.view = 'read';
        state.currentId = id;
        render();
        global.scrollTo({ top: 0, behavior: 'auto' });
      }

      function openEdit(id, isNew) {
        var src = isNew ? blankNote()
          : state.notes.filter(function (n) { return n.id === id; })[0];
        if (!src) return;
        state.isNew = !!isNew;
        state.currentId = src.id;
        // 深拷贝，取消编辑不污染原数据
        state.draft = {
          id: src.id, title: src.title, category: src.category,
          tags: (src.tags || []).slice(), body: src.body, updatedAt: src.updatedAt
        };
        state.view = 'edit';
        render();
        global.scrollTo({ top: 0, behavior: 'auto' });
      }

      function collectDraft() {
        var category = root.querySelector('#nt-category').value;
        if (category === '__new__') category = root.querySelector('#nt-category-new').value.trim().slice(0, 24) || '未分类';
        return {
          id: state.currentId,
          title: root.querySelector('#nt-title').value.trim().slice(0, 120),
          category: category,
          tags: root.querySelector('#nt-tags').value.split(/[,，]/).map(function (t) {
            return t.trim().slice(0, 20);
          }).filter(Boolean).slice(0, 8),
          body: root.querySelector('#nt-body').value,
          updatedAt: Date.now()
        };
      }

      function save() {
        var note = collectDraft();
        if (!note.title) { flash('请填写标题', 'error'); root.querySelector('#nt-title').focus(); return; }
        if (state.categories.indexOf(note.category) < 0) state.categories.push(note.category);
        var idx = -1;
        state.notes.forEach(function (n, i) { if (n.id === note.id) idx = i; });
        if (idx >= 0) state.notes[idx] = note; else state.notes.unshift(note);
        persist();
        goList();
        flash(state.isNew ? '笔记已创建' : '笔记已保存');
      }

      function remove(id) {
        var note = state.notes.filter(function (n) { return n.id === id; })[0];
        if (!note) return;
        if (!global.confirm('确定删除《' + (note.title || '无标题') + '》？此操作不可撤销。')) return;
        state.notes = state.notes.filter(function (n) { return n.id !== id; });
        persist();
        if (state.currentId === id) goList(); else render();
        flash('笔记已删除');
      }

      // ---------- 导入 / 导出 ----------
      function exportAll() {
        try {
          var data = JSON.stringify({
            app: 'open-shelf/notes', version: 1, exportedAt: new Date().toISOString(),
            notes: state.notes, categories: state.categories
          }, null, 2);
          var blob = new global.Blob([data], { type: 'application/json' });
          var url = global.URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'notes-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
          flash('已导出 ' + state.notes.length + ' 篇笔记');
        } catch (e) {
          flash('导出失败：' + (e && e.message || e), 'error');
        }
      }

      function importJson(text) {
        var data;
        try { data = JSON.parse(text); }
        catch (e) { flash('文件不是有效的 JSON', 'error'); return; }
        var incoming = Array.isArray(data) ? data : (data && data.notes);
        if (!Array.isArray(incoming)) { flash('文件里没有找到笔记列表', 'error'); return; }
        var added = 0, merged = 0;
        incoming.forEach(function (raw) {
          var n = normalizeNote(raw);
          if (!n || !n.title) return;
          var exists = false;
          state.notes.forEach(function (cur, i) {
            if (!exists && (cur.id === n.id || cur.title === n.title)) {
              state.notes[i] = n; exists = true; merged++;
            }
          });
          if (!exists) { state.notes.push(n); added++; }
          if (state.categories.indexOf(n.category) < 0) state.categories.push(n.category);
        });
        if (Array.isArray(data.categories)) {
          data.categories.forEach(function (c) {
            c = String(c).trim().slice(0, 24);
            if (c && state.categories.indexOf(c) < 0) state.categories.push(c);
          });
        }
        persist();
        goList();
        flash('导入完成：新增 ' + added + ' 篇，更新 ' + merged + ' 篇');
      }

      function openImport() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', function () {
          var file = input.files && input.files[0];
          if (!file) return;
          var reader = new global.FileReader();
          reader.onload = function () { importJson(String(reader.result || '')); };
          reader.onerror = function () { flash('读取文件失败', 'error'); };
          reader.readAsText(file);
        });
        input.click();
      }

      // ---------- 编辑器工具栏 ----------
      function wrapSelection(textarea, before, after, sample) {
        var start = textarea.selectionStart, end = textarea.selectionEnd;
        var selected = textarea.value.slice(start, end);
        var insert = before + (selected || sample || '') + after;
        textarea.value = textarea.value.slice(0, start) + insert + textarea.value.slice(end);
        var caret = start + before.length + (selected || sample || '').length;
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
        updatePreview();
      }

      function applyTool(tool) {
        var ta = root.querySelector('#nt-body');
        if (!ta) return;
        var lineStart, snippet;
        switch (tool) {
          case 'h2': lineStart = true; snippet = '## 小标题'; break;
          case 'bold': return wrapSelection(ta, '**', '**', '粗体文字');
          case 'italic': return wrapSelection(ta, '*', '*', '斜体文字');
          case 'link': return wrapSelection(ta, '[', '](https://example.com)', '链接文字');
          case 'image': return wrapSelection(ta, '![', '](https://example.com/image.png)', '图片说明');
          case 'video': return wrapSelection(ta, '', '', '@video https://www.bilibili.com/video/BVxxxxxxxxxx');
          case 'code': return wrapSelection(ta, '```\n', '\n```', '// 代码');
          case 'list': lineStart = true; snippet = '- 列表项'; break;
          case 'quote': lineStart = true; snippet = '> 引用内容'; break;
          default: return;
        }
        if (lineStart) {
          var pos = ta.selectionStart;
          var before = ta.value.slice(0, pos);
          if (before && before.charAt(before.length - 1) !== '\n') snippet = '\n' + snippet;
          wrapSelection(ta, '', '', snippet);
        }
      }

      function updatePreview() {
        var body = root.querySelector('#nt-body');
        var preview = root.querySelector('#nt-preview');
        if (body && preview) preview.innerHTML = MD.render(body.value);
      }

      // ---------- 事件 ----------
      root.addEventListener('click', function (e) {
        var t = e.target;
        var btn = t && t.closest ? t.closest('[data-act]') : null;
        if (!btn || !root.contains(btn)) return;
        var act = btn.dataset.act;
        var id = btn.dataset.id;

        if (act === 'read') return openRead(id);
        if (act === 'edit') return openEdit(id, false);
        if (act === 'delete') return remove(id);
        if (act === 'new') return openEdit(null, true);
        if (act === 'back') return goList();
        if (act === 'cancel') return goList();
        if (act === 'save') return save();
        if (act === 'export') return exportAll();
        if (act === 'import-open') return openImport();
        if (act === 'tool') return applyTool(btn.dataset.tool);

        if (act === 'filter') {
          state.category = btn.dataset.cat || ALL;
          render();
          return;
        }

        if (act === 'reset') {
          if (!global.confirm('恢复内置示例会替换你现在的所有笔记，确定继续？')) return;
          var seeded = seed();
          state.notes = seeded.notes;
          state.categories = seeded.categories;
          state.category = ALL;
          state.query = '';
          persist();
          goList();
          flash('已恢复内置示例');
          return;
        }
      });

      root.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.id) return;
        if (t.id === 'nt-search') {
          state.query = t.value;
          var grid = root.querySelector('.nt-grid');
          var notes = visibleNotes();
          if (grid) {
            grid.innerHTML = notes.length ? notes.map(View.card).join('') : View.empty(true);
          }
          var cnt = root.querySelector('#nt-count');
          if (cnt) cnt.textContent = notes.length + ' 篇笔记';
          return;
        }
        if (t.id === 'nt-body') updatePreview();
        if (t.id === 'nt-category') {
          var isNew = t.value === '__new__';
          var extra = root.querySelector('#nt-category-new');
          if (extra) {
            extra.hidden = !isNew;
            if (isNew) extra.focus();
          }
        }
      });

      root.addEventListener('keydown', function (e) {
        // Ctrl/Cmd + Enter 快速保存
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && state.view === 'edit') {
          e.preventDefault();
          save();
        }
      });

      // ---------- 同步钩子 ----------
      syncBridge.ready = function () { return true; };
      syncBridge.getState = function () {
        return { notes: state.notes, categories: state.categories };
      };
      syncBridge.applyState = function (data) {
        if (!data || typeof data !== 'object') throw new Error('笔记数据格式无效');
        var incoming = Array.isArray(data.notes)
          ? data.notes.map(normalizeNote).filter(Boolean)
          : null;
        if (!incoming) throw new Error('笔记数据缺少 notes 列表');
        state.notes = incoming;
        var cats = Array.isArray(data.categories) ? data.categories.slice() : [];
        state.notes.forEach(function (n) {
          if (cats.indexOf(n.category) < 0) cats.push(n.category);
        });
        state.categories = cats;
        state.category = ALL;
        state.query = '';
        state.view = 'list';
        state.currentId = null;
        state.draft = null;
        persist();
        render();
      };

      render();
    }
  });
})(window);
