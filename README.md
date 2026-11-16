# OPEN / SHELF

一个简洁、带科技感的个人主页，用来收集自己常用的开源 App。纯静态、零依赖、零构建，直接托管到 GitHub Pages。

**页面结构**：`index.html` 是引导页（模块入口目录），每个功能作为二级页面运行在 `module.html?id=<模块id>` 上，互不干扰。

**模块 01 · 开源应用**：提交一个 GitHub 仓库（`owner/repo` 或完整链接）并选择分类目录（可新建），页面自动读取项目介绍、Star、语言、Topics，以及**最新 Release 的版本号与下载地址**（默认显示 3 个主要安装文件，按平台可执行包优先排序，文件名、大小、下载次数）。同时支持源码 `.zip` / `.tar.gz`、更新日志、一键刷新。内置**静态快照兜底**：API 限流或断网时依然显示内容。

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
tools/deploy-github.sh              一键创建仓库 / 推送 / 开启 Pages
data/snapshot.json                  可选的静态兜底快照
tools/update-snapshot.mjs           一键生成 / 更新快照
assets/css/
  base.css                         全站设计系统（变量、布局、共享控件）
  landing.css                      引导页 / 二级页面框架样式（.lc- 前缀）
  module-repo-showcase.css         模块私有样式（统一 .rs- 前缀）
assets/js/core/                     内核：所有模块共用，不含业务逻辑
  store.js                         命名空间隔离的 localStorage 封装
  net.js                           GET JSON + TTL 缓存 + 错误归一化
  kernel.js                        事件总线 / 注册表 / 启动沙箱 / 目录渲染
  app.js                           全局配置 + 页面分派启动
assets/js/modules/repo-showcase/    业务模块 01
  defaults.js                      提交到仓库生效的默认清单
  github.js                        数据适配层：输入解析 + API + 归一化
  view.js                          纯渲染层：无状态、全量转义
  index.js                         模块入口：注册、状态、交互、分类目录
```

「互不影响」的四层保证：

1. 每个模块由内核创建独立 `<section id="module-<id>">` 容器；
2. 每个模块拿到的是**只属于自己的** `ctx.store`（key 前缀 `portal:v1:<id>:`）；
3. 样式强制使用模块私有前缀，不写全局选择器；
4. `mount()` 被独立 `try/catch` 包裹，某个模块报错只会显示自己的错误块，其它模块照常运行。

模块之间不直接引用，需要通信时走 `ctx.bus.on/emit`（例如 `net:response` 事件）。

## 新增第二个功能（示例）

以后想加「书签」「常用链接」「博客列表」等模块，只需要三步，不需要碰现有代码：

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

> 安全说明：GitHub 返回的项目描述、Release 名称与更新日志全部经过 HTML 转义后才渲染，外链只允许 `http/https`。
