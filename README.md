# OPEN / SHELF

一个简洁、带科技感的个人主页，用来收集自己常用的开源 App。纯静态、零依赖、零构建，直接托管到 GitHub Pages。

**页面结构**：`index.html` 是引导页（模块入口目录），每个功能作为二级页面运行在 `module.html?id=<模块id>` 上，互不干扰。

**模块 01 · 开源应用**：提交一个 GitHub 仓库（`owner/repo` 或完整链接）并选择分类目录（可新建），页面自动读取项目介绍、Star、语言，以及**最新 Release 的版本号、发布时间与下载地址**。下载列表支持**按平台筛选**（Windows / macOS / Linux / Android / iOS），默认优先显示当前设备的安装包，最多显示 3 个主要安装文件（文件名、大小、下载次数），校验文件靠后；只看最新版本，无需切换。同时支持源码 `.zip` / `.tar.gz`、更新日志、一键刷新。内置**静态快照兜底**：API 限流或断网时依然显示内容。

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

**跨设备同步（全自动）**：模块数据默认存当前浏览器；点页头 `SYSTEM` 旁的 ☁ 同步 按钮、填入 Token 并打开「自动同步」后，本地任何增删会约 2 秒后自动上传，其它设备每 15 秒自动拉取最新数据，多端保持一致，无需手动点按钮。嫌 Token 难记？可设一个自设口令把配置加密后存进「云端保险箱」，换设备时只需「用户名 + 6 位短码 + 口令」即可自动配好，记住的只有短码。详见下方「跨设备同步」章节。

**明暗主题**：页头最右侧的圆形模式图标（纯图标，悬停可看当前模式）循环切换「自动 / 亮色 / 暗色」。默认自动：按本地时间在日出 06:00 至日落 18:00 之间用亮色、其余用暗色；手动选择会记住偏好。偏好仅存当前浏览器。

**公开只读分享**：想让别人看到你的内容、但不允许修改？在页头 ☁ 同步 面板点「⇧ 发布 / 更新分享」，即可生成一个独立的只读链接 `share.html?id=…`。任何人可查看项目清单与笔记，但无法增删；发布内容存在**另一个公开 Gist** 里，与私有同步 Gist 完全分开。详见下方「公开只读分享」章节。

---

## 跨设备同步（全自动 · GitHub Gist）

解决「换设备 / 异地访问看不到自己数据」和「多端内容不一致」的问题。设计上是**本地优先 + 全自动同步**：数据始终先在浏览器本地读写（离线可用），后台自动与**你自己的私有 Gist** 对账，不改变站点零后端的性质。

**工作原理**：本地数据一变（约 2 秒防抖后）自动上传；页面打开的每台设备每 15 秒自动检查云端，发现变化就自动下载并刷新界面。两端几乎同时修改时按「修改时间戳较新者获胜」裁决（时间戳统一取写入方客户端时间，避免设备时钟与服务器时间不一致导致删除被云端旧数据覆盖），结果会显示在面板的「自动检查」一行。面板顶部有**自动同步开关**，可随时暂停。

**内置示例不参与同步**：首次打开看到的示例项目/示例笔记是每个设备各自展示的演示数据，不是你的内容，因此不会上传到云端、也不会在多设备间来回覆盖。你一旦增删改（或云端有真实数据拉取下来），数据转为「用户数据」后才开始同步；所以删掉示例后，空清单会被同步，其它设备里的示例也会被清掉。

**第一步 · 生成 Token**

打开 <https://github.com/settings/tokens/new?scopes=gist&description=Open%20Shelf%20Sync>， scopes 只勾 **gist**（`gist: write`），生成后复制。也可以用面板里的「获取 Token ↗」直达。不需要 repo、workflow 等其它权限。

**第二步 · 首台设备配置**

进入任一模块（模块 01 或 02），点页头的 ☁ 同步 按钮：

- **GitHub Token**：粘贴上一步的 Token；
- **Gist ID**：留空即可，首次上传后会自动生成并填好；
- 确认**自动同步开关为开**（默认开启）。

之后所有操作自动进行：数据写进你账号下的一个**私有 Gist**（不公开、不出现在搜索里）的 `open-shelf.json` 文件。也可以手动点 **↑ 上传 / ↓ 下载** 立即同步一次。

**第三步 · 其它设备（推荐：6 位短码 + 口令，免记 Token）**

Token 又长又难记？用你自己设的口令把配置加密后存进一个**云端保险箱**，换设备时只记「**GitHub 用户名 + 6 位短码 + 口令**」，不用重新申请或抄写 Token。用户名是你自己的账号、口令是自己设的好记词，真正额外要记的只有 6 位短码：

