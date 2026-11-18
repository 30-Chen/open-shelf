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
  function card(note) {
    var cover = MD.coverOf(note.body);
    var excerpt = MD.excerpt(note.body, 108);
    return '' +
      '<article class="nt-card" data-id="' + esc(note.id) + '">' +
        (cover
          ? '<div class="nt-card-cover"><img loading="lazy" src="' + cover + '" alt=""></div>'
          : '<div class="nt-card-cover nt-card-cover--ph"><span class="mono">NT / ' + esc(String(note.id).slice(0, 6)) + '</span></div>') +
        '<div class="nt-card-body">' +
          '<div class="nt-card-meta mono">' +
            '<span class="nt-cat-pill">' + esc(note.category || '未分类') + '</span>' +
            '<time>' + date(note.updatedAt) + '</time>' +
          '</div>' +
          '<h3 class="nt-card-title">' + esc(note.title || '无标题') + '</h3>' +
          '<p class="nt-card-excerpt">' + esc(excerpt) + '</p>' +
          tagList(note.tags) +
        '</div>' +
        '<div class="nt-card-foot">' +
          '<button class="nt-text-btn" data-act="read" data-id="' + esc(note.id) + '">阅读 →</button>' +
          '<div class="nt-card-actions">' +
            '<button class="nt-icon-btn" data-act="edit" data-id="' + esc(note.id) + '" title="编辑" aria-label="编辑">✎</button>' +
            '<button class="nt-icon-btn nt-icon-btn--danger" data-act="delete" data-id="' + esc(note.id) + '" title="删除" aria-label="删除">×</button>' +
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

  /** 分类筛选条 */
  function filters(categories, counts, active, query) {
    function item(name, label) {
      var on = name === active;
      return '<button class="nt-filter' + (on ? ' is-active' : '') + '" data-act="filter" data-cat="' + esc(name) + '">' +
        esc(label) + '<span class="mono">' + (counts[name] || 0) + '</span></button>';
    }
    return '' +
      '<div class="nt-filters">' +
        '<div class="nt-filter-row">' + item('__all__', '全部') +
          categories.map(function (c) { return item(c, c); }).join('') +
        '</div>' +
        '<div class="nt-search-wrap">' +
          '<span class="mono">⌕</span>' +
          '<input class="field nt-search" id="nt-search" type="search" autocomplete="off" ' +
            'placeholder="搜索标题、正文、标签…" value="' + esc(query || '') + '">' +
        '</div>' +
      '</div>';
  }

  /** 列表视图整体 */
  function list(state, notes, counts) {
    return '' +
      '<div class="nt">' +
        head(state, notes.length) +
        filters(state.categories, counts, state.category, state.query) +
        '<div class="nt-statusbar mono">' +
          '<span><i class="nt-led"></i> LOCAL STORAGE · 仅保存在当前浏览器</span>' +
          '<span id="nt-count">' + notes.length + ' 篇笔记</span>' +
        '</div>' +
        '<div class="nt-grid">' + (notes.length ? notes.map(card).join('') : empty(state.query || state.category !== '__all__')) + '</div>' +
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
          '<button class="btn btn--primary" data-act="new">+ 新建笔记</button>' +
          '<details class="nt-tools-menu">' +
            '<summary class="btn">⋯ 更多</summary>' +
            '<div class="nt-tools-panel">' +
              '<button class="nt-menu-item" data-act="export">↓ 导出全部（JSON）</button>' +
              '<button class="nt-menu-item" data-act="import-open">↑ 导入笔记</button>' +
              '<button class="nt-menu-item nt-menu-item--danger" data-act="reset">↺ 恢复内置示例</button>' +
              '<p class="nt-menu-note">导入会追加笔记；恢复示例会重置为你首次访问时的内容。</p>' +
            '</div>' +
          '</details>' +
        '</div>' +
      '</div>';
  }

  /** 阅读视图 */
  function reader(note) {
    return '' +
      '<div class="nt nt--reader">' +
        '<div class="nt-reader-bar">' +
          '<button class="nt-back mono" data-act="back"><i class="i-ico i-back" aria-hidden="true"></i> 返回列表</button>' +
          '<div class="nt-reader-actions">' +
            '<button class="btn" data-act="edit" data-id="' + esc(note.id) + '">✎ 编辑</button>' +
            '<button class="btn btn--danger-ghost" data-act="delete" data-id="' + esc(note.id) + '">删除</button>' +
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
          '<div class="nt-markdown">' + MD.render(note.body) + '</div>' +
        '</article>' +
      '</div>';
  }

  /** 编辑器：左输入 + 右实时预览 */
  function editor(note, categories, isNew) {
    var tools = [
      { k: 'h2', label: 'H2', tip: '二级标题' },
      { k: 'bold', label: 'B', tip: '粗体' },
      { k: 'italic', label: 'I', tip: '斜体' },
      { k: 'link', label: '链接', tip: '链接' },
      { k: 'image', label: '图片', tip: '图片' },
      { k: 'video', label: '视频', tip: '视频 @video' },
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
          '<div class="nt-form-grid">' +
            '<label class="nt-field">' +
              '<span>分类</span>' +
              '<span class="nt-cat-wrap">' +
                '<select class="nt-input nt-select" id="nt-category">' + catOptions +
                  '<option value="__new__">＋ 新建分类…</option>' +
                '</select>' +
                '<input class="nt-input nt-cat-new" id="nt-category-new" type="text" maxlength="24" placeholder="输入新分类名称" hidden>' +
              '</span>' +
            '</label>' +
            '<label class="nt-field">' +
              '<span>标签 <em>逗号分隔</em></span>' +
              '<input class="nt-input" id="nt-tags" type="text" placeholder="教程, Markdown" value="' + esc((note.tags || []).join(', ')) + '">' +
            '</label>' +
          '</div>' +
          '<div class="nt-editor-cols">' +
            '<section class="nt-edit-pane">' +
              '<div class="nt-pane-head mono"><span>MARKDOWN</span>' +
                '<div class="nt-tools">' + tools + '</div>' +
              '</div>' +
              '<textarea class="nt-textarea" id="nt-body" spellcheck="false" placeholder="# 从这里开始写…">' + esc(note.body) + '</textarea>' +
            '</section>' +
            '<section class="nt-preview-pane">' +
              '<div class="nt-pane-head mono"><span>预览 / PREVIEW</span></div>' +
              '<div class="nt-markdown nt-preview" id="nt-preview">' + MD.render(note.body) + '</div>' +
            '</section>' +
          '</div>' +
          '<div class="nt-editor-foot">' +
            '<span class="nt-hint mono">提示：正文里的图片与视频均来自网络地址，仅作展示引用。</span>' +
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
