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
    var media = normalizeMedia(saved.media);
    var notes = saved.notes.map(normalizeNote).filter(Boolean);
    migrateLegacyMedia(notes, media);
    return {
      notes: notes,
      categories: Array.isArray(saved.categories) ? saved.categories.slice() : [],
      media: media
    };
  };
  /** 冷写入：未挂载时把云端数据落盘，下次进入模块即生效 */
  syncBridge.applyCold = function (data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.notes)) {
      throw new Error('笔记数据格式无效');
    }
    var notes = data.notes.map(normalizeNote).filter(Boolean);
    var media = normalizeMedia(data.media);
    migrateLegacyMedia(notes, media);
    var cats = Array.isArray(data.categories) ? data.categories.slice() : [];
    notes.forEach(function (n) { if (cats.indexOf(n.category) < 0) cats.push(n.category); });
    Portal.store.namespace('notes').set(STORE_KEY, {
      notes: notes, categories: cats, media: media, demo: false
    });
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

  /* ---------- 媒体短引用：正文只写 ![名称](media:ID)，data URI 单独存 ---------- */
  var LEGACY_MEDIA = /!\[([^\]]*)\]\((data:(?:image|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+)\)/gi;
  var MEDIA_REF = /!\[([^\]]*)\]\(media:([A-Za-z0-9_-]{6,24})\)/g;

  function mediaId() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function normalizeMedia(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (id) {
      if (!/^m[A-Za-z0-9]{6,24}$/.test(id)) return;
      var m = raw[id];
      if (!m || typeof m !== 'object') return;
      var data = String(m.d || m.data || '');
      if (!/^data:(?:image\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+);base64,[a-z0-9+/=\s]+$/i.test(data)) return;
      out[id] = {
        t: /^data:video/i.test(data) ? 'v' : 'i',
        n: String(m.n || m.name || '媒体').slice(0, 80),
        d: data
      };
    });
    return out;
  }

  /** 旧版正文里的 data URI 自动搬到媒体字典，正文换成短引用 */
  function migrateLegacyMedia(notes, media) {
    var changed = false;
    (notes || []).forEach(function (n) {
      if (!n || typeof n.body !== 'string' || n.body.indexOf('data:') < 0) return;
      var before = n.body;
      n.body = before.replace(LEGACY_MEDIA, function (all, alt, data) {
        var id = mediaId();
        media[id] = {
          t: /^data:video/i.test(data) ? 'v' : 'i',
          n: String(alt || '媒体').slice(0, 80),
          d: data
        };
        return '![' + alt + '](media:' + id + ')';
      });
      if (n.body !== before) changed = true;
    });
    return changed;
  }

  /** 清理不再被任何笔记引用的媒体，避免删除/取消编辑后残留占空间 */
  function pruneMedia(media, notes) {
    var used = {};
    (notes || []).forEach(function (n) {
      var re = new RegExp(MEDIA_REF.source, 'g'), m;
      while ((m = re.exec(String(n && n.body || '')))) used[m[2]] = 1;
    });
    Object.keys(media).forEach(function (id) { if (!used[id]) delete media[id]; });
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
        media: {},          // 本地媒体字典：短引用 ID → { t, n, d(data URI) }
        draftMedia: [],     // 本次编辑新插入的媒体 ID，取消时回收
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
        state.media = normalizeMedia(saved.media);
        // 旧版本把 data URI 直接写进正文；首次打开时自动迁移成短引用
        if (migrateLegacyMedia(state.notes, state.media)) persist();
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
          notes: state.notes, categories: state.categories,
          media: state.media, demo: state.demo === true
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

      /* ---------- 拖拽 / 选择上传媒体（自动压缩，受 Gist 单文件 1MB 限制约束） ---------- */
      // GitHub Gist API 对单个文件只返回最多 1MB；超限会被截断导致同步数据损坏。
      // 媒体以 data URI（比原始文件大约 1/3）存进同步文件，因此必须留出安全余量。
      var MAX_IMAGE_RAW = 8 * 1024 * 1024;    // 源图放宽到 8MB，上传后自动压到目标体积
      var IMAGE_TARGET = 260 * 1024;          // 每张图片压缩目标（data URI 字符数）
      var MEDIA_TOTAL = 900 * 1024;           // 全部图片 data URI 总量上限（给其它数据留余量）
      var MAX_BODY = 200 * 1024;              // 正文只存短引用，实际远远用不到

      function fileToDataUrl(file) {
        return new Promise(function (resolve, reject) {
          var reader = new global.FileReader();
          reader.onload = function () { resolve(String(reader.result || '')); };
          reader.onerror = function () { reject(new Error('读取文件失败')); };
          reader.readAsDataURL(file);
        });
      }

      /** 迭代压缩：优先降 JPEG 质量，再降尺寸，直到小于目标体积 */
      function compressImage(url, name) {
        return new Promise(function (resolve) {
          var img = new global.Image();
          img.onload = function () {
            try {
              var w = img.width || 1, h = img.height || 1;
              var scale = Math.min(1, 1600 / Math.max(w, h));
              var quality = 0.82;
              function attempt(round) {
                var canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(w * scale));
                canvas.height = Math.max(1, Math.round(h * scale));
                var ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';       // 透明区域转白底，避免 JPEG 发黑
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                var out = canvas.toDataURL('image/jpeg', quality);
                if (out.length <= IMAGE_TARGET || round <= 0) {
                  return resolve({ url: out, name: name, shrunk: out.length < url.length });
                }
                if (quality > 0.5) quality = Math.max(0.5, quality - 0.12);
                else { scale *= 0.78; quality = 0.72; }
                attempt(round - 1);
              }
              attempt(6);
            } catch (e) { resolve({ url: url, name: name, shrunk: false }); }
          };
          img.onerror = function () { resolve({ url: url, name: name, shrunk: false }); };
          img.src = url;
        });
      }

      function prepareMedia(file) {
        var type = String(file.type || '').toLowerCase();
        if (type.indexOf('image/') === 0) {
          if (file.size > MAX_IMAGE_RAW) {
            return Promise.reject(new Error('图片「' + file.name + '」超过 8MB，请先压缩'));
          }
          return fileToDataUrl(file).then(function (url) {
            // 已经在目标体积内的小图、以及需要保留动画/矢量的 GIF/SVG 原样保留
            if (url.length <= IMAGE_TARGET ||
                type === 'image/gif' || type === 'image/svg+xml') {
              return { url: url, name: file.name, shrunk: false };
            }
            return compressImage(url, file.name);
          });
        }
        if (type.indexOf('video/') === 0) {
          return Promise.reject(new Error('不支持上传视频，请用「视频」工具粘贴网络视频地址'));
        }
        return Promise.reject(new Error('只支持图片文件'));
      }

      function mediaTotal() {
        return Object.keys(state.media).reduce(function (sum, id) {
          return sum + String(state.media[id].d || '').length;
        }, 0);
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
        var done = 0, errors = [], compressed = 0;
        var queue = Promise.resolve();
        files.forEach(function (file) {
          queue = queue.then(function () {
            return prepareMedia(file).then(function (media) {
              var name = String(media.name || '媒体').replace(/[\[\]\(\)\n]/g, '_').slice(0, 80);
              var id = mediaId();
              // 正文只插入短引用；data URI 存进媒体字典，不污染编辑器源码
              var snippet = '![' + name + '](media:' + id + ')';
              if (ta.value.length + snippet.length > MAX_BODY) {
                throw new Error('这篇笔记内容过长，无法再插入图片');
              }
              if (mediaTotal() + media.url.length > MEDIA_TOTAL) {
                throw new Error('本地图片总大小已达上限（约 900KB），请删除部分图片，或改用网络图片地址');
              }
              state.media[id] = { t: 'i', n: name, d: media.url };
              insertSnippet(ta, snippet);
              if (state.draftMedia.indexOf(id) < 0) state.draftMedia.push(id);
              touch();      // 上传即视为用户数据，允许参与同步
              persist();    // 立即落盘，刷新/切页不丢媒体
              if (media.shrunk) compressed++;
              done++;
            }).catch(function (e) { errors.push(e && e.message || String(e)); });
          });
        });
        queue.then(function () {
          updatePreview();
          if (done) flash('已插入 ' + done + ' 张图片' +
            (compressed ? '（自动压缩 ' + compressed + ' 张）' : '') +
            (errors.length ? '，' + errors.length + ' 个失败：' + errors[0] : ''));
          else flash(errors[0] || '没有可插入的图片', 'error');
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
          root.innerHTML = note ? View.reader(note, state.media)
            : View.list(state, visibleNotes(), counts(), state.media);
          return;
        }
        if (state.view === 'edit') {
          root.innerHTML = View.editor(state.draft, state.categories, state.isNew, state.media);
          // 自定义下拉：真实值仍在隐藏 select，菜单由 DOM 渲染
          var catPill = root.querySelector('#nt-cat-pill');
          if (catPill && global.PortalSelect) global.PortalSelect.mount(catPill);
          bindMediaUpload();
          return;
        }
        root.innerHTML = View.list(state, visibleNotes(), counts(), state.media);
      }

      function goList() {
        // 取消编辑：回收本次上传但未保存进笔记的媒体
        if (state.draftMedia.length) {
          state.draftMedia.forEach(function (id) { delete state.media[id]; });
          state.draftMedia = [];
          persist();
        }
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
        state.draftMedia = [];
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
        // 草稿里上传但最终没写进正文的媒体要回收；再全局清理无引用的媒体
        state.draftMedia.forEach(function (id) {
          if (note.body.indexOf('media:' + id) < 0) delete state.media[id];
        });
        state.draftMedia = [];
        pruneMedia(state.media, state.notes);
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
        pruneMedia(state.media, state.notes);
        touch();
        persist();
        if (state.currentId === id) goList(); else render();
        flash('笔记已删除');
      }

      // ---------- 导入 / 导出 ----------
      function exportAll() {
        try {
          var data = JSON.stringify({
            app: 'open-shelf/notes', version: 2, exportedAt: new Date().toISOString(),
            notes: state.notes, categories: state.categories, media: state.media
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
        // 导入自带媒体字典；旧版导出文件正文里的 data URI 也自动转成短引用
        var importedMedia = normalizeMedia(data && data.media);
        Object.keys(importedMedia).forEach(function (id) {
          if (!state.media[id]) state.media[id] = importedMedia[id];
        });
        migrateLegacyMedia(incoming, state.media);
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
        pruneMedia(state.media, state.notes);
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
        if (body && preview) preview.innerHTML = MD.render(body.value, state.media);
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
          state.media = {};
          state.draftMedia = [];
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
            grid.innerHTML = notes.length
              ? notes.map(function (n) { return View.card(n, state.media); }).join('')
              : View.empty(true);
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
        return { notes: state.notes, categories: state.categories, media: state.media };
      };
      syncBridge.applyState = function (data) {
        if (!data || typeof data !== 'object') throw new Error('笔记数据格式无效');
        var incoming = Array.isArray(data.notes)
          ? data.notes.map(normalizeNote).filter(Boolean)
          : null;
        if (!incoming) throw new Error('笔记数据缺少 notes 列表');
        state.demo = false; // 云端数据优先于示例
        state.notes = incoming;
        state.media = normalizeMedia(data.media);
        migrateLegacyMedia(state.notes, state.media); // 兼容旧云端数据
        state.draftMedia = [];
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
