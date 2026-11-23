/* ============================================================
   notes/view.js · 纯渲染层（无状态、无请求、无副作用）
   所有笔记文本都经过转义后再拼进 HTML；正文交给 markdown.js。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  var NS = Portal.moduleAssets.notes;
  var MD = NS.markdown;
  var esc = MD.esc;

  function date(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
  }

  function tagList(tags) {
    if (!Array.isArray(tags) || !tags.length) return '';
    return '<div class="nt-tags">' + tags.slice(0, 5).map(function (t) {
      return '<span class="nt-tag mono">#' + esc(t) + '</span>';
    }).join('') + '</div>';
  }

  /** 列表卡片 */
  function card(note, media) {
    var cover = MD.coverOf(note.body, media);
    var excerpt = MD.excerpt(note.body, 108);
    return '' +
      '<article class="nt-card' + (note.pinned ? ' nt-card--pinned' : '') + '" data-id="' + esc(note.id) + '">' +
        (cover
          ? '<div class="nt-card-cover"><img loading="lazy" src="' + cover + '" alt=""></div>'
          : '<div class="nt-card-cover nt-card-cover--ph"><span class="mono">NT / ' + esc(String(note.id).slice(0, 6)) + '</span></div>') +
        (note.pinned ? '<span class="nt-pin-badge mono" title="已置顶"><i class="i-ico i-star-fill" aria-hidden="true"></i>置顶</span>' : '') +
        '<div class="nt-card-body">' +
          '<div class="nt-card-meta mono">' +
            '<span class="nt-cat-pill">' + esc(note.category || '未分类') + '</span>' +
            '<time>' + date(note.updatedAt) + '</time>' +
          '</div>' +
          '<h3 class="nt-card-title" data-act="read" data-id="' + esc(note.id) + '" title="点击阅读">' + esc(note.title || '无标题') + '</h3>' +
          '<p class="nt-card-excerpt">' + esc(excerpt) + '</p>' +
          tagList(note.tags) +
        '</div>' +
        '<div class="nt-card-foot">' +
          '<button class="nt-text-btn" data-act="read" data-id="' + esc(note.id) + '">阅读 →</button>' +
          '<div class="nt-card-actions">' +
            '<button class="nt-icon-btn nt-pin-btn' + (note.pinned ? ' is-pinned' : '') + '" data-act="pin" data-id="' + esc(note.id) + '" title="' + (note.pinned ? '取消置顶' : '置顶') + '" aria-label="' + (note.pinned ? '取消置顶' : '置顶') + '"><i class="i-ico ' + (note.pinned ? 'i-star-fill' : 'i-star') + '" aria-hidden="true"></i></button>' +
            '<button class="nt-icon-btn" data-act="edit" data-id="' + esc(note.id) + '" title="编辑" aria-label="编辑"><i class="i-ico i-edit" aria-hidden="true"></i></button>' +
            '<button class="nt-icon-btn nt-icon-btn--danger" data-act="delete" data-id="' + esc(note.id) + '" title="删除" aria-label="删除"><i class="i-ico i-trash" aria-hidden="true"></i></button>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  /** 空状态 */
  function empty(filtered) {
    return '' +
      '<div class="nt-empty">' +
        '<div class="nt-empty-mark mono">[ ]</div>' +
        '<h3>' + (filtered ? '没有匹配的笔记' : '还没有笔记') + '</h3>' +
        '<p>' + (filtered
          ? '试试换个关键词，或清空筛选条件。'
          : '点击右上角「+ 新建笔记」，写下你的第一篇教程。') + '</p>' +
      '</div>';
  }

  /** 分类筛选条：chip 只负责筛选；增删改统一收敛到「管理目录」浮层 */
  function filters(categories, counts, active, query, editingCat, manageOpen) {
    var row = '<button class="nt-filter' + (active === '__all__' ? ' is-active' : '') +
      '" data-act="filter" data-cat="__all__">全部<span class="mono">' + (counts['__all__'] || 0) + '</span></button>';
    categories.forEach(function (c) {
      var on = active === c;
      row += '<button class="nt-filter' + (on ? ' is-active' : '') + '" data-act="filter" data-cat="' + esc(c) + '">' +
        esc(c) + '<span class="mono">' + (counts[c] || 0) + '</span></button>';
    });
    row += '<button class="nt-filter nt-filter--manage' + (manageOpen ? ' is-open' : '') +
      '" type="button" data-act="manage-toggle" aria-expanded="' + (manageOpen ? 'true' : 'false') +
      '" aria-controls="nt-cat-manager"><i class="i-ico i-settings" aria-hidden="true"></i>管理目录</button>';

    // 集中式目录管理浮层
    var mgr = '<div class="cat-manager" id="nt-cat-manager"' + (manageOpen ? '' : ' hidden') + '>';
    if (manageOpen) {
      mgr += '<div class="cat-manager-head mono">目录管理 <span>重命名 · 删除</span></div><div class="cat-manager-list">';
      categories.forEach(function (c) {
        if (editingCat === c) {
          mgr += '<div class="cat-manager-row cat-manager-row--edit">' +
            '<input class="cat-manager-input" id="nt-rename-input" type="text" maxlength="24" ' +
              'autocomplete="off" value="' + esc(c) + '" aria-label="重命名分类">' +
            '<button class="cat-manager-mini" type="button" data-act="cat-rename-save" data-cat="' + esc(c) + '" title="保存"><i class="i-ico i-check" aria-hidden="true"></i></button>' +
            '<button class="cat-manager-mini" type="button" data-act="cat-rename-cancel" title="取消"><i class="i-ico i-close" aria-hidden="true"></i></button>' +
          '</div>';
        } else {
          mgr += '<div class="cat-manager-row">' +
            '<button class="cat-manager-name" type="button" data-act="filter" data-cat="' + esc(c) + '"><i class="i-ico i-folder" aria-hidden="true"></i>' + esc(c) + '<span class="mono">' + (counts[c] || 0) + '</span></button>' +
            // 默认目录（首个）：可重命名，仅删除按钮替换为「默认」标记
            '<button class="cat-manager-mini" type="button" data-act="cat-rename-start" data-cat="' + esc(c) + '" title="重命名" aria-label="重命名"><i class="i-ico i-edit" aria-hidden="true"></i></button>' +
            (c === categories[0]
              ? '<span class="cat-manager-lock mono" title="默认目录不可删除">默认</span>'
              : '<button class="cat-manager-mini cat-manager-mini--danger" type="button" data-act="cat-delete" data-cat="' + esc(c) + '" title="删除目录，笔记移入默认目录" aria-label="删除目录"><i class="i-ico i-trash" aria-hidden="true"></i></button>') +
          '</div>';
        }
      });
      mgr += '</div><div class="cat-manager-new">' +
        '<input class="cat-manager-input" id="nt-new-cat-input" type="text" maxlength="24" autocomplete="off" placeholder="新分类名称" aria-label="新分类名称">' +
        '<button class="cat-manager-add" type="button" data-act="cat-create"><i class="i-ico i-plus" aria-hidden="true"></i>新建</button>' +
      '</div>';
    }
    mgr += '</div>';

    return '' +
      '<div class="nt-filters">' +
        '<div class="nt-filter-row">' + row + '</div>' +
        mgr +
        '<div class="nt-search-wrap">' +
          '<span class="mono">⌕</span>' +
          '<input class="field nt-search" id="nt-search" type="search" autocomplete="off" ' +
            'placeholder="搜索标题、正文、标签…" value="' + esc(query || '') + '">' +
        '</div>' +
      '</div>';
  }

  /** 列表视图整体 */
  function list(state, notes, counts, media) {
    return '' +
      '<div class="nt">' +
        head(state, notes.length) +
        filters(state.categories, counts, state.category, state.query, state.editingCat, state.manageOpen) +
        '<div class="nt-statusbar mono">' +
          '<span><i class="nt-led"></i> LOCAL STORAGE · 仅保存在当前浏览器</span>' +
          '<span id="nt-count">' + notes.length + ' 篇笔记</span>' +
        '</div>' +
        '<div class="nt-grid">' + (notes.length
          ? notes.map(function (n) { return card(n, media); }).join('')
          : empty(state.query || state.category !== '__all__')) + '</div>' +
      '</div>';
  }

  /** 顶部标题区（列表/阅读共用头部操作） */
  function head(state, count) {
    return '' +
      '<div class="nt-head">' +
        '<div class="nt-head-left">' +
          '<span class="nt-index mono">02 / MODULE</span>' +
          '<h2 class="nt-title">笔记 / 博客 <span class="nt-badge mono">' + (count || 0) + ' NOTES</span></h2>' +
          '<p class="nt-sub">用 Markdown 收藏教程与灵感，支持图文、代码和内嵌视频。</p>' +
        '</div>' +
        '<div class="nt-head-actions">' +
          '<button class="btn btn--primary" data-act="new"><i class="i-ico i-plus" aria-hidden="true"></i> 新建笔记</button>' +
          '<details class="nt-tools-menu">' +
            '<summary class="btn"><i class="i-ico i-more" aria-hidden="true"></i> 更多</summary>' +
            '<div class="nt-tools-panel">' +
              '<button class="nt-menu-item" data-act="export"><i class="i-ico i-download" aria-hidden="true"></i> 导出全部（JSON）</button>' +
              '<button class="nt-menu-item" data-act="import-open"><i class="i-ico i-upload" aria-hidden="true"></i> 导入笔记</button>' +
              '<button class="nt-menu-item nt-menu-item--danger" data-act="reset"><i class="i-ico i-reset" aria-hidden="true"></i> 恢复内置示例</button>' +
              '<p class="nt-menu-note">导入会追加笔记；恢复示例会重置为你首次访问时的内容。</p>' +
            '</div>' +
          '</details>' +
        '</div>' +
      '</div>';
  }

  /** 阅读视图 */
  function reader(note, media) {
    return '' +
      '<div class="nt nt--reader">' +
        '<div class="nt-reader-bar">' +
          '<button class="nt-back mono" data-act="back"><i class="i-ico i-back" aria-hidden="true"></i> 返回列表</button>' +
          '<div class="nt-reader-actions">' +
            '<button class="btn" data-act="edit" data-id="' + esc(note.id) + '"><i class="i-ico i-edit" aria-hidden="true"></i> 编辑</button>' +
            '<button class="btn btn--danger-ghost" data-act="delete" data-id="' + esc(note.id) + '"><i class="i-ico i-trash" aria-hidden="true"></i> 删除</button>' +
          '</div>' +
        '</div>' +
        '<article class="nt-article">' +
          '<div class="nt-article-head">' +
            '<div class="nt-card-meta mono">' +
              '<span class="nt-cat-pill">' + esc(note.category || '未分类') + '</span>' +
              '<time>更新于 ' + date(note.updatedAt) + '</time>' +
            '</div>' +
            '<h1 class="nt-article-title">' + esc(note.title || '无标题') + '</h1>' +
            tagList(note.tags) +
          '</div>' +
          '<div class="nt-markdown">' + MD.render(note.body, media) + '</div>' +
        '</article>' +
      '</div>';
  }

  /** 编辑器：左输入 + 右实时预览（正文保留短引用，媒体单独存储） */
  function editor(note, categories, isNew, media) {
    var tools = [
      { k: 'h2', label: 'H2', tip: '二级标题' },
      { k: 'bold', label: 'B', tip: '粗体' },
      { k: 'italic', label: 'I', tip: '斜体' },
      { k: 'link', label: '链接', tip: '链接' },
      { k: 'image', label: '图片', tip: '插入网络图片地址' },
      { k: 'video', label: '视频', tip: '插入网络视频地址' },
      { k: 'upload', label: '上传', tip: '选择或拖入本地图片（自动压缩）' },
      { k: 'code', label: '代码', tip: '代码块' },
      { k: 'list', label: '列表', tip: '无序列表' },
      { k: 'quote', label: '引用', tip: '引用' }
    ].map(function (t) {
      return '<button type="button" class="nt-tool" data-act="tool" data-tool="' + t.k +
        '" title="' + t.tip + '">' + t.label + '</button>';
    }).join('');

    var catOptions = categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === note.category ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');

    return '' +
      '<div class="nt nt--editor">' +
        '<div class="nt-reader-bar">' +
          '<button class="nt-back mono" data-act="back"><i class="i-ico i-back" aria-hidden="true"></i> 返回列表</button>' +
          '<span class="nt-editor-state mono">' + (isNew ? 'NEW NOTE' : 'EDITING') + '</span>' +
        '</div>' +
        '<div class="nt-editor-form">' +
          '<label class="nt-field nt-field--title">' +
            '<span>标题</span>' +
            '<input class="nt-input" id="nt-title" type="text" maxlength="120" placeholder="给这篇笔记起个名字" value="' + esc(note.title) + '">' +
          '</label>' +
          // 分类字段用 div 而非 label：label 会把内部点击转发给第一个可聚焦控件（触发器按钮），
          // 导致选中选项后菜单被重新展开；样式由 .nt-field > span:first-child 提供，不依赖 label。
          '<div class="nt-form-grid">' +
            '<div class="nt-field">' +
              '<span>分类</span>' +
              '<span class="nt-cat-wrap sel-pill" id="nt-cat-pill">' +
                '<i class="i-ico i-folder sel-lead" aria-hidden="true"></i>' +
                '<button class="sel-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="选择分类">' +
                  '<span class="sel-value"></span>' +
                  '<i class="i-ico i-chev sel-chev" aria-hidden="true"></i>' +
                '</button>' +
                '<select id="nt-category" hidden>' + catOptions +
                  '<option value="__new__">＋ 新建分类…</option>' +
                '</select>' +
                '<ul class="sel-menu" role="listbox" aria-label="分类" hidden></ul>' +
                '<input class="sel-new" id="nt-category-new" type="text" maxlength="24" placeholder="新分类名称" hidden>' +
              '</span>' +
            '</div>' +
            '<label class="nt-field">' +
              '<span>标签 <em>逗号分隔</em></span>' +
              '<input class="nt-input" id="nt-tags" type="text" placeholder="教程, Markdown" value="' + esc((note.tags || []).join(', ')) + '">' +
            '</label>' +
          '</div>' +
          '<div class="nt-editor-cols">' +
            '<section class="nt-edit-pane" id="nt-edit-pane">' +
              '<div class="nt-pane-head mono"><span>MARKDOWN</span>' +
                '<div class="nt-tools">' + tools + '</div>' +
              '</div>' +
              '<textarea class="nt-textarea" id="nt-body" spellcheck="false" placeholder="# 从这里开始写…">' + esc(note.body) + '</textarea>' +
              '<div class="nt-drop-hint" aria-hidden="true">' +
                '<i class="i-ico i-cloud" aria-hidden="true"></i>' +
                '<strong>松开即可插入</strong>' +
                '<span>仅支持图片，自动压缩后随笔记同步</span>' +
              '</div>' +
              '<input id="nt-media-input" class="nt-media-input" type="file" ' +
                'accept="image/*" multiple hidden>' +
            '</section>' +
            '<section class="nt-preview-pane">' +
              '<div class="nt-pane-head mono"><span>预览 / PREVIEW</span></div>' +
              '<div class="nt-markdown nt-preview" id="nt-preview">' + MD.render(note.body, media) + '</div>' +
            '</section>' +
          '</div>' +
          '<div class="nt-editor-foot">' +
            '<span class="nt-hint mono">提示：仅支持图片，拖入或选择后自动压缩（约 260KB/张）；视频请用「视频」工具贴网络地址。正文只留短引用，图片随笔记同步。</span>' +
            '<div class="nt-size" id="nt-size" data-level="ok" role="status" aria-live="polite">' +
              '<span class="nt-size-track"><i class="nt-size-fill" id="nt-size-fill"></i></span>' +
              '<span class="nt-size-text mono" id="nt-size-text">正文 0/950 KB · 图片 0 张 0 KB</span>' +
            '</div>' +
            '<div>' +
              '<button class="btn" data-act="cancel">取消</button> ' +
              '<button class="btn btn--primary" data-act="save">保存笔记</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  NS.view = {
    esc: esc,
    date: date,
    card: card,
    list: list,
    reader: reader,
    editor: editor,
    empty: empty
  };
})(window);
