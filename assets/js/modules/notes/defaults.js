/* ============================================================
   notes/defaults.js · 内置的示例教程笔记
   ✎ 直接编辑这个文件并推送到 GitHub，所有访客首次打开都能看到；
     访客自己在页面上新建/修改的笔记只存在他自己的浏览器里。
   body 使用 Markdown，视频支持 @video <url> 语法（见 README）。
   ============================================================ */
(function (global) {
  'use strict';
  var Portal = global.Portal = global.Portal || {};
  Portal.moduleAssets = Portal.moduleAssets || {};
  var NS = Portal.moduleAssets.notes = Portal.moduleAssets.notes || {};

  NS.defaultCategory = '未分类';       // 全新数据初始化时的默认目录名；之后「首个目录」即默认，可重命名、不可删除
  NS.defaultCategories = ['教程', '随笔'];

  NS.defaults = [
    {
      id: 'welcome',
      title: '欢迎使用 · 写作指南',
      category: '教程',
      tags: ['Markdown', '入门'],
      updatedAt: Date.UTC(2026, 10, 16),
      body: [
        '# 欢迎来到笔记模块',
        '',
        '这是一个用 **Markdown** 写作的轻量笔记空间，专门用来收藏教程与灵感。支持图文、代码，以及内嵌视频。',
        '',
        '## 基本语法',
        '',
        '- `# 标题` 生成一级标题，`##` 是二级，以此类推',
        '- `**粗体**`、`*斜体*` 与 `~~删除线~~`',
        '- `[文字](https://example.com)` 插入链接，`![说明](图片地址)` 插入图片',
        '- 用三个反引号包裹代码块，可标注语言',
        '',
        '## 插入代码',
        '',
        '```js',
        'function hello(name) {',
        '  return `你好，${name}`;',
        '}',
        'console.log(hello("世界"));',
        '```',
        '',
        '## 插入视频',
        '',
        '单独一行写 `@video 地址`，支持 B 站、YouTube 直链与 mp4 文件：',
        '',
        '@video https://www.bilibili.com/video/BV1GJ411x7h7',
        '',
        '> 提示：所有内容只保存在你自己的浏览器本地。想永久保存一篇教程，记得用「导出」下载备份。'
      ].join('\n')
    },
    {
      id: 'git-cheatsheet',
      title: 'Git 常用命令速查',
      category: '教程',
      tags: ['Git', '工具'],
      updatedAt: Date.UTC(2026, 10, 12),
      body: [
        '# Git 常用命令速查',
        '',
        '日常开发里最常用的几条命令，记不住就回来查。',
        '',
        '## 拉取与提交',
        '',
        '```bash',
        'git pull                 # 拉取远端更新',
        'git add .                # 暂存所有改动',
        'git commit -m "message"  # 提交',
        'git push                 # 推送到远端',
        '```',
        '',
        '## 分支操作',
        '',
        '- `git switch -c feature/x` 新建并切换分支',
        '- `git switch main` 切回主分支',
        '- `git merge feature/x` 合并分支',
        '',
        '## 撤销',
        '',
        '`git restore <file>` 丢弃未暂存的改动；`git log --oneline` 查看提交历史。',
        '',
        '![Git 分支示意](https://picsum.photos/seed/gitbranch/760/260)'
      ].join('\n')
    },
    {
      id: 'why-notes',
      title: '为什么要做模块化主页',
      category: '随笔',
      tags: ['想法'],
      updatedAt: Date.UTC(2026, 10, 9),
      body: [
        '# 为什么要做模块化主页',
        '',
        '把每个功能拆成**互不影响的模块**，新增一个能力时，不必担心改坏已有的部分。',
        '',
        '这个笔记模块就是第二个例子：它和「开源应用」模块各自拥有独立的 DOM 容器、独立的本地存储和独立的样式前缀。',
        '',
        '- 一个模块出错，不会拖垮其它模块',
        '- 想加新功能，只需注册一个新模块',
        '- 纯静态、零依赖，丢到 GitHub Pages 就能跑',
        '',
        '---',
        '',
        '*写下你的第一篇笔记吧。*'
      ].join('\n')
    }
  ];
})(window);
