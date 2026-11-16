# OPEN / SHELF

一个简洁、带科技感的个人主页，用来收集自己常用的开源 App。纯静态、零依赖、零构建，直接托管到 GitHub Pages。

**页面结构**：`index.html` 是引导页（模块入口目录），每个功能作为二级页面运行在 `module.html?id=<模块id>` 上，互不干扰。

**模块 01 · 开源应用**：提交一个 GitHub 仓库（`owner/repo` 或完整链接）并选择分类目录（可新建），页面自动读取项目介绍、Star、语言、Topics，以及**最新 Release 的版本号与下载地址**（默认显示 3 个主要安装文件，按平台可执行包优先排序，文件名、大小、下载次数）。同时支持源码 `.zip` / `.tar.gz`、更新日志、一键刷新。内置**静态快照兜底**：API 限流或断网时依然显示内容。

**模块 02 · 笔记 / 博客**：用 Markdown 写教程与灵感，支持**图文、代码、内嵌视频**（B 站、YouTube、mp4 直链），按分类目录整理、全文搜索、标签归类。带左右分栏的实时预览编辑器、工具栏一键插入图片/视频/代码块；笔记保存在当前浏览器本地，可**导出/导入 JSON** 备份迁移。内置 3 篇示例教程，渲染器先转义后白名单注入，杜绝 XSS。

### 笔记语法速查

| 想写什么 | 写法 |
| --- | --- |
| 标题 | `# 一级` ~ `###### 六级` |
| 强调 | `**粗体**`、`*斜体*`、`~~删除线~~` |
| 链接 / 图片 | `[文字](https://…)`、`![说明](图片地址)` |
| 代码块 | 三个反引号包裹，可跟语言名如 ``` js |
| 列表 / 引用 | `- 项目`、`1. 项目`、`> 引用` |
| 视频 | 单独一行写 `@video https://…`（B 站 / YouTube / mp4 直链） |

> 视频与图片只引用网络地址，不上传文件、不占用存储；笔记正文与设置仅存在你自己的浏览器里，公开站点上的访客看不到彼此的内容。

**跨设备同步**：模块数据默认只存当前浏览器。页面右下角的 ☁ 按钮可把数据上传到**你自己的私有 Gist**，换设备或异地访问时下载回来，两个模块的数据会一并迁移。详见下方「跨设备同步」章节。

---

## 跨设备同步（GitHub Gist）

解决「换设备 / 异地访问时看不到自己数据」的问题。设计上是**本地优先 + 手动同步**：数据始终先在浏览器本地读写，只有点上传/下载时才经过 GitHub，不改变站点零后端的性质。

**第一步 · 生成 Token**

打开 <https://github.com/settings/tokens/new?scopes=gist&description=Open%20Shelf%20Sync>， scopes 只勾 **gist**（`gist: write`），生成后复制。也可以用面板里的「获取 Token ↗」直达。不需要 repo、workflow 等其它权限。

**第二步 · 配置**

进入任一模块（模块 01 或 02），点右下角 ☁：

- **GitHub Token**：粘贴上一步的 Token；
- **Gist ID**：首次留空即可，上传成功后会自动填好并记住。

点 **↑ 上传**：内核把当前已挂载模块的数据聚合成一份 `open-shelf.json`，写进你账号下的一个**私有 Gist**（不公开、不出现在搜索里），并把 Gist ID 记在本地。

**第三步 · 换设备下载**

在另一台设备打开站点，进入任一模块，点 ☁，填入**同一个 Token** 和**上传时生成的 Gist ID**，点 **↓ 下载** 即可恢复。Gist ID 可以在状态栏看到前 10 位，完整 ID 就是 Gist 链接 `https://gist.github.com/<用户名>/<Gist ID>` 里最后那段。

**冲突与安全**

- 上传前会检查云端是否被别的设备改过，下载前会检查本地是否有未上传改动；有冲突时**先弹出确认，明确覆盖方向**才执行，不会静默丢数据。
- 不是自动实时同步，而是一来一回手动覆盖，语义简单可预期；建议离开某设备前先上传，到新设备先下载。
- Token 与 Gist ID 只保存在**当前浏览器**的 `localStorage`，不写进仓库、不发给任何第三方；公开电脑上用完请点「断开关联」并清除浏览器数据。
- Gist 里只有你添加的分类、项目清单、笔记正文与分类，**不含 Token、API 设置等本地偏好**。
- 同步失败会显示具体原因（Token 无效、缺少 gist 权限、Gist 不存在、网络不通等）。

> 这是手动同步而非多人协作：同一 Gist 只应由你自己的设备使用。需要真正的多端实时同步或多人协作时，再考虑接入云数据库。

---

## 快速开始

