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

  // 同步桥：mount() 后用内存态，未挂载（如首页）时用冷数据读写 localStorage。
  // 内核只通过注册表的 sync 字段访问，本模块不引用其它模块。
  var syncBridge = { ready: function () { return false; } };

  /** 冷读取：未挂载时从 localStorage 取笔记；无数据或纯示例返回 null（不参与同步） */
  syncBridge.cold = function () {
    var saved = Portal.store.namespace('notes').get(STORE_KEY, null);
    if (!saved || !Array.isArray(saved.notes)) return null;
    // 内置示例是每个设备各自生成的演示数据，不是用户数据，绝不参与同步
    if (saved.demo === true) return null;
    return {
      notes: saved.notes.map(normalizeNote).filter(Boolean),
      categories: Array.isArray(saved.categories) ? saved.categories.slice() : []
    };
  };
  /** 冷写入：未挂载时把云端数据落盘，下次进入模块即生效 */
  syncBridge.applyCold = function (data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.notes)) {
      throw new Error('笔记数据格式无效');
    }
    var notes = data.notes.map(normalizeNote).filter(Boolean);
    var cats = Array.isArray(data.categories) ? data.categories.slice() : [];
    notes.forEach(function (n) { if (cats.indexOf(n.category) < 0) cats.push(n.category); });
    Portal.store.namespace('notes').set(STORE_KEY, { notes: notes, categories: cats, demo: false });
  };

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
      // demo=true 表示当前展示的是内置示例（用户尚未增删改），这类数据不参与同步。
      // 首次访问（无任何本地数据）时用示例；以后以持久化的 demo 标记为准。
      var isDemo = saved && Array.isArray(saved.notes) ? (saved.demo === true) : null;
      // 无数据或数据损坏（即将重新 seed）→ 示例态；老用户的有效数据无标记 → 用户数据
      if (isDemo === null) isDemo = !saved || !Array.isArray(saved.notes);
      var state = {
        notes: [],
        categories: [],
        demo: isDemo === true,
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
        store.set(STORE_KEY, {
          notes: state.notes, categories: state.categories, demo: state.demo === true
        });
      }
      /** 用户真正增删改后调用：此后数据属于用户，允许参与同步 */
      function touch() { if (state.demo) { state.demo = false; } }

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

      /* ---------- 拖拽 / 选择上传媒体（图片压缩后以 data URI 随笔记同步） ---------- */
      var MAX_IMAGE_RAW = 2 * 1024 * 1024;
      var MAX_VIDEO = 4 * 1024 * 1024;
      var MAX_BODY = 2 * 1024 * 1024;

      function fileToDataUrl(file) {
        return new Promise(function (resolve, reject) {
          var reader = new global.FileReader();
          reader.onload = function () { resolve(String(reader.result || '')); };
          reader.onerror = function () { reject(new Error('读取文件失败')); };
          reader.readAsDataURL(file);
        });
      }

      function prepareMedia(file) {
        var type = String(file.type || '').toLowerCase();
        if (type.indexOf('image/') === 0) {
          if (file.size > MAX_IMAGE_RAW) {
            return Promise.reject(new Error('图片「' + file.name + '」超过 2MB，请先压缩'));
          }
          return fileToDataUrl(file).then(function (url) {
            // GIF / SVG / 小图原样保留；大图压到 1600px、JPEG 0.82，避免撑爆同步体积
            if (type === 'image/gif' || type === 'image/svg+xml' || file.size < 300 * 1024) {
              return { url: url, name: file.name };
            }
            return new Promise(function (resolve) {
              var img = new global.Image();
              img.onload = function () {
                try {
                  var ratio = Math.min(1, 1600 / Math.max(img.width || 1, img.height || 1));
                  var canvas = document.createElement('canvas');
                  canvas.width = Math.max(1, Math.round((img.width || 1) * ratio));
                  canvas.height = Math.max(1, Math.round((img.height || 1) * ratio));
                  var c = canvas.getContext('2d');
                  c.fillStyle = '#ffffff';
                  c.fillRect(0, 0, canvas.width, canvas.height);
                  c.drawImage(img, 0, 0, canvas.width, canvas.height);
                  resolve({ url: canvas.toDataURL('image/jpeg', 0.82), name: file.name });
                } catch (e) { resolve({ url: url, name: file.name }); }
              };
              img.onerror = function () { resolve({ url: url, name: file.name }); };
              img.src = url;
            });
          });
        }
        if (type.indexOf('video/') === 0) {
          if (file.size > MAX_VIDEO) {
            return Promise.reject(new Error('视频「' + file.name + '」超过 4MB，请改用网络地址'));
          }
          return fileToDataUrl(file).then(function (url) { return { url: url, name: file.name }; });
        }
        return Promise.reject(new Error('只支持图片或视频文件'));
      }

      function insertSnippet(ta, snippet) {
        var start = ta.selectionStart, end = ta.selectionEnd;
        var lead = start > 0 && ta.value.charAt(start - 1) !== '\n' ? '\n' : '';
        var tail = '\n';
        ta.value = ta.value.slice(0, start) + lead + snippet + tail + ta.value.slice(end);
        var caret = start + lead.length + snippet.length + tail.length;
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }

      function handleFiles(fileList) {
        var files = Array.prototype.slice.call(fileList || []);
        var ta = root.querySelector('#nt-body');
        if (!files.length || !ta) return;
        var done = 0, errors = [];
        var queue = Promise.resolve();
        files.forEach(function (file) {
          queue = queue.then(function () {
            return prepareMedia(file).then(function (media) {
              var name = String(media.name || '媒体').replace(/[\[\]\(\)\n]/g, '_');
              var snippet = '![' + name + '](' + media.url + ')';
              if (ta.value.length + snippet.length > MAX_BODY) {
                throw new Error('这篇笔记已接近 2MB，无法再插入媒体');
              }
              insertSnippet(ta, snippet);
              done++;
            }).catch(function (e) { errors.push(e && e.message || String(e)); });
          });
        });
        queue.then(function () {
          updatePreview();
          if (done) flash('已插入 ' + done + ' 个媒体文件' +
            (errors.length ? '，' + errors.length + ' 个失败：' + errors[0] : ''));
          else flash(errors[0] || '没有可插入的媒体文件', 'error');
        });
      }

      function bindMediaUpload() {
        var pane = root.querySelector('#nt-edit-pane');
        var picker = root.querySelector('#nt-media-input');
        if (!pane || !picker) return;
        picker.addEventListener('change', function () {
          handleFiles(picker.files);
          picker.value = '';
        });
        ['dragenter', 'dragover'].forEach(function (type) {
          pane.addEventListener(type, function (e) {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            pane.classList.add('is-dragover');
          });
        });
        pane.addEventListener('dragleave', function (e) {
          if (!pane.contains(e.relatedTarget)) pane.classList.remove('is-dragover');
        });
        pane.addEventListener('drop', function (e) {
          e.preventDefault();
          pane.classList.remove('is-dragover');
          handleFiles(e.dataTransfer && e.dataTransfer.files);
        });
      }

      function render() {
        if (state.view === 'read') {
          var note = state.notes.filter(function (n) { return n.id === state.currentId; })[0];
          root.innerHTML = note ? View.reader(note) : View.list(state, visibleNotes(), counts());
          return;
        }
        if (state.view === 'edit') {
          root.innerHTML = View.editor(state.draft, state.categories, state.isNew);
          // 自定义下拉：真实值仍在隐藏 select，菜单由 DOM 渲染
          var catPill = root.querySelector('#nt-cat-pill');
          if (catPill && global.PortalSelect) global.PortalSelect.mount(catPill);
          bindMediaUpload();
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
        touch();
        persist();
        goList();
        flash(state.isNew ? '笔记已创建' : '笔记已保存');
      }

      function remove(id) {
        var note = state.notes.filter(function (n) { return n.id === id; })[0];
        if (!note) return;
        if (!global.confirm('确定删除《' + (note.title || '无标题') + '》？此操作不可撤销。')) return;
        state.notes = state.notes.filter(function (n) { return n.id !== id; });
        touch();
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
        touch();
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
        if (tool === 'upload') {
          var picker = root.querySelector('#nt-media-input');
          if (picker) picker.click();
          return;
        }
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
      // 防止文件被拖到编辑区之外时浏览器直接打开它
      root.addEventListener('dragover', function (e) { e.preventDefault(); });
      root.addEventListener('drop', function (e) { e.preventDefault(); });

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
          state.demo = true; // 又回到纯示例态：不把示例同步到云端
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
          var pill = root.querySelector('#nt-cat-pill');
          if (pill) pill.classList.toggle('is-new', isNew);
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
        // 纯内置示例不上传：每个设备应各自展示自己的示例，而不是把它同步到云端
        if (state.demo) return null;
        return { notes: state.notes, categories: state.categories };
      };
      syncBridge.applyState = function (data) {
        if (!data || typeof data !== 'object') throw new Error('笔记数据格式无效');
        var incoming = Array.isArray(data.notes)
          ? data.notes.map(normalizeNote).filter(Boolean)
          : null;
        if (!incoming) throw new Error('笔记数据缺少 notes 列表');
        state.demo = false; // 云端数据优先于示例
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