1. **首台设备生成短码**：在 ☁ 同步 面板的「VAULT CODE / 换设备免记 Token」区，输入一个你自设的**口令**（至少 6 位，自己记牢），点「**生成短码**」。面板会醒目显示一个 6 位短码（如 `K7M2QX`）和你的 GitHub 用户名，并自动生成「保险箱」。把「用户名 + 短码 + 口令」记进密码管理器（也可点「复制保险箱链接（备用）」一并保存）。
2. **新设备恢复**：打开站点点 ☁ 同步，在同一个区域填入**同一个口令**、**GitHub 用户名**、那 **6 位短码**，点「**用短码恢复**」。Token、Gist ID（以及公开分享 Gist，如有）会自动填好并立即从云端拉取最新数据。之后自动同步照常工作。若保险箱列出失败，可改贴「保险箱链接」直接恢复。

> 口令本身**不保存、不上传**，只用来加/解密；保险箱是一个**公开 Gist**，但里面只有密文，看不到明文 Token。用户名/短码泄露无妨（别人没口令打不开），口令忘了则无法恢复，请像保管密码一样对待。
>
> 备选：也可以不用保险箱，直接在其它设备手动填入**同一个 Token + 首台设备的 Gist ID**，效果一样。Gist ID 可在状态栏看到前 10 位，完整 ID 是 Gist 链接 `https://gist.github.com/<用户名>/<Gist ID>` 里最后那段。
>
> **旧版兼容**：旧方案生成的 `OS1.…` 长恢复码仍然可用——在恢复框粘贴旧码 + 输入同一口令即可，系统会自动识别。

**短码保险箱的安全实现**：Web Crypto `AES-GCM-256` 加密，密钥由口令经 `PBKDF2-SHA256`（12 万次迭代 + 随机盐）派生，每次生成都用新的随机盐和 IV。密文存进你账号下一个**公开 Gist**（文件名 `open-shelf-vault.txt`，格式 `OSV1.<salt>.<iv>.<ciphertext>`），description 里写入 `OSVAULT-<6位短码>` 标记用于定位。GitHub 没有按描述搜索 Gist 的 API，因此恢复时用「用户名 + 短码」列出该用户的公开 Gist 精确匹配，全程免 Token（公开 Gist 匿名可读）。密文不含明文 Token；口令错误或被篡改会解密失败并提示，不会写入错误配置。需 HTTPS 或 localhost 环境（浏览器 Web Crypto 的安全上下文要求）。

**关键行为与安全**

- **合并而非盲覆盖**：上传前会把「当前页面未打开的模块」数据从云端保留下来，所以只在笔记页操作也不会丢掉开源应用的数据。
- **冷数据同步**：即使停在首页（没进入任何模块），后台也能同步——未挂载模块的数据直接读写 localStorage，进入模块时自动生效。
- **冲突裁决**：以各端最后修改时间为准，较新的一方覆盖；内容一致时什么都不做。面板会显示每次检查的结果，出错不会静默。
- **自动开关**：关闭后停止一切后台同步，本地数据保持不变；`visibilitychange` 时（切回标签页）会立即检查一次。
- Token 与 Gist ID 只保存在**当前浏览器**的 `localStorage`，不写进仓库、不发给任何第三方；公开电脑上用完请点「断开关联」并清除浏览器数据。
- 口令不落盘：保险箱只存密文，口令仅在当前页面内存中用于加解密，刷新即消失。
- Gist 里只有你添加的分类、项目清单、笔记正文与分类，**不含 Token、API 设置等本地偏好**。
- 同步失败会显示具体原因（Token 无效、缺少 gist 权限、网络不通等），按钮状态会变红提示。

> 延迟说明：这是**准实时**（约 2~15 秒级），不是毫秒级推送——GitHub Gist 本身不提供 WebSocket 订阅。对单人多设备的「保持最新」场景足够。同一 Gist 只应由你自己的设备使用，不是多人协作方案；若需真正实时 + 账号体系，再考虑接入云数据库。

---

## 公开只读分享（让别人查看，但不能改）

解决「想分享给他人看，但不想让别人增删」的问题。核心是**把内容快照复制到另一个独立的公开 Gist**，通过一个专门的只读页面展示——访客看到的是静态快照，没有编辑入口、也不写任何本地存储。

**和私有同步的区别（重要）**

| | 私有同步 Gist | 公开分享 Gist |
| --- | --- | --- |
| 用途 | 你自己多设备自动同步 | 给任何人只读查看 |
| 可见性 | 私有，仅你的 Token 可读 | 公开，任何人可读 |
| 谁写入 | 你的设备自动同步 | 只有你手动点「发布/更新」 |
| 是否自动 | 全自动 | 手动（改完内容后重新发布一次） |

两个 Gist 完全独立：同步再频繁也不会把更新自动推给访客，访客也无法通过分享页触碰你的私有数据。

