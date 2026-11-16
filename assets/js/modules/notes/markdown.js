/* ============================================================
   notes/markdown.js · 安全 Markdown 渲染（零依赖）
   策略：先整体转义，再只注入白名单标签；URL 仅放行 http/https
   与图片 data:image；视频仅放行 YouTube / Bilibili / 直链媒体文件。
   这样即使笔记内容是他人分享的，也无法注入脚本或任意 iframe。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  Portal.moduleAssets = Portal.moduleAssets || {};
  var NS = Portal.moduleAssets.notes = Portal.moduleAssets.notes || {};

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 校验一个（已转义过的）URL 是否安全可用。 */
  function safeHttpUrl(urlEscaped) {
    var s = String(urlEscaped || '').trim();
    // 仅允许 http(s)，且必须紧跟 ://
    if (/^https?:\/\//i.test(s)) return s;
    return null;
  }

  /** 图片 URL：http(s) 或 base64 图片 data URI。 */
  function safeImageUrl(urlEscaped) {
    var http = safeHttpUrl(urlEscaped);
    if (http) return http;
    var s = String(urlEscaped || '').trim();
    if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(s)) return s;
    return null;
  }

  var VIDEO_EXT = /\.(mp4|webm|ogg|ogv|m4v|mov)(\?|#|$)/i;

  /** 把视频地址转成安全嵌入；识别不了就退回普通链接。 */
  function videoEmbed(urlEscaped, captionTextEscaped) {
    var raw = String(urlEscaped || '').trim();
    var cap = captionTextEscaped
      ? '<div class="nt-video-cap">' + inline(captionTextEscaped) + '</div>' : '';
    var http = safeHttpUrl(raw);
    if (!http) {
      return '<div class="nt-video-fallback">视频地址无效或不被支持</div>';
    }
    // 还原 &amp; 供解析，输出时仍用转义形式
    var probe = http.replace(/&amp;/g, '&');
    var id = null, kind = null;

    // YouTube: youtu.be/ID  |  youtube.com/watch?v=ID  |  /embed/ID  |  /shorts/ID
    var yt = probe.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
    if (yt) { id = yt[1]; kind = 'youtube'; }

    // Bilibili: BV 号
    if (!kind) {
      var bv = probe.match(/(BV[0-9A-Za-z]{10})/);
      if (bv) { id = bv[1]; kind = 'bilibili'; }
    }

    // 直链媒体文件 → <video>
    if (!kind && VIDEO_EXT.test(probe)) {
      return '<div class="nt-video">' +
        '<video controls preload="metadata" playsinline src="' + http + '"></video>' + cap +
      '</div>';
    }

    if (kind === 'youtube') {
      return '<div class="nt-video"><div class="nt-video-frame">' +
        '<iframe loading="lazy" title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen ' +
        'src="https://www.youtube-nocookie.com/embed/' + esc(id) + '"></iframe>' +
      '</div>' + cap + '</div>';
    }
    if (kind === 'bilibili') {
      return '<div class="nt-video"><div class="nt-video-frame">' +
        '<iframe loading="lazy" title="Bilibili video" allowfullscreen ' +
        'src="https://player.bilibili.com/player.html?bvid=' + esc(id) + '&amp;high_quality=1&amp;autoplay=0"></iframe>' +
      '</div>' + cap + '</div>';
    }

    // 兜底：安全外链
    return '<div class="nt-video"><a class="nt-video-link" href="' + http +
      '" target="_blank" rel="noopener noreferrer">▶ 打开视频 ↗</a>' + cap + '</div>';
  }

  /** 行内渲染：输入必须是「已转义」的字符串。 */
  function inline(textEscaped) {
    var stash = [];
    function hold(html) { stash.push(html); return '\u0001' + (stash.length - 1) + '\u0002'; }
    var s = textEscaped;

    // 行内代码优先占位，避免内部符号被后续规则处理
    s = s.replace(/`([^`\n]+)`/g, function (_, code) {
      return hold('<code class="nt-code">' + code + '</code>');
    });

    // 图片 ![alt](url) —— 含视频直链时自动升级为播放器
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, url) {
      if (VIDEO_EXT.test(String(url).replace(/&amp;/g, '&'))) return hold(videoEmbed(url, ''));
      var u = safeImageUrl(url);
      return u
        ? hold('<img class="nt-img" loading="lazy" src="' + u + '" alt="' + alt + '">')
        : alt;
    });

    // 链接 [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
      var u = safeHttpUrl(url);
      return u
        ? hold('<a class="nt-link" href="' + u + '" target="_blank" rel="noopener noreferrer">' + label + '</a>')
        : label;
    });

    // 强调（此时文本已转义，注入的标签都是白名单）
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    // 换行
    s = s.replace(/\n/g, '<br>');

    // 还原占位符
    s = s.replace(/\u0001(\d+)\u0002/g, function (_, i) { return stash[+i] || ''; });
    return s;
  }

  /** 把 Markdown 源文渲染成安全 HTML。 */
  function render(source) {
    var lines = String(source == null ? '' : source).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;

    function isBlockStart(line) {
      return /^\s*```/.test(line) || /^\s*@video\b/i.test(line) ||
        /^\s*#{1,6}\s+/.test(line) || /^\s*(---+|\*\*\*+|___+)\s*$/.test(line) ||
        /^\s*>\s?/.test(line) || /^\s*([-*+]|\d+\.)\s+/.test(line) || /^\s*$/.test(line);
    }

    while (i < lines.length) {
      var line = lines[i];

      // 空行
      if (/^\s*$/.test(line)) { i++; continue; }

      // 围栏代码块 ```
      var fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
      if (fence) {
        var lang = fence[1] ? ' data-lang="' + esc(fence[1]) + '"' : '';
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
        if (i < lines.length) i++; // 跳过结束 ```
        out.push('<pre class="nt-pre"' + lang + '><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // @video <url> [说明]
      var vm = line.match(/^\s*@video\s+(\S+)(?:\s+(.*))?$/i);
      if (vm) {
        out.push(videoEmbed(esc(vm[1]), vm[2] ? esc(vm[2]) : ''));
        i++;
        continue;
      }

      // 标题
      var hm = line.match(/^\s*(#{1,6})\s+(.+)$/);
      if (hm) {
        var lv = hm[1].length;
        out.push('<h' + lv + ' class="nt-h nt-h' + lv + '">' + inline(esc(hm[2])) + '</h' + lv + '>');
        i++;
        continue;
      }

      // 水平线
      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { out.push('<hr class="nt-hr">'); i++; continue; }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push('<blockquote class="nt-quote">' + render(q.join('\n')) + '</blockquote>');
        continue;
      }

      // 列表
      var lm = line.match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
      if (lm) {
        var ordered = /\d/.test(lm[1]);
        var tag = ordered ? 'ol' : 'ul';
        var items = [];
        while (i < lines.length) {
          var m = lines[i].match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
          if (!m || /\d/.test(m[1]) !== ordered) break;
          items.push('<li>' + inline(esc(m[2])) + '</li>');
          i++;
        }
        out.push('<' + tag + ' class="nt-list">' + items.join('') + '</' + tag + '>');
        continue;
      }

      // 段落：合并到下一个块开始或空行
      var para = [line];
      i++;
      while (i < lines.length && !isBlockStart(lines[i])) para.push(lines[i++]);
      out.push('<p class="nt-p">' + inline(esc(para.join('\n'))) + '</p>');
    }

    return out.join('\n');
  }

  /** 从正文里抽取纯文本摘要（用于卡片预览）。 */
  function excerpt(source, max) {
    var s = String(source == null ? '' : source)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/@video\s+\S+/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    max = max || 120;
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  /** 抽取第一张图片作为卡片封面。视频返回空。 */
  function coverOf(source) {
    var m = String(source == null ? '' : source).match(/!\[([^\]]*)\]\(([^)\s]+)\)/);
    if (!m || VIDEO_EXT.test(m[2])) return '';
    return safeImageUrl(esc(m[2])) || '';
  }

  NS.markdown = {
    esc: esc,
    render: render,
    excerpt: excerpt,
    coverOf: coverOf,
    videoEmbed: videoEmbed
  };
})(window);
