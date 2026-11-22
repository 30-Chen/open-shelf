# SHELF / ONLINE

<img src="assets/brand/logo.svg" width="88" alt="SHELF / ONLINE logo">

> 你的移动数字货架，让喜好随时在线。

一个纯静态、零依赖、零构建的**个人收藏与笔记项目**。把常用开源应用、写下的想法分门别类收进同一个货架：数据默认留在自己的浏览器里（本地优先、离线可用），需要时再连上自己的私有云端，多设备自动同步。改完即上线，直接托管在 GitHub Pages。

- 站点：<https://30-chen.github.io/open-shelf/>
- 仓库：<https://github.com/30-Chen/open-shelf>

---

## 目录

- [功能一览](#功能一览)
- [快速开始](#快速开始)
- [页面结构](#页面结构)
- [功能模块](#功能模块)
- [跨设备同步](#跨设备同步)
- [个性化配置](#个性化配置)
- [数据源与限流](#数据源与限流)
- [项目结构](#项目结构)
- [扩展新模块](#扩展新模块)
- [安全说明](#安全说明)

---

## 功能一览

| 能力 | 说明 |
| --- | --- |
| 本地优先 | 数据默认存浏览器，离线可用；开启同步后后台自动对账，不改变零后端性质 |
| 模块化 | 每个功能独立 DOM / 样式 / 存储命名空间，故障隔离 |
| 开源应用收藏 | 自动读取项目介绍、Star、语言与最新 Release，按平台筛选安装包 |
| Markdown 笔记 | 图文、代码、内嵌视频、分类、搜索、标签、实时预览 |
| 跨设备同步 | 私有 Gist 全自动双向同步，三方合并不丢数据，短码 + 口令免记 Token |
| 明暗主题 | 自动（随日出日落）/ 亮色 / 暗色三段切换 |
| 静态兜底 | API 限流或断网时用内置快照显示内容 |
| 零构建 | 纯 HTML / CSS / 原生 JS，无依赖、无打包步骤 |

---

## 快速开始

本地预览：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

也可直接双击 `index.html` 打开（`file://` 下同样能运行；请求 GitHub API 需联网）。

部署到 GitHub Pages：

1. 新建 public 仓库 `open-shelf`，不要勾选任何初始化文件；
2. 把仓库根目录内容（保持 `assets/`、`data/` 结构）推送到 `main` 分支；
3. **Settings → Pages → Build and deployment** 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`；
4. 约 1 分钟后访问 `https://<用户名>.github.io/open-shelf/`。

站点全部使用相对路径，部署在子路径下也能正常工作。

---

## 页面结构

三个页面各司其职，URL 与职责固定：

| 页面 | 职责 |
| --- | --- |
| `index.html` | 产品介绍首页：功能特性、功能模块入口、工作原理、收尾引导（不承载功能数据） |
| `shelf.html` | 功能模块页：集中展示注册表自动生成的全部模块入口卡片 |
| `module.html?id=<id>` | 模块容器：按 `?id=` 只挂载一个模块 |

导航约定：

- 三个页面的 logo 均返回首页；
- 进入模块后页头的「返回功能模块」与面包屑都指向 `shelf.html`；
- 首页第三张模块卡覆盖显示为「更多功能」入口（指向 `shelf.html`），仅改卡片呈现，不改注册表——功能模块页与切换菜单里仍是原本的 One more thing 模块；
- 页头 GitHub 图标始终指向本项目仓库。

首页三个区块刻意采用不同版式：功能特性是居中三列软卡，工作原理是并排编号步骤条（右上角 01–04 数字水印、底部高亮 hover 由左至右铺开），功能模块区由内核生成入口卡片。特性与原理图标为默认尺寸，模块卡背景图标为 50px。

---

## 功能模块

模块由注册表驱动，新增模块无需改页面 HTML。当前注册三个模块：

### 模块 01 · 开源应用（`repo-showcase`）

提交一个 GitHub 仓库（`owner/repo` 或完整链接），自动读取项目介绍、Star、语言，以及最新 Release 的版本号、发布时间与下载地址。

- 常驻分类筛选条，可新建 / 管理目录；
- 下载列表按平台筛选（Windows / macOS / Linux / Android / iOS），默认优先显示当前设备安装包，最多 3 个主要文件；
- 支持源码包、更新日志、一键刷新；
- 内置静态快照兜底，API 限流或断网时仍有内容。

### 模块 02 · 笔记 / 博客（`notes`）

用 Markdown 写教程与灵感，支持图文、代码、内嵌视频，按分类整理、全文搜索、标签归类，带左右分栏实时预览编辑器。

| 想写什么 | 写法 |
| --- | --- |
| 标题 | `# 一级` ~ `###### 六级` |
| 强调 | `**粗体**`、`*斜体*`、`~~删除线~~` |
| 链接 / 图片 | `[文字](https://…)`、`![说明](图片地址)` |
| 代码块 | 三个反引号包裹，可跟语言名 |
| 列表 / 引用 | `- 项目`、`1. 项目`、`> 引用` |
| 视频 | 单独一行 `@video https://…`（B 站 / YouTube / mp4 直链） |

**上传限制与自动压缩**：只允许上传图片，视频请用 `@video` 贴网络地址。源图最大 8MB，上传后自动迭代压缩（最长边从 1600px、JPEG 质量从 0.82 起逐步降低），GIF / SVG 及本就很小的图片原样保留。所有图片总量限约 900KB——这是 GitHub Gist 单文件 API 只返回 1MB 的硬约束，超限会被截断导致同步数据损坏，因此同步层在写入前拦截、读取时发现截断立即报错。非常见手机格式（HEIC / HEIF / AVIF / TIFF 等）会自动转为 JPEG。

媒体（data URI）单独存在笔记的媒体字典里，正文只插入 `![文件名](media:ID)` 短引用，编辑时不会被超长 base64 淹没；预览、阅读与同步自动还原。导出 / 导入 JSON 可备份迁移。

### 模块 03 · One more thing（`one-more-thing`）

预留模块，只展示入口与说明页，不读写数据、不参与同步。保留在注册表与切换菜单里，等有真正想做的东西时填入。

---

## 跨设备同步

解决换设备看不到数据、多端内容不一致的问题。设计是**本地优先 + 全自动对账**：数据始终先在浏览器本地读写（离线可用），后台自动与你自己的**私有 Gist** 同步，不改变零后端性质。

### 工作原理

- 本地数据变化约 2.5 秒防抖后自动上传；每台设备每 15 秒检查云端，发现变化自动下载并刷新界面。这是准实时（秒级），Gist 本身不提供 WebSocket 推送。
- 两端几乎同时改动时，以「共同祖先」（每次同步成功后保存的云端快照 `baseSnapshot`）为基准做**三方合并**，而非盲目覆盖：对象按字段、带 `id` / `name` 的列表按条目逐条合并；普通列表按「任一端相对祖先删除就删除，否则取并集」处理。三台设备交替增删最终收敛到同一份，谁的内容都不会被静默吞掉。
- 未挂载的模块也能在后台同步（冷数据直接读写 localStorage），只在笔记页操作不会丢掉开源应用的数据。
- 状态胶囊显示「已同步 / 有改动 / 已合并云端改动 / 出错」，悬停可看最近检查结果，出错不会静默。点击胶囊可暂停 / 恢复自动同步。

**内置示例不参与同步**：首次打开看到的示例是每个设备各自的演示数据。你一旦增删改（或云端有真实数据拉取下来），数据转为「用户数据」后才开始同步。

### 配置步骤

**1. 生成 Token** — 打开 <https://github.com/settings/tokens/new?scopes=gist&description=SHELF%20ONLINE%20Sync>，只勾 **gist** 权限（`gist: write`），复制备用。不需要 repo、workflow 等其它权限。

**2. 首台设备连接** — 进入任一模块，点页头同步按钮，在「① 连接云端」粘贴 Token，点「↻ 立即同步」。Gist ID 无需填写，首次同步自动生成。数据写进你账号下私有 Gist 的 `open-shelf.json` 文件。云同步一旦配好 Token，模块 01 自动复用，无需重复粘贴。

**3. 其它设备（推荐：6 位短码 + 口令，免记 Token）** —

- 首台设备在「② 换设备 → 生成凭证」输入自设口令（至少 6 位），得到「GitHub 用户名 + 6 位短码 + 口令」，记进密码管理器；
- 新设备在「② 换设备 → 恢复配置」填入这三项，Token 与 Gist ID 自动配好并拉取最新数据。

> 口令本身不保存、不上传，只用于加解密。保险箱是一个**公开 Gist**（文件 `open-shelf-vault.txt`，格式 `OSV1.<salt>.<iv>.<ciphertext>`），里面只有密文，看不到明文 Token；description 带 `OSVAULT-<短码>` 标记用于定位。密钥经 `PBKDF2-SHA256`（12 万次迭代 + 随机盐）派生，用 `AES-GCM-256` 加密。恢复时用「用户名 + 短码」列出该用户公开 Gist 精确匹配，全程免 Token。口令忘了无法恢复，请像保管密码一样对待。旧版 `OS1.…` 长恢复码仍可用。

### 关键行为

| 场景 | 行为 |
| --- | --- |
| 新设备首次关联 | 以云端为准无条件下载并建立共同祖先，避免本机时钟误判覆盖云端 |
| 断开关联 | 清除本机 Token / Gist ID / 同步哈希；模块 01 数据保留，模块 02 笔记回到内置示例 |
| 恢复时同设备有断开后新增 | 面板出现选择卡：上传本地 / 下载云端 / 稍后处理，按模块替换 |
| 重置到初始状态 | 两级确认后：停同步 → 用凭证把云端写空 → 清本地 → 最后清凭证；云端失败则本地与凭证都不动 |
| 修改凭证 | 不写仓库、不发第三方，只存本机 localStorage；断开关联即清除 |
| 体积上限 | 单文件约 950KB，超限写入前拦截、读取时报错，避免 Gist 1MB 截断损坏数据 |

> 同一 Gist 只应由你自己的设备使用，不是多人协作方案；若需真正实时 + 账号体系，应接入云数据库。需 HTTPS 或 localhost 环境（Web Crypto 安全上下文要求）。

---

## 个性化配置

| 想改什么 | 改哪里 |
| --- | --- |
| 站名 / 副标语 / 页头链接 | `index.html`、`shelf.html`、`module.html` 的 `<header>` 与 `.lc-hero` |
| 默认收藏项目清单 | `assets/js/modules/repo-showcase/defaults.js` |
| 内置示例笔记 / 默认分类 | `assets/js/modules/notes/defaults.js` |
| 配色 / 圆角 / 字号行高字重阶梯 | `assets/css/base.css` 顶部 CSS 变量 |
| 引导页样式 | `assets/css/landing.css` |
| 模块私有样式 | `assets/css/module-*.css`（各自私有前缀） |
| API 缓存时长 | `assets/js/core/app.js` 的 `cacheMs` |

`defaults.js` 的改动提交到仓库后对所有访客生效；访客自己在页面上的增删改只存在其浏览器的 localStorage，不写仓库、不影响别人。

---

## 数据源与限流

- 调用两个公开接口：`GET /repos/{owner}/{repo}` 与 `GET /repos/{owner}/{repo}/releases?per_page=N`（自动排除草稿，稳定版优先）。
- 未认证限流 60 次/小时/IP；页面内置缓存 + 并发上限，正常浏览几乎不触发。
- 模块 01 设置可填只读 Token（限额提到 5000 次/小时）与自定义 API 地址；若已开启云同步会自动复用其 Token，无需重复填写。设置只存当前浏览器，**不会写进仓库**。
- 仓库附带 `data/snapshot.json` 作静态兜底：页面先读快照铺满首屏再用实时 API 覆盖（stale-while-revalidate），API 失败时保留快照并提示重试。删除该文件不影响功能，只是没有兜底。

更新快照：

```bash
node tools/update-snapshot.mjs
# 限流时：GITHUB_TOKEN=ghp_xxx node tools/update-snapshot.mjs
# 指定清单：SNAPSHOT_REPOS="owner/a,owner/b" node tools/update-snapshot.mjs
```

---

## 项目结构

```
index.html                          产品介绍首页
shelf.html                          功能模块页
module.html                         模块容器（按 ?id= 挂载）
data/snapshot.json                  可选静态兜底快照
tools/update-snapshot.mjs           生成 / 更新快照
assets/brand/logo.svg               品牌标识，favicon 与页头共用
assets/css/
  base.css                          全站设计系统（变量 / 布局 / 共享控件）
  theme.css                         亮色主题覆盖（data-theme="light"）
  landing.css                       引导页与二级页面框架（.lc- 前缀）
  sync.css                          同步面板（.sy- 前缀）
  module-repo-showcase.css          模块 01 私有样式（.rs- 前缀）
  module-notes.css                  模块 02 私有样式（.nt- 前缀）
  module-one-more-thing.css         模块 03 占位样式（.omt- 前缀）
assets/js/core/                     内核（所有模块共用，无业务逻辑）
  theme.js                          明暗主题三段切换
  store.js                          命名空间隔离的 localStorage 封装
  net.js                            GET JSON + TTL 缓存 + 错误归一化
  kernel.js                         事件总线 / 注册表 / 启动沙箱 / 目录渲染
  select.js                         下拉选择控件
  sync.js                           同步调度器 + 短码保险箱 + 三方合并
  app.js                            全局配置 + 页面分派启动
assets/js/modules/
  repo-showcase/                    模块 01（defaults / github / view / index）
  notes/                            模块 02（defaults / markdown / view / index）
  one-more-thing/                   模块 03（index）
```

**模块隔离的四层保证**：

1. 内核为每个模块创建独立 `<section id="module-<id>">` 容器；
2. 每个模块拿到独立的 `ctx.store`，key 前缀 `portal:v1:<id>:`；
3. 样式强制使用模块私有前缀，不写全局选择器；
4. `mount()` 被独立 `try/catch` 包裹，单个模块报错只显示自己的错误块。

模块间不直接引用，需要通信时走 `ctx.bus.on/emit`（如 `net:response`、`sync:token-change`）。云同步 Token 通过 `Portal.getSyncToken()` + `sync:token-change` 只读广播给模块 01。

> 三个页面都保留全部模块注册脚本，目的是停在首页 / 功能模块页时后台仍能对未挂载模块做冷同步。

---

## 扩展新模块

新增模块只需三步，不碰现有代码：

**1.** 新建 `assets/js/modules/links/index.js`：

```js
(function (global) {
  var Portal = global.Portal = global.Portal || {};
  Portal.registry.register({
    id: 'links',                       // 唯一 id，决定 DOM 容器与存储命名空间
    index: '04',                       // 卡片编号
    title: '常用链接',
    desc: '收藏常用的网址，按标签整理。',
    path: 'module.html?id=links',
    glyph: 'i-folder',                  // 可选：卡片背景图标（i-ico 类名）
    mount: function (ctx) {
      // ctx.root 独立容器 / ctx.store 私有存储 / ctx.net 请求层 / ctx.bus 事件总线
      ctx.root.innerHTML = '<div class="lk"><h2>常用链接</h2></div>';
    }
  });
})(window);
```

**2.** 新建 `assets/css/module-links.css`，类名统一用 `.lk-` 前缀。

**3.** 在三个 HTML 里按依赖顺序引入脚本（模块脚本放在 `app.js` 之前），并在 `module.html` 额外引入模块样式：

```html
<!-- index.html / shelf.html：注册脚本，用于冷同步与生成卡片 -->
<script defer src="assets/js/modules/links/index.js"></script>

<!-- module.html：注册脚本 + 模块私有样式 -->
<link rel="stylesheet" href="assets/css/module-links.css">
<script defer src="assets/js/modules/links/index.js"></script>
```

内核据此在 `shelf.html` 生成入口卡片，在 `module.html?id=links` 上只挂载该模块。

---

## 安全说明

- **存储隔离**：各模块只能访问自己的 `portal:v1:<id>:` 命名空间；Token / Gist ID 只存当前浏览器 localStorage，不写仓库、不发第三方。
- **XSS 防护**：GitHub 返回的项目描述、Release 名称、更新日志全部 HTML 转义后渲染；笔记渲染器先整体转义再白名单注入；视频 iframe 只接受 B 站 BV 号与 YouTube 视频 ID；图片仅放行 `http/https` 与校验过的 base64 图片 data URI；`media:ID` 短引用只从本机媒体字典取值且同样经过白名单校验。
- **传输安全**：Token 仅以 `Authorization: Bearer` 头发给 GitHub API；外链一律带 `rel="noopener noreferrer"`；短码保险箱只存密文，口令不落盘、不上传。
- **故障隔离**：模块挂载各自 `try/catch`，任一模块失败不影响其它模块；localStorage 不可用时自动降级内存存储，页面不报错。
- **公开站点提示**：请勿在公开站点填写带写权限的 Token；同步 Gist 仅由你自己的设备使用。

---

## 后续可扩展

- GitHub Actions 定时运行 `tools/update-snapshot.mjs`，让快照持续更新；
- 分类内搜索与排序。

> 已实现：明暗主题自动 / 手动切换、最新 Release 下载、按平台筛选（默认优先当前设备）、三方合并跨设备同步。