**怎么用**

1. 进入任一模块，点页头 ☁ 同步 按钮，填入 Token（同一个 `gist` 权限 Token 即可，无需额外授权）；
2. 在面板底部的「PUBLIC VIEW / 只读分享」区点 **⇧ 发布 / 更新分享**；
3. 成功后会生成链接（点「复制链接」），形如 `https://<用户名>.github.io/open-shelf/share.html?id=<GistID>&owner=<用户名>`；
4. 把这个链接发给任何人即可查看。以后你改了内容，**再点一次「发布 / 更新分享」**，访客刷新就看到最新；
5. 想撤回时点「停止分享」——会删除那个公开 Gist，旧链接立即失效（不影响你的私有同步数据）。

**访客端体验**

- 页面顶部明确标注「只读分享」，只有「开源应用 / 笔记」两个查看标签；
- 项目卡片展示介绍与下载链接，笔记可点「阅读」展开全文（含图文、代码、内嵌视频）；
- **没有任何**添加、编辑、删除、导入导出按钮，也不写访客的浏览器存储；访问分享页不会在访客机器上留下你的数据。

**安全说明**

- 公开 Gist 里只放模块数据（项目清单、快照、笔记正文与分类），**不含 Token、Gist ID、API 设置**——已通过测试验证；
- 分享页刻意**不加载**模块入口脚本、同步脚本和启动器，从代码层面杜绝编辑能力；
- 内容是他人提供的 Gist 数据也安全：正文复用先转义后白名单注入的 Markdown 渲染器，外链仅放行 `http/https`，恶意 `<script>` 会被转义显示；
- 分享页读取顺序为 `gist.githubusercontent.com` 的 raw（无 API 限流）→ 失败回退公开 Gist API，无需 Token。

> 提醒：发布即公开——放进公开 Gist 的内容任何拿到链接（或猜到 Gist ID）的人都能看到，请勿发布敏感信息。Gist 是隐藏链接而非加密，分享页也已加 `noindex` 不让搜索引擎收录，但这不等于访问控制。

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
| 公开分享页样式 / 提示语 | `assets/css/share.css`、`share.html`、`assets/js/core/share-view.js` |
| API 缓存时长 | `assets/js/core/app.js` 的 `cacheMs` |

`defaults.js` 里的清单**提交到仓库后对所有访客生效**；访客自己在页面上添加/删除的项目只存在他浏览器的 `localStorage` 里，不会改动仓库，也不会影响别人。

## 数据源与限流

- 调用两个公开接口：`GET /repos/{owner}/{repo}` 与 `GET /repos/{owner}/{repo}/releases?per_page=N`（自动排除草稿，稳定版优先、预览版靠后；页面只展示最新版本）。
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
share.html                          公开只读分享页（无编辑、无存储）
data/snapshot.json                  可选的静态兜底快照
tools/update-snapshot.mjs           一键生成 / 更新快照
assets/css/
  base.css                         全站设计系统（变量、布局、共享控件、主题切换按钮）
  theme.css                        亮色主题覆盖（data-theme="light"）
  landing.css                      引导页 / 二级页面框架样式（.lc- 前缀）
  sync.css                         同步面板样式：页头 ☁ 触发按钮 + 下拉面板（.sy- 前缀）
  share.css                        公开只读分享页样式（.sh- 前缀）
  module-repo-showcase.css         模块 01 私有样式（.rs- 前缀）
  module-notes.css                 模块 02 私有样式（.nt- 前缀）
assets/js/core/                     内核：所有模块共用，不含业务逻辑
  theme.js                         明暗主题：自动(随日出日落)/亮/暗三段切换（无依赖）
  store.js                         命名空间隔离的 localStorage 封装
  net.js                           GET JSON + TTL 缓存 + 错误归一化
  kernel.js                        事件总线 / 注册表 / 启动沙箱 / 目录渲染
  sync.js                          全自动同步调度器 + 公开分享 + 短码保险箱恢复（Gist 读写 / AES-GCM 加密 / 冲突裁决 / 面板）
  share-view.js                    公开分享的只读渲染层（无状态、无编辑入口）
  share.js                         公开分享页控制器：读取公开 Gist + Tab / 阅读切换
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
- 分类内搜索 / 排序。

> 已实现：明暗主题自动/手动切换、展示最新 Release 下载、按平台筛选（默认优先当前设备）。

> 安全说明：GitHub 返回的项目描述、Release 名称与更新日志全部经过 HTML 转义后才渲染，外链只允许 `http/https`。笔记渲染器同样先整体转义再白名单注入；视频 iframe 只接受 B 站 BV 号与 YouTube 视频 ID，图片仅放行 `http/https` 与 base64 图片，杜绝脚本注入。