```bash
# 本地预览（推荐）
python3 -m http.server 8000
# 打开 http://localhost:8000
```

也可以直接双击 `index.html`（`file://` 下同样能跑；请求 GitHub API 需要联网）。

部署到 GitHub Pages（任选一种）：

**方式 A · 命令行 / GitHub 连接器**

本地仓库已准备好：`main` 分支、首次提交，`.gitignore` 已排除 `.workbuddy/` 与 `dist/`。在具备 GitHub 凭据的环境里：

```bash
git remote add origin https://github.com/<用户名>/open-shelf.git
git push -u origin main
```

**方式 B · 浏览器已登录 GitHub 时，全程网页操作（不需要 git）**

1. 打开 `https://github.com/new`，新建 public 仓库 `open-shelf`，**不要**勾选任何初始化文件；
2. 在空仓库页点「uploading an existing file」，把 `dist/` **里面的全部内容**（14 个文件，保持 `assets/`、`data/` 目录结构）拖进上传区并提交。`dist/` 是已生成的干净发布目录，不含 `.git` 和 `.workbuddy/`；
3. 仓库 **Settings → Pages → Build and deployment** 选 `Deploy from a branch`，分支 `main` + 目录 `/ (root)` → Save；
4. 约 1 分钟后访问 `https://<用户名>.github.io/open-shelf/`（若仓库名就是 `<用户名>.github.io`，直接访问根域名）。

站点全部使用相对路径，部署在子路径下也能正常工作。

此外，本项目已通过 WorkBuddy 应用发布额外生成了一个即时在线链接（见应用发布面板），可在「设置—数据管理—应用」中管理或下线，与 GitHub Pages 互不影响。

## 个性化

| 想改什么 | 改哪里 |
| --- | --- |
| 站名 / 引导页标题 / 右上角链接 | `index.html`、`module.html` 的 `<header>` 与 `.lc-hero` |
| 默认收藏的项目清单 | `assets/js/modules/repo-showcase/defaults.js` |
| 默认目录名称 | `assets/js/modules/repo-showcase/index.js` 的 `DEFAULT_GROUP` |
| 下载列表显示几行 | `assets/js/modules/repo-showcase/view.js` 的 `MAX` |
| 配色 / 圆角 / 字体 | `assets/css/base.css` 顶部的 CSS 变量 |
| 引导页样式 | `assets/css/landing.css` |
| 卡片样式 | `assets/css/module-repo-showcase.css` |
| 内置示例笔记 / 默认分类 | `assets/js/modules/notes/defaults.js` 的 `NS.defaults` / `NS.defaultCategories` |
| 笔记样式 | `assets/css/module-notes.css` |
| API 缓存时长 | `assets/js/core/app.js` 的 `cacheMs` |

`defaults.js` 里的清单**提交到仓库后对所有访客生效**；访客自己在页面上添加/删除的项目只存在他浏览器的 `localStorage` 里，不会改动仓库，也不会影响别人。

## 数据源与限流

- 调用两个公开接口：`GET /repos/{owner}/{repo}` 与 `GET /repos/{owner}/{repo}/releases/latest`（自动排除草稿与预发布版本）。
- 未认证时 GitHub 限制 **60 次/小时/IP**。页面内置 30 分钟快照缓存 + 请求缓存 + 并发上限 3，正常浏览几乎不会触发限流。
- 点击右上角 **⚙ 设置** 可填：
  - **GitHub Token**（可选）：限额提升到 5000 次/小时，填一个无权限的只读 Token 即可；
  - **API 地址**（可选）：访问 `api.github.com` 不畅时填可用的镜像地址。
- 设置只保存在当前浏览器，**不会写进仓库**。公开站点请勿填写带写权限的 Token。
- 请求失败时会保留上一次缓存数据并提示重试；仓库从未发布 Release 时显示「暂无发布版本」。

## 离线快照兜底（可选，建议保留）

浏览器直连 API 可能遇到共享 IP 限流、公司网络拦截或离线。仓库里附带一份静态快照 `data/snapshot.json`：

- 页面加载时**先读快照铺满首屏**，再用实时 API 覆盖（stale-while-revalidate），不会白屏等待；
- API 失败时保留快照内容，卡片底部标注「离线快照」并给出重试入口；
- 删除 `data/snapshot.json` 后功能完全正常，只是没有兜底。

更新快照（在项目根目录执行）：

```bash
node tools/update-snapshot.mjs
# 限流时可加 Token：GITHUB_TOKEN=ghp_xxx node tools/update-snapshot.mjs
# 临时指定清单：SNAPSHOT_REPOS="owner/a,owner/b" node tools/update-snapshot.mjs
```

