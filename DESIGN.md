# Design System: SHELF / ONLINE（MongoDB 风格）

> 本项目视觉规范。设计语言取自 [HU-UH/awesome-design-md · MongoDB](https://github.com/HU-UH/awesome-design-md/blob/main/design-md/mongodb/DESIGN.md)，
> 结合 SHELF / ONLINE 的纯静态、本地优先定位裁剪落地。所有取值均已写入代码，
> 本文是唯一权威来源：改样式先改令牌，再改本文；新增组件必须复用现有令牌。

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

SHELF / ONLINE 是「森林黑 × 霓虹绿」的深林终端体验——底色不是纯黑，而是 MongoDB 的森林黑
`#001e2b`（带青调的极深色），营造出数据库般的密度与林冠般的纵深。在这个近黑画布上，
霓虹绿 `#00ed64` 作为唯一品牌强调色点缀：亮到有电击感，又保留有机的生命力。这不是冷峻的赛博朋克霓虹，
而是黑暗中正在生长的生物的萤光。

字体体系以**国内系统自带字体**为主、零网络依赖：无衬线 **苹方 / 微软雅黑**（`PingFang SC / Microsoft YaHei`）承担 Hero、区块大标题、正文与 UI 的全部层级；
系统等宽字体（`ui-monospace / SF Mono / Consolas`）承担代码与大写技术标签，字距放宽到 1–3px，形成「数据库字段标签」般系统化、结构化的技术标识感。
衬线 `--serif`（宋体 / 思源宋体）作为令牌保留备用，但当前 Hero 与大标题统一走 `--sans`，保证跨设备字重与字距一致。不引入任何 Web Font CDN，国内网络下首屏无字体加载失败风险。

系统采用**双模式双主题**：暗色主题（森林黑 + 霓虹绿）对应 MongoDB 的 dark hero 世界；
亮色主题（白底 + 青灰边框 + 深绿功能色）对应 light content 世界。两者都可随时切换，且各自遵循 MongoDB 配色语言。
阴影统一带青调 `rgba(0, 30, 43, .xx)`——即使在浅色表面，阴影也带着森林的颜色，而非中性灰黑。

**Key Characteristics:**
- 森林黑底 `#001e2b`，不用纯黑
- 霓虹绿 `#00ed64` 为唯一强调色，克制使用（每段最多一处高光）
- Hero / 区块大标题 / 正文统一用苹方 / 微软雅黑无衬线（`--sans`）
- 衬线 `--serif` 仅作令牌备用，当前不用于任何可见文字
- 系统等宽字体大写标签，宽字距 1–3px
- 零 Web Font 依赖，只用国内系统自带字体
- 青色调阴影，禁止中性灰黑投影
- 药丸按钮（999px / 100px 圆角）
- 霓虹绿 2px 强调下划线为签名装饰

---

## 2. Color Palette & Roles（调色板与角色）

### 暗色主题（默认 · 森林世界）— `base.css :root`
| 角色 | 变量 | 取值 | 用途 |
|------|------|------|------|
| Forest Black | `--bg` | `#001e2b` | 主背景，带青调极深色 |
| Deep Teal | `--surface` / `--surface-2` | `rgba(28,45,56,.78)` / `rgba(29,47,58,.82)` | 卡片、面板表面 |
| Silver Teal | `--line` / `--line-soft` | `rgba(184,196,194,.16)` / `.08` | 描边、分隔线 |
| MongoDB Green | `--accent` / `--line-strong` | `#00ed64` / `rgba(0,237,100,.42)` | 霓虹绿强调、强描边 |
| MongoDB Green dim | `--accent-dim` | `rgba(0,237,100,.10)` | 强调底色、选中态 |
| Teal Active | `--accent-2` | `#1eaedb` | 活性青次要强调 |
| Link Blue | `--blue` | `#6cb8ff` | 链接（深底提亮变体） |
| 冷白 | `--text` / `--text-2` | `#f2f7f5` / `#b8c4c2` | 主 / 次文字 |
| Cool Gray | `--muted` | `#7f9297` | 弱化文字 |
| Warn / Danger | `--warn` / `--danger` | `#ffc46b` / `#ff8197` | 警告 / 危险语义 |
| 反色文字 | `--on-accent` | `#001e2b` | 霓虹绿实底上的文字 |

### 亮色主题（light content 世界）— `theme.css`
| 角色 | 变量 | 取值 |
|------|------|------|
| 背景 | `--bg` | `#eef2f8`（极浅冷调） |
| 表面 | `--th-surface*` | `#ffffff` / `#f4f8f5` / `#e8edeb` |
| 主文字 | `--th-text` | `#001e2b`（森林黑） |
| 次文字 | `--th-text-2` / `--th-muted` | `#3d4f58` / `#5c6c75` |
| 描边 | `--th-line` | `rgba(28,46,43,.16)` |
| Dark Green | `--th-accent` / `--th-line-strong` | `#00684a` / `rgba(0,104,74,.5)` |
| Action Blue | `--th-blue` | `#006cfa` |
| Teal Active | `--th-accent-2` | `#1eaedb` |
| Forest Shadow | `--th-shadow` | `0 12px 34px rgba(0,30,43,.13)` |

### Logo（品牌标记 · 随主题变色）
Logo 是唯一的品牌图形标识（页头 `>._` 终端标记），背景色必须走令牌、随明暗主题切换，禁止硬编码旧薄荷绿 `#1D9E75`。
| 部分 | 令牌 | 暗色主题 | 亮色主题 |
|------|------|----------|----------|
| 圆角方块背景 | `--logo-bg`（= `--accent`） | `#00ed64` 霓虹绿 | `#00684a` 深绿 |
| 终端图形描边 | `--logo-ink` | `#001e2b` 森林黑 | `#ffffff` 纯白 |

前景取背景的反色保证对比度：霓虹绿底配森林黑图形，深绿底配白图形。切换走 `fill/stroke` 的 `.25s` 过渡。
favicon 是浏览器独立加载的 SVG、读不到页面主题变量，故备两套文件 `assets/brand/logo.svg`（暗）/ `logo-light.svg`（亮），
由 `theme.js` 的 `apply()` 随有效主题切换 `<link rel="icon">` 的 href。

### Shadows（青色调阴影）
| 令牌 | 取值 | 用途 |
|------|------|------|
| `--shadow-card` | `0 12px 30px rgba(0,30,43,.34)` | 卡片悬浮 |
| `--shadow-panel` | `0 18px 44px rgba(0,30,43,.55)` | 浮层面板 |
| `--shadow-forest` | `0 26px 44px rgba(0,30,43,.32), 0 7px 13px rgba(0,0,0,.20)` | Hero 级大卡 |
| `--glow-accent` | `0 0 12px rgba(0,237,100,.35)` | 霓虹绿发光 |
| `--th-shadow` | `0 12px 34px rgba(0,30,43,.13)` | 亮色主题投影 |

---

## 3. Typography（字体排印）

### 字体族（国内系统自带字体，零网络依赖）
- **Display / Body / UI**：苹方 / 微软雅黑（`--sans`）— Hero、区块大标题、正文与 UI 全部层级；栈为 `PingFang SC, Microsoft YaHei, -apple-system, Segoe UI, Noto Sans CJK SC, sans-serif`
- **Code / Labels**：系统等宽字体（`--mono`）— 代码与大写技术标签；栈为 `ui-monospace, SF Mono, Menlo, Consolas, Courier New` + CJK
- **Serif（备用令牌）**：`--serif` = `Songti SC, STSong, Noto Serif CJK SC, Source Han Serif SC, SimSun, Georgia, serif`；当前无可见元素使用

三级字体全部取自操作系统，不加载任何外部字体文件，国内网络与离线环境下均正常显示。

### 层级
| Role | Font | Size | Weight | Line-height | Letter-spacing |
|------|------|------|--------|-------------|----------------|
| Hero | 苹方 / 微软雅黑（--sans） | `clamp(46px,7.6vw,84px)` | 500 | 1.14 | -.02em |
| Section Heading | 苹方 / 微软雅黑（--sans） | `clamp(27px,3.8vw,44px)` | 500 | 1.2 | -.015em |
| Shelf Heading | 苹方 / 微软雅黑（--sans） | `clamp(30px,4.2vw,46px)` | 500 | 1.2 | -.015em |
| Lead | 苹方 / 微软雅黑 | `clamp(14.5px,1.5vw,17px)` | 400 | 1.95 | normal |
| Body | 苹方 / 微软雅黑 | `--fs-body: 13px` | 400 | `--lh-base: 1.6` | normal |
| Tech Label | 系统等宽字体 | `--fs-caption / --fs-mini` | 500 | normal | 1.2–2.2px 大写 |
| Code Micro | 系统等宽字体 | `--fs-micro: 9px` | 600 | 2.67 | 2.5px 大写 |

字号阶梯 `--fs-*`（11 级）、行高阶梯 `--lh-*`、字重阶梯 `--fw-*` 定义在 `base.css :root`，是全站唯一来源，
新增样式一律引用变量，不写死 px。

### 原则
- 大字也用无衬线：Hero 与区块标题统一 `--sans`，全站不使用衬线字面
- 大写宽字距是身份：`--mono` + `text-transform: uppercase` + 1–3px 字距 = 数据库字段标签质感
- 四级字重：400 正文 / 500 UI 与大标题 / 600 强调 / 700 CTA

---

## 4. Component Stylings（组件样式）

### Buttons（药丸按钮）
- **主按钮** `.btn--primary`：霓虹绿渐变 `linear-gradient(120deg, #00ed64, #00c853)`，森林黑字，药丸圆角，
  霓虹绿投影 `0 4px 22px rgba(0,237,100,.22)`；hover 提亮为 `#2bff85 → #00d65a`
- **次按钮** `.btn` / `.lc-btn`：透明底 + `--line` 描边 + 药丸 999px 圆角；hover 霓虹绿描边 + 青调阴影
- **亮色主题主按钮**：深绿渐变 `#00845f → #00684a` + 白字（避免白字压亮绿看不清）
- 激活筛选胶囊 `.is-active`：霓虹绿渐变（暗）/ 深绿渐变（亮）

### Cards & Containers（卡片与容器）
- 暗色：`--surface` 深青表面 + `--line` 描边；亮色：白底 + 青灰描边
- 圆角 `--radius: 16px`（标准卡片）、`--radius-sm: 8px`（小控件）
- 投影用青调 `--shadow-card` / `--shadow-panel` / `--shadow-forest`
- 置顶卡：`0 0 0 1px rgba(0,237,100,.14)` 霓虹绿描边 + 置顶角标

### Inputs & Forms（输入与表单）
- 输入框 `--line` 描边 + `--radius-sm` 圆角；focus 用霓虹绿 `0 0 0 3px rgba(0,237,100,.08)`
- 占位符用 Cool Gray，不用偏蓝灰

### Distinctive Components（特色组件）
- **霓虹绿强调下划线**：`.accent-underline` = `2px solid var(--accent)`；区块标题用 `::after` 居中 72px 霓虹绿短线 + 发光
- **Hero 渐变文字**：`.lc-hero h2 em` 用 `#00ed64 → #6cb8ff` 渐变裁切文字
- **Source Code 标签**：`.lc-eyebrow` / `.lc-kicker` 大写宽字距等宽体，荧光绿字
- **同步状态胶囊**：`.sy-status-pill` 药丸形，同步成功态用霓虹绿描边

---

## 5. Layout Principles（布局原则）

### Spacing System
- 基础单位 8px；常用阶梯 4 / 8 / 12 / 16 / 24 / 32px
- Hero 上下留白充裕（暗色区块 80px+），内容区块更紧凑

### Grid & Container
- 内容居中、最大宽度约束；卡片网格 2–3 列
- 首页只做产品介绍，功能模块集中在 `shelf.html`
- 深色 Hero/引导层 + 浅色内容层的明暗对比塑造节奏

### Border Radius Scale
| 值 | 用途 |
|----|------|
| 8px `--radius-sm` | 输入框、小按钮 |
| 16px `--radius` | 标准卡片、容器 |
| 999px | 药丸按钮、胶囊标签、状态标记 |
| 50% | 圆点、状态灯 |

---

## 6. Depth & Elevation（层次与高度）

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | 无阴影 | 默认表面 |
| Level 1 | `--shadow-card` | 卡片悬浮 |
| Level 2 | `--shadow-panel` | 浮层面板（设置/同步/下拉） |
| Level 3 | `--shadow-forest` | Hero 级大卡，青调双层阴影 |
| Glow | `--glow-accent` | 霓虹绿发光点 |

**Shadow Philosophy**：主投影用 `rgba(0, 30, 43, .xx)` 青色调，把森林黑的品牌色带进深度系统——
即使在白底上，阴影也「属于」MongoDB 的色彩世界，而不是通用中性黑。

---

## 7. Do's and Don'ts

### Do
- 用 `#001e2b` 森林黑做深底，不用纯黑
- 霓虹绿 `#00ed64` 每段只用一次，追求最大电击感
- Hero / Display 标题与正文统一用苹方 / 微软雅黑（`--sans`）
- 系统等宽字体大写 + 1–3px 宽字距做技术标签
- 阴影一律青调 `rgba(0,30,43,...)`
- 按钮用药丸圆角，浅底强调用深绿 `#00684a`

### Don't
- 不用纯黑 `#000000` 做背景 —— 一律森林黑 `#001e2b`
- 不把霓虹绿铺成大面积背景 —— 它只做文字、下划线、小高光
- 不用中性灰投影 —— 一律青调
- 全站不套衬线字体，大字小字一律 `--sans`
- 不缩小技术标签字距 —— 宽字距就是身份

---

## 8. Responsive Behavior（响应式）

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile Small | <425px | 紧凑单列，Hero 24px |
| Mobile | 425–768px | 标准移动端，按钮换行 |
| Tablet | 768–900px | 双列网格开始 |
| Desktop | >900px | 标准布局 |

- Hero 随宽度缩放 `clamp()`，始终保持无衬线质感与统一字距
- 药丸按钮保留充裕触控 padding
- 明暗模式在所有尺寸下保持各自配色，不混用

---

## 9. Agent Prompt Guide（给 AI Agent 的快速参考）

### Quick Color Reference
- 深底：`#001e2b`　霓虹绿：`#00ed64`　深绿功能色：`#00684a`
- 链接蓝：暗底 `#6cb8ff` / 亮底 `#006cfa`　活性青：`#1eaedb`
- 浅底文字：`#001e2b`　深底文字：`#f2f7f5` / `#b8c4c2`
- 浅底描边：`rgba(28,46,43,.16)`　深底描边：`rgba(184,196,194,.16)`
- 青调阴影：`rgba(0,30,43,.34)`

### Example Component Prompts
- "Hero on forest-black `#001e2b`: PingFang/Microsoft YaHei (`--sans`) headline `clamp(46px,7.6vw,84px)` weight 500, white text with keyword in `#00ed64→#6cb8ff` gradient. Same sans subtitle 17px. Neon-green pill CTA `#00ed64→#00c853`."
- "Card on white: `1px solid rgba(28,46,43,.16)`, 16px radius, shadow `0 12px 30px rgba(0,30,43,.34)`. System-mono uppercase label 2px tracking above a PingFang/Microsoft YaHei 36px title."
- "Tech label: system mono, uppercase, letter-spacing 2px, weight 500, `#00ed64` on dark."
- "Pill button: neon-green gradient, forest-black text, 999px radius. Hover brightens."

### 落地文件索引
| 关注点 | 文件 |
|--------|------|
| 全局令牌（暗色） | `assets/css/base.css` `:root` |
| 亮色令牌与覆盖 | `assets/css/theme.css` |
| 首页 | `assets/css/landing.css` |
| 笔记模块 | `assets/css/module-notes.css` |
| 开源应用模块 | `assets/css/module-repo-showcase.css` |
| 预留模块 | `assets/css/module-one-more-thing.css` |
| 同步面板 | `assets/css/sync.css` |
| 字体栈 | `assets/css/base.css :root` 的 `--serif / --sans / --mono`（国内系统字体，零网络依赖） |

### Iteration Guide
1. 先定模式：深底 `#001e2b` 还是浅底白
2. 霓虹绿每段只用一次，克制才有电击感
3. 全站统一无衬线（苹方 / 微软雅黑），不用衬线字面
4. 技术标签大写宽字距，数据库字段质感
5. 阴影一律青调，让深度也属于森林世界