脚本按 `defaults.js` 的清单抓取仓库信息与最新 Release，裁剪后写入 `data/snapshot.json`，提交到仓库即可生效。也可以在 GitHub Actions 里定时运行它，让快照始终最新。

## 目录结构与模块化约定

```
index.html                          引导页：模块入口目录
module.html                         二级页面容器：按 ?id= 挂载单个模块
data/snapshot.json                  可选的静态兜底快照
tools/update-snapshot.mjs           一键生成 / 更新快照
assets/css/
  base.css                         全站设计系统（变量、布局、共享控件）
  landing.css                      引导页 / 二级页面框架样式（.lc- 前缀）
  sync.css                         跨设备同步悬浮面板（.sy- 前缀）
  module-repo-showcase.css         模块 01 私有样式（.rs- 前缀）
  module-notes.css                 模块 02 私有样式（.nt- 前缀）
assets/js/core/                     内核：所有模块共用，不含业务逻辑
  store.js                         命名空间隔离的 localStorage 封装
  net.js                           GET JSON + TTL 缓存 + 错误归一化
  kernel.js                        事件总线 / 注册表 / 启动沙箱 / 目录渲染
  sync.js                          跨设备同步：Gist 读写 + 冲突检测 + 悬浮面板
  app.js                           全局配置 + 页面分派启动
assets/js/modules/repo-showcase/    业务模块 01 · 开源应用
  defaults.js                      提交到仓库生效的默认清单
  github.js                        数据适配层：输入解析 + API + 归一化
  view.js                          纯渲染层：无状态、全量转义
  index.js                         模块入口：注册、状态、交互、分类目录
assets/js/modules/notes/            业务模块 02 · 笔记 / 博客
  defaults.js                      内置示例笔记与默认分类
  markdown.js                      安全 Markdown 渲染 + 视频白名单
  view.js                          纯渲染层：列表 / 阅读 / 编辑器
  index.js                         模块入口：CRUD / 搜索 / 导入导出
```

「互不影响」的四层保证：

1. 每个模块由内核创建独立 `<section id="module-<id>">` 容器；
2. 每个模块拿到的是**只属于自己的** `ctx.store`（key 前缀 `portal:v1:<id>:`）；
3. 样式强制使用模块私有前缀，不写全局选择器；
4. `mount()` 被独立 `try/catch` 包裹，某个模块报错只会显示自己的错误块，其它模块照常运行。

模块之间不直接引用，需要通信时走 `ctx.bus.on/emit`（例如 `net:response` 事件）。

## 新增更多功能（示例）

已有模块 01 开源应用、模块 02 笔记。以后想加「书签」「常用链接」等模块，只需要三步，不需要碰现有代码：

**1.** 新建 `assets/js/modules/links/index.js`：

```js
(function (global) {
  var Portal = global.Portal = global.Portal || {};
  Portal.registry.register({
    id: 'links',                       // 唯一 id，决定 DOM 容器与存储命名空间
    index: '02',                       // 引导页卡片上的编号
    title: '常用链接',
    desc: '收藏常用的网址，按标签整理。',   // 引导页卡片上的简介
    path: 'module.html?id=links',      // 引导页卡片的入口地址
    mount: function (ctx) {
      // ctx.root   独立容器
      // ctx.store  私有存储
      // ctx.net    请求层
      // ctx.bus    事件总线
      var list = ctx.store.get('list', []);
      ctx.root.innerHTML = '<div class="lk"><h2>常用链接</h2></div>';
    }
  });
})(window);
```

**2.** 新建 `assets/css/module-links.css`，类名统一用 `.lk-` 前缀。

**3.** 在 `index.html` 和 `module.html` **两个页面**里按依赖顺序加标签（模块脚本放在 `app.js` 之前）：

```html
<link rel="stylesheet" href="assets/css/module-links.css">
<script defer src="assets/js/modules/links/index.js"></script>
```

内核会据此：在首页引导目录自动生成入口卡片，在 `module.html?id=links` 上只挂载这个模块。顺序、故障、存储都与其它模块隔离。

## 后续可扩展的方向

- GitHub Actions 定时运行 `tools/update-snapshot.mjs`，站点彻底不依赖浏览器侧的 API 限额；
- 分类内搜索 / 排序；
- 明暗主题切换（改 `base.css` 的 CSS 变量即可）；
- 多版本下载、按平台筛选（当前下载列表已默认显示 3 个主要安装文件）。

> 安全说明：GitHub 返回的项目描述、Release 名称与更新日志全部经过 HTML 转义后才渲染，外链只允许 `http/https`。笔记渲染器同样先整体转义再白名单注入；视频 iframe 只接受 B 站 BV 号与 YouTube 视频 ID，图片仅放行 `http/https` 与 base64 图片，杜绝脚本注入。
