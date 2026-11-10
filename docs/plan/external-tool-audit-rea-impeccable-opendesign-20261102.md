# 外部工具对接审计：rea ／ impeccable ／ OpenDesign 怎么看我们的界面与框架

日期：2026-11-02　范围：只读分析，未改任何界面代码，未 commit
对照目标（作者口径）：① Obsidian 式高可玩性 Doc 栏　② 1＋N 多形态切换 UX 丝滑可用　③ 所有设计语言统一且简洁

产物落点：本文（账）＋ `_tools/` 下全部原始证据（命令与路径见 §7）

---

## 1. 结论先行

三个目标里，**只有一个半是"做得不到位"**，其余是"看不见"：

**目标②（丝滑）——实测有硬伤，但不是慢，是跳。** 每切一次载体（竖条图标），布局位移 CLSΔ 固定 **0.1245**，位移源始终是 `col-center`；14 步操作里 4 步命中同一数值（A1／A2／A8／A10——切载体、竖条还原、竖条恢复索引窗），其余 10 步非 0 即 ≤0.0024。同一批操作里，树行的过渡是 120ms、窗控按钮是 150ms、而竖条本体是 **`transition: 0s`**——三套时长来自两个不同的 CSS 归属，切换动作因此"瞬间重排 + 别处渐变"，丝滑感断在这一条上。响应层反而是过关的：INP 最大 16ms、无长任务、无 console error、390/768/1440 三档均无横向溢出。

**目标①（Obsidian 式 Doc 栏可玩性）——功能在，可读性不在。** 同一章标题「第002章-槐巷」在核心区 DOM 里渲染 **3 次**（页签 `span.nx-page-tab-label`、窗题 `span.nx-pane-window-title`、正文 `h2.doc-title`）；采样的 633 个文本节点里 **444 个字号 <12px**（11px 是快捷词／会话徽标／模式徽标／工具 `code` 片的缺省）；内部词汇直接外泄到标题栏——chip 原样输出「项目名 · 载体 id · 第 N 版」，1440 下实测文本是 **「雨夜靶场 · novel · 第 1 版」**（`next/shell/AppNext.vue:573-580`），tab flag「第 1 版」，徽标把整句「审阅模式：AI 产出走提案，确认后才落盘」压成 40×21 的 chip。蓝链与反向链接（批次38）是可玩性的正向资产，本轮未发现回归。

**目标③（设计语言统一且简洁）——三个工具从三个方向指到同一个洞：我们没有可被机器读到的设计语言。** OpenDesign 的 `token-map` 原子实测：拿我们 Next 自己的 8 个 `--nx-*` 当目标体系，只覆盖源 token 袋的 **3.0%（2/67）**；拿老前端继承面 306 个 CSS 变量当目标，覆盖 **26.9%（18/67）**；再把 OD 看不见的 32 个 `.vue` 补进源，降到 **22.2%（18/81）**，63 条进 `unmatched.json`。全仓 **找不到 DESIGN.md / manifest.json / tokens.css**（脚本 find 结果为空），因此 impeccable 的 4 条 `design-system-*` 漂移规则处于失效状态，OD 的官方设计系统形态我们无法表达。另有明确缺陷：`--accent-primary` 在 `src/`＋`next/` 源码里被引用 **144 次、40 个文件**、**全仓零定义**（含 `setProperty` 动态注入也是 0 命中），其中 **100 次的 `var()` 没写兜底**（`src/components/authoring/AuthoringBlockComposer.vue:249-299` 是最典型的一片）；Next 侧只有 2 次且都写了 fallback（`AssistantDialog.vue:552,554`），所以这个洞目前咬的是老前端，不是我们的外壳——但它证明"变量名可以随便被发明"。

反过来也有两条"其实不差"的证据，免得这账被读成全盘否定：OD 自家的 anti-slop 闸 `od lint` 对我们活页面判 **0 个 P0**（无紫渐变／无 emoji 图标／无编造指标／无填充文案，`_tools/od-run/od-lint.json`）；`od lint` 按文件归位后，**`next/shell/styles/next-shell.css` 根外裸色值为 0**，进入 Next 渲染面的 **134 条裸 hex 全部来自继承层**——`src/styles/main.css`(42)＋`themes/legacy.css`(92)，另有 54 条在 Next 故意不引的 `experience-reading.css`（`_tools/od-run/od-lint-attribution.json`，总数口径差 3 条见 §5.4）。也就是说问题不是界面有 AI 味，而是**这套审美的所有权没有落成一份机器可读的规范，且渲染时大量取值仍在绕过词汇表**。

**框架层（REA）——我们比 Obsidian 干净，但代价是"别人读不动"。** Obsidian 在 `obsidian.asar` 里有 **42 个唯一字面 IPC 通道名 / 118 个字面调用点**（通道名是 OS 级的：`frame`、`relaunch`、`vault-open`、`documents-dir`）；我们是 **56 条通道常量全集中在 `next/shell/ipcContract.mjs`，注册只有一句** `main.mjs:775` 的通用 dispatcher，`preload.mjs:14-17` 再用白名单挡未注册通道。结构上我们更收敛、可枚举、可版本化；但 REA 在这种"动态通道名 + 单入口分发"上覆盖不足（`next/` 分析 253 文件、coverage 多族 `partial`、`semantic_unknowns` 72,882、语义节点触顶 100,000），意味着第三方插件生态与 AI 工具理解我们界面契约的成本由我们承担。

**三个工具各自的盲区必须先记账，否则"没报问题"会被当成"没问题"：** impeccable 的正则扫描只吃 `.css/.js/.vue`，**`.mjs` 完全不在表内**——而 `next/`（不含 `.build`）有 **238 个 `.mjs`／56,030 行**，是它扫描面（35 文件）的十几倍，所以"静态扫 0 发现"等于没测；它自己也在输出里写死这句："findings are an undercount, not a clean bill of health"。OD 的 `code-import` 把 `.vue` 判为 `unsupported-extension`（`next/` 跳过 32 个、全仓跳过 250 个），skiplist 不认我们的 `.build`，且 `od lint` 只看首个 `<style>` 块；REA 全程未解析任何 `.vue`（summary 里 `.vue` 命中 0 次）。反过来，运行时口径（真页面）才是有效的：impeccable 在 8471 活页面上报出 **3 条 low-contrast**，而我自己第一版扫描因为四舍五入把同一条漏了（见 §10-P1）。

---

## 2. 三个工具的官方 agent 对接方式（怎么用的，逐条可复现）

### 2.1 rea（morluto/rea，npm `rea-agents` 6.8.0，MIT）

官方对接是 **MCP server + CLI**，注册命令 `npx rea-agents setup`；静态 JavaScript/Electron 反推不需要原生引擎。本机 node v24.14.0 低于 `engines` 要求的 `^22.23.4 || ^24.22.1 || >=26.12.1`，npm 只报 EBADENGINE 告警、CLI 可跑（如实记账，不宣称合规）。它的产物是带 `evidence_id` 的证据包 JSON，配 `inspect_analysis_view` / `trace_application_feature` 读取。

跑到两个对象上：Obsidian 的 `resources/obsidian.asar`（24,060,763 B）与我们的 `next/`。两边产物分别是 `_tools/obsidian-core-evidence.json`（84,081,784 B）、`_tools/pinax-next-evidence.json`（222,449,715 B）。

它的自陈限制决定了能引用什么、不能引用什么（`_tools/obsidian-core-rea.md` 尾段 24 条 / `_tools/pinax-next-rea-summary.md` 尾段 23 条）：「JavaScript and HTML were parsed as inert text; bundle bootstrap code was never executed」「missing findings do not establish absence」「Dynamic IPC channel expressions remain unresolved」；Obsidian 侧「Caller-selected source analysis leaves 33 inventoried files outside analysis scope」并因 `lib/codemirror/modes.min.js` 触发 `Analysis operation timed out after 300000ms`（我主动把范围收到 `app.js/main.js/enhance.js`）。

### 2.2 impeccable（pbakaus/impeccable v4.8.0）

官方对接是 **装成 agent 的技能包**：`npx impeccable install --providers=qoder --scope=project -y`，落到本仓 `.qoder/skills/impeccable/**`（22 MB，含 `scripts/bin/windows-x64/impeccable.exe`）。24 条命令（`init/document/critique/audit/polish/bolder/live…`），外加一个 **62 规则确定性检测器**（`npx impeccable detect`，exit 2 = 有发现）。对桌面/Electron 应用的官方口径写在 `reference/audit.md`：起 `--remote-debugging-port=9222`，再 `impeccable detect --cdp 9222 --target <页面 URL 或标题片段> --json`。

本轮跑了静态扫（源码）与运行时扫（vite dev 5273、手机预览 8471 的活页面），`audit.md` 要求的五维评分是 A11y / Performance / Theming / Responsive / Implementation Integrity。会改稿的命令（`live` / `polish` / `bolder`）没跑——那属于开工，不在本轮口径。

静态扫的输出（`_tools/impeccable-detect-next.txt`、`impeccable-detect-next.json`）本身就把盲区写在了脸上，原话照抄：

> `35 files scanned with regex matching only (.css, .js, .vue).`
> `Rules that need a parsed page (tiny-text, low-contrast and other element rules) did not run on them; findings are an undercount, not a clean bill of health.`

分母要说清：`next/`（不含 `.build`）实际有 **238 个 `.mjs`／56,030 行**＋32 个 `.vue`＋1 个 `.css`＋2 个 `.js`，而它只吃 35 个文件——**我们 Next 的主体（`.mjs`）100% 不在它的扩展名表里**，静态 0 发现等于没测。只扫 `next/shell` 时它报 `33 files scanned (.css, .vue)`、exit 0、无发现。

按它提示的那条官方出路试了一次：在工作目录放 `.impeccable/config.json` = `{"detector":{"extensions":[{"ext":".vue","engine":"html"}]}}`（本轮实例外壳是 `_tools/.impeccable/`，验完把文件改名成 `config.vue-html-engine.json` 留档，免得下次 detect 意外走这条路；要启用时文件名必须回到 `config.json`。没有写进仓）。效果是 `.vue` 改走 HTML 引擎、只剩 1 个 `.css` 走正则；结果是 **0 发现**——但这是引擎局限而非清白：静态 SFC 文本没有计算样式，`low-contrast`／`tiny-text` 这类元素规则拿不到 `getComputedStyle`。要真值只能扫活页面（下一段）。

运行时命中（5273 exit 2、8471 exit 0 全为 advisory）：5273 报 **2 条**——`p.dock-hint` `3.2:1 (need 4.5:1) — #b48a45 on #ffffff` 与 `tiny-text 11px`；8471 `--json` 报 **3 条 low-contrast advisory**——`p.nx-index-empty` 4.49:1、`span.nx-page-tab-label` 4.49:1、`textarea::placeholder`「就当前项目问一句话…」4.4:1，全部是 `#6b7078`（＝`--text-muted`）落在浅底上（`_tools/impeccable-detect-8471.json`）。两个口径交叉核对过（§5.3）：它报的前两条我自己的第一版扫描漏了（成因见 §10-P1）；反过来我的复核还抓到第 4 条——`span.nx-titlebar-chip`（16px）4.49——impeccable 没报，原因不可考（它没文档化去重规则，本文只记差异不编解释）。另外 4 条 `design-system-*` 规则只在存在 `DESIGN.md` 时激活，我们没有，故整族失效。

### 2.3 OpenDesign（nexu-io/open-design 0.25.1，Apache-2.0）

`open-design` 在 npm 上是 404（`npm view` 实测：Unpublished），仓库 `package.json:7` 标 `private: true`，所以只能从源码起。它的官方 agent 对接其实有四张脸：

1. **`od` CLI ＋ MCP 代理**：`bin.od → apps/daemon/bin/od.mjs`，而 `od.mjs:11-15` 缺 `dist/cli.js` 就直接抛错并要你先 `pnpm bootstrap`；`od mcp --daemon-url <base>` 只是把 MCP 请求代理给**活着的 daemon**，不能独立用。
2. **原子契约**：`plugins/_official/atoms/<id>/SKILL.md` 是给 agent 读的指令体（daemon 把它渲染进 prompt），产物形状写死在文档里。
3. **设计系统数据形态**：`design-systems/<id>/{manifest.json, DESIGN.md, tokens.css, design-tokens.json}` ＋ `docs/design-systems.md` §3/§7 的写作规范与合规清单。
4. **无模型依赖的 headless 质量闸**：`od lint`（anti-slop artifact linter，`--fail-on p0|p1|p2|none`，官方说明就是"可以 gate cron/CI 渲染流水线"）。

**daemon 本轮没有部署**，成本有五条磁盘证据：`apps/daemon/package.json:36-71` 依赖 `better-sqlite3`、`node-pty`（需原生编译，本机无 VC++）；`package.json:42-45` `engines: node ~24, pnpm >=10.33.2 <11`（本机无 pnpm，仅 corepack 0.34.6）；root `postinstall → scripts/postinstall.mjs` 要按序 build **18 个 workspace 目标**；`QUICKSTART.md` 把 Windows 列为"支持但见 docs/windows-troubleshooting.md"；跑 critique 流水线还需要 BYOK 模型键。

**替代路径（本轮实际做的）**：直接调用它自己的 atom 与 linter 源码——`node --experimental-strip-types` ＋一条 `.js→.ts` 解析钩子（`_tools/od-run/register.mjs`、`hooks/js-to-ts.mjs`）。跑了两条官方链路：

1. `code-import → design-extract → token-map`（`_tools/od-run/run.mjs`、`vue-gap.mjs`）。三个 atom 文件都只依赖 node 内置模块（`code-import.ts:19-20`、`token-evidence.ts:1`），所以能在无 daemon、无 pnpm 的情况下原样执行。
2. `od lint`（`_tools/od-run/lint.mjs`、`lint-attr.mjs`）。命令契约写在 `apps/daemon/src/cli.ts:1252-1257`——"Run the daemon's anti-slop artifact linter … **(no model/agent calls; headless-safe)**"，实现是单文件 `apps/daemon/src/lint-artifact.ts:120`（`lintArtifact(rawHtml)`，自陈"deliberately greppy … does NOT parse HTML"）。这条**不需要模型键、不需要 daemon**，正好是 OD 官方 agent 口里唯一能本机直跑的质量闸口径。

另外确认它的 MCP 口确实只是代理：`od mcp [--daemon-url <url>]` 的帮助文本原话是 "Run a stdio MCP server that **proxies project tool calls to a running OpenDesign daemon**"（`apps/daemon/src/cli.ts:1282-1288`），注册用 `od mcp install <agent>`（`:2911`）——daemon 不起，MCP 就没有内容。

---

## 3. 目标①：Obsidian 式的高可玩性 Doc 栏

### 3.1 达标的部分（有证据，不空夸）

- 三栏外壳与"一块板＝一载体＝一树＋一文档"的口径落在代码里，注释可追（`next/shell/AppNext.vue` 头部；竖条行为写在 `:1518-1519`）。
- 命名/可点性：整轮采样 **unnamedControls = 0**（`_tools/sweep-result.json` → `aggregates`），即所有可点控件都有 aria-label 或文本；键盘序 12 个停靠点里 **10 个有 2px 焦点环**，第 11 个是助手输入 textarea（`outline: 0`，但由容器 `:focus-within` 环接管，见下一条），第 12 个是 `BODY`。
- 助手输入的焦点指示是容器级 `:focus-within` 环（`AssistantDialog.vue:582`），环色 `--workbench-focus` 有定义（`src/styles/themes/legacy.css:68` 亮题 `#677580`／`:767` 暗题 `#a9bac6`）。按 WCAG 1.4.11 非文本对比 ≥3:1 复算：亮题环色对 `#f3f3f2` 是 **4.27:1**，暗题环色对 `#1b1c1e` 是 **8.55:1** → 不构成 OD `craft/accessibility-baseline.md:84-94` 说的"移除 outline 三重失败"。（同一条算式也告诉我们 §5.3 那个 4.49 灰字是"文本档"要 4.5，环是"非文本档"只要 3，两档别混。）
- 首屏不是问题：first-paint **32ms**、FCP **116ms**、DCL 107ms、load 134ms，中文字体请求在 83→111ms 完成，早于 FCP（`_tools/forensics-out.txt`）——**不存在 FOUT，不要拿这条当理由改稿**。

### 3.2 不到位的（按 OD 五维与实测排序）

| # | 缺口 | 证据 | 判据来源 |
|---|---|---|---|
| 1 | 同一标题在核心区渲染 3 次（页签／窗题／正文 h2），阅读面出现自我重复 | `_tools/forensics-out.txt`「共 3 处」+ 选择器三条 | OD `craft/typography-hierarchy.md:15-24`「One dominant entry point」；`anti-ai-slop` 的重复即噪声 |
| 2 | 70% 文本节点 <12px（444/633），11px 承担快捷词、会话计数、模式徽标、工具名 `code` 片 | `_tools/sweep-result.json` `tinyText_lt12`（含 distinct selectors） | impeccable `tiny-text` 规则；OD `accessibility-baseline.md:39-53`（18px 以下按正文算 4.5:1） |
| 3 | 内部词汇与状态直接外泄：标题栏 chip 原样打印「项目名 · 载体 id · 第 N 版」（实测「雨夜靶场 · novel · 第 1 版」）、tab flag「第 1 版」、徽标整句「审阅模式：AI 产出走提案，确认后才落盘」 | `next/shell/AppNext.vue:573-580`（`projectChip` 计算式）＋`_tools/contrast-recheck.json` 该节点实测文本、`sweep3.json` A3 target「正文/第002章-槐巷.md · 第 1 版」 | 设计语言"简洁"由作者反复声明；OD `craft/color.md:61-74` 同类"命名要按用途不按实现"精神 |
| 4 | 索引窗的收起/展开与"开该载体的文档窗"复用同一格竖条（再点同一格＝收起索引窗），状态迁移没有独立可见入口 | `next/shell/AppNext.vue:1518-1519`；`sweep3.json` A9 `found:false`（收起后「收起索引窗」按钮消失） | 目标①"高可玩性"要求动作可发现，而非只可达 |
| 5 | 长任务（真模型调用）无取消、无 15s 变慢提示：`busy` 期只有 `role="status"` 思考行与禁用按钮，错误后才有「重试」 | `AssistantDialog.vue:441,462,408`；`next/` 源里 `AbortController` 仅 `next/runtime/modelPlaneProbe.mjs` | OD `craft/state-coverage.md:91-106`（10–30s 要 determinate progress＋cancel；60s+ 停动画）；`:11-50` 五态齐备 |
| 6 | 窄屏（390）Doc 栏被助手压扁：核心区 390×325，助手 dock 390×439，**辅助面比正文还高**；768 同样倒挂（412 vs 532） | `_tools/narrow-probe.json` `center` / `dock` | 目标①是"Doc 栏为主"，倒挂即优先级表达错 |

---

## 4. 目标②：1＋N 的多形态切换，UX 丝滑可用

### 4.1 位移账（这是"不丝滑"的主因）

`_tools/sweep3.json` 14 步逐动作测量（真浏览器、trusted input `page.mouse.click`，Event Timing 只在 trusted 输入下计入 INP）：

```
步骤                     控件盒     transition           CLSΔ      位移源
A1 载体→设定与资料        44x46     0s                   0.1245    col-center
A2 载体→小说（回 1）      44x46     0s                   0.1245    col-center
A8 竖条还原              44x46     0s                   0.1245    col-center
A10 竖条恢复索引窗        44x46     0s                   0.1245    col-center   INP 16ms
A3 打开章节              215x36    0.12s,0.12s          0
A4 页内切页              215x36    0.12s,0.12s          0
A7 收起为侧缘标签        24x36     0.15s×3              0.0024    nx-page-tab is-form-tab
A11 全书查找             22x22     0.12s                0.0014    nx-tree
A12 快捷词               45x22     0.15s×3              0
A13/A14 主题切暗/亮      44x46     0s                   0
```

三件事同时成立才造成"跳"的感觉：竖条本体 `transition: 0s`（切换瞬间发生）、中栏整列重排（`col-center` 承担 100% 位移）、而周边元素各自有 120/150ms 过渡。WCAG 意义上的阈值不是本轮判据（作者口径是"丝滑"），所以这里 **0.1245 只记账、不当隐形闸**；但位移是结构性、每次同值、且来源单一，属于一行布局改动就能压掉的那类问题。

### 4.2 动效度量不统一

`next/shell/styles/next-shell.css` 只有 4 条 transition（`:203 :468 :1026 :1534`，全部 120ms）；窗控/按钮的 150ms 来自继承的老前端 CSS。OD 的收敛值判据写在 `craft/animation-discipline.md:36-50`：**150ms 是跨设计体系缺省值**，hover/press 这类高频微交互应 ≤200ms。我们两条都合规，问题是**同一次交互里 0s 与 120ms 与 150ms 三种并存**，观感就是"有的地方会动、有的不会"。
`prefers-reduced-motion`：老 CSS 有 10 处保护块（如 `src/styles/workbench-controls.css:174`、`workspace-navigation.css:79`），**Next 自己的 CSS 只有 1 处**（`next-shell.css:1539`，且只护 `.nx-focus-mask`）→ 系统开了减少动效的用户，仍会吃到我们外壳的过渡。

### 4.3 "1"与"N"在界面上不可分辨（这是"可用"层面的缺口）

预览项目落盘状态是 `D:/next-preview/雨夜靶场/.pinax/workspace.json`：`active.main = null`、`active.side = novel.editor#1`、`focus: "side"`，两条 entry 的 `group` 都是 `side`——即**主页组是空的，所有窗都在侧页组**。这是批次61 的正常落盘态，不是 bug；缺口在于：

- 界面上没有任何常驻标记告诉你"你现在在侧页组，主页组没有基座"。唯一的线索藏在窗菜单的动词对里：`next/shell/PaneWindow.vue:81` `group==='side' && form==='page' ? '移回主页组' : '移到侧页组（对半）'`。
- 实测后果：A5／A6 两步（"移到侧页组"→再分一组）在菜单里 `found:false`——因为已经在 side 组，入口按状态隐藏；A9（"收起索引窗"）在收起后也 `found:false`。**动作集合随状态增减，但状态本身不可见**，用户只能靠"点一下看动词有没有变"来反推自己在哪里。
- 对侧的 Obsidian 用工作区标签/分隔条的**常驻可见性**表达同一件事，这是它"1＋N 用得顺"的直接原因。

### 4.4 响应与稳定性（达标，别自己吓自己）

INP 最大 16ms、longtask 计数 0、14 步全部 console errors 0、`_tools/sweep-result.json` `errors: []`、390/768/1440 三档 `overflowX = 0`。首屏资源 **1959 kB**（`forensics-out.txt` `totalResourceKB`，按传输量累加，含 IPC 响应与列表外的其它请求；资源列表只截前 10 条）。磁盘侧可自行核对：`next/.build/renderer-next/assets/` 三个产物 1,153,375／194,706／607,096 B ＝ 1127／190／593 kB，合计 1,955,177 B。**JS 是未压缩单 chunk。** **包体没有渲染层闸**：`next/testing/bundleAssertions.mjs:103` 只闸主进程 bundle <6 MB、`:174-175` 闸 shell <2.5 MB，`:183-187` 把 renderer js 体积写在"依赖薄"这条断言的消息里记账，**不设数值闸**。

---

## 5. 目标③：所有设计语言统一且简洁

### 5.1 OpenDesign 官方原子跑出来的覆盖率（可复现，非我估算）

源 token 袋 = OD `design-extract` 对我们 `next/` 的产出（`_tools/od-run/next/code/tokens.json`，67 条：color 23／typography 8／spacing 19／radius 11／shadow 6，扫 245 文件）。

| 目标设计系统（活跃词汇表） | 命中 | 覆盖率 | unmatched |
|---|---|---|---|
| A：Next 自有 8 个 `--nx-*`（`next/shell/styles/next-shell.css` `:root`） | 2 / 67 | **3.0%** | 65（63 no-target-equivalent + 2 target-collision）；命中只在 spacing 桶（色 23／字 8／间距 17／圆角 11／阴影 6 全部查无对应） |
| B：老前端继承面 306 个 CSS 变量（`src/styles/*.css` + `themes/`） | 18 / 67 | 26.9% | 49（47 no-target-equivalent + 2 target-collision）；命中＝色 5／字 3／间距 9／圆角 1／阴影 0 |
| B′：把 OD 看不见的 32 个 `.vue` 补进源后对 B | 18 / 81 | **22.2%** | 63（60 no-target-equivalent + 3 target-collision）；按类＝色 18／圆角 17／间距 15／阴影 8／字体 5 |

`target-collision`（两个源值抢同一个目标 token）最能说明"不统一"：`#6b7078` 与 `#969ba3` 都指向 `--text-muted`，后者被判 collision 后进 `unmatched`（`_tools/od-run/map-full/token-map/unmatched.json` hint `"target --text-muted already mapped from #6b7078"`；B′ 口径共 3 条这类）。补 `.vue` 这一步为什么必要：OD 的 `code-import` 把 32 个 `.vue` 判 `unsupported-extension`，我按 `language:'html'` 喂进它自己的收集器复算（`vue-gap.mjs`）——`.vue` 单独映射命中 **8/34（23.5%）**，并进源后总命中仍是 18（值与 CSS 侧重复），但分母从 67 变 81、unmatched 从 49 变 63。也就是**外壳 SFC 里新出现的 14 条取值，一条都没有词汇表对应**。这就是"盲区必须记账"的具体形态：不补这一步，OD 会告诉我们一个更高的假覆盖率。

对照 Obsidian：它的 `app.css`（`_tools/obsidian-app.css`）有 **1049 个 token、其中 1007 个语义命名**，成族的变量表（`background-modifier` 15、`button-primary/secondary` 各 12、`color-base` 12…）。我们 Next 自有 **8 个**，且 `definedButUnused = 0 / usedButUndefined = 61`（`_tools/design-census.json` `ourTokens`）——即外壳渲染实际依赖 61 个由别人定义的变量。

### 5.2 设计语言的"机器可读面"整体缺失

- 全仓无 `DESIGN.md`（`run.mjs` 的 find 结果为空数组），无 `manifest.json`／`tokens.css`。OD 的合规清单（`docs/design-systems.md:240-242`）要求三件齐备且一致、`DESIGN.md` 至少 7 个实质 H2；impeccable 的 4 条 `design-system-*` 漂移规则同样只在有 `DESIGN.md` 时生效。**两个工具独立指向同一个洞。**
- 但要说清洞的性质：OD 的 `od lint`（它自己的 anti-slop 闸，`cli.ts:1252-1257`）对我们活页面判了 **0 个 P0**（`_tools/od-run/od-lint.json`）——没有紫渐变、没有 emoji 图标、没有编造指标、没有填充文案。也就是说问题不是"界面很 AI 味"，而是**同一套审美的所有权没有落成一份可读的规范文件**（详见 §5.4 与 §5.1）。
- `--accent-primary` **全仓零定义**：`grep -rn -- "--accent-primary:"` 只命中本文自己那行，`setProperty('--accent-primary', …)` 动态注入 0 命中；而引用侧在 `src/`＋`next/` 源码里共 **144 次、40 个文件**，其中 **100 次的 `var()` 没写兜底**——裸用时 `color-mix(in srgb, var(--accent-primary) 18%, …)` 整条声明在计算值阶段失效，`border-block`／`outline` 这类简写回落到缺省，视觉结果不可预测（最集中的一片是 `src/components/authoring/AuthoringBlockComposer.vue:249,250,257,270,281,299`，另有 `WritingNotebookEditor.vue` 10 处、`EntryMdEditor.vue` 5 处）。要说清责任面：Next 只引用 2 次且都写了 fallback（`AssistantDialog.vue:552,554`），Next 实际加载的 6 份 CSS **一处都没有**引用它——所以这个洞现在咬的是老前端，不是我们的外壳；但它证明"任何组件都可以发明一个不存在的变量名"，而这正是目标③要治的。
- 字面量分两层看。**CSS 层是守纪律的**：`next-shell.css` 68 处 `font-size: var(--nx-fs-*)`、0 处字面字号、0 处根外裸 hex（§5.4 同一口径独立确认）。**破口在 SFC 的 `<style>` 里**：`.vue` 内散落 7 处字面字号（`AssistantDialog.vue:533,549,551,553,590,596`＋`CarrierPaneHost.vue:2139`）与 4 处字面圆角 px（`AssistantDialog.vue:544,553,581`＋`CarrierPaneHost.vue:2136`；另有 3 处 `border-radius: 50%` 是圆形而非 token，不计）。px 取值种类最集中的三个文件：`shell/styles/next-shell.css`（45 种）、`shell/AssistantDialog.vue`（36）、`shell/CarrierPaneHost.vue`（18）（`_tools/design-census.json` `worstFiles`）。**12 种 distinct 字面色（共 16 处）全部不在 CSS 而在 `.mjs`**——`shell/main.mjs` 11、`carriers/comic/preview-server.mjs` 3、`shell/exportService.mjs` 2，含 `#1a1a1a`×2 与 `#6b6b6b`×2 这类近似色并列；这一层恰好落在 impeccable 的扫描盲区（它不读 `.mjs`），所以"它没报"不等于"没有"。

### 5.3 可点尺寸与对比（AA 底线）

OD 把线画得很清楚：`craft/accessibility-baseline.md:64-79` —— **AA 是 24×24 CSS px（SC 2.5.8）**，44×44 是 AAA；该文 §"Common mistakes" 还专门点名"把 44×44 当 AA 是错的"。按 24×24 判：

- 实测不达标可点控件 **23 个**（`sweep-result.json` `touchTargets_lt24`，跨 12 个状态去重后 5 类选择器），典型（`_tools/narrow-probe.json` `clickableSmall`，按视口分档）：桌面 1440 下 `新建资料`／`新建约束` **22×22**、`关闭…这一页` **20×36**；窄屏 390/768 下同一批按钮 **20×44**；`快捷词` **45×22**、`审阅模式` 徽标 **40×21**（两档同值）。小于 44×44 的有 147 个（AAA 口径，记账）。
- 对比度：**本节的结论被复核改写过一次，两次都留档。** 我第一版扫描（`sweep.mjs`，12 状态 633 节点）报 `<4.5:1` 为 **0 条**；那是**假绿**——脚本在 `:91` 先 `Math.round(ratio*10)/10` 再在 `:189` 用 `< 4.5` 过滤，4.487 被进位成 4.5 后放行了。impeccable 用两位小数，于是它报出的东西我的扫描报不出。改用保留两位的复核脚本重扫（`_tools/contrast-recheck.mjs` → `_tools/contrast-recheck.json`，1440×900、8471 活页面、62 个自有文本节点）：
  - **3 条真文本低于 AA，全部是同一个灰字**：`span.nx-titlebar-chip`（16px，「雨夜靶场 · novel · 第 1 版」）4.49、`p.nx-index-empty`（12px）4.49、`span.nx-page-tab-label`（13px）4.49；前景一律 `rgb(107,112,120)` ＝ `--text-muted` `#6b7078`，背景 `#f3f3f2` 系浅面。
  - `textarea::placeholder`「就当前项目问一句话…」＝ **4.37**（impeccable 报 4.4，同一条）。
  - 5273（未接桥的开发面）另有 `p.dock-hint` **3.15**（impeccable 报 3.2）与一条 chip 4.49；`p.dock-hint` 是 11px 开发面向导文案。
  - 结论要改口径说：**正文（`--text-primary` 系）确实没被击穿，但"灰字"这一档在浅色板下系统性差 0.01 不够 AA**——这是一处 token 级修法而不是逐元素补丁：按同一算法复算，`--text-muted` 从 `#6b7078`（4.488）改到 `#6a6f77` 即 4.554 过线，`#676c74` 是 4.759（留余量）。旧结论"真实正文没有对比度问题"保留在此作为踩坑记录，见 §10-P1。
  - 顺着这一个 token 摸到了目标③最硬的一条量化证据：**同一个语义名 `--text-muted` 在继承层有 4 个定义**——`src/styles/main.css:102`（`:root` 纸色亮题）`#8d7f70`、`src/styles/main.css:171`（`.theme-dark` 暖暗题）`#7d7165`、`src/styles/themes/legacy.css:14`（蓝钢亮题，Next 当前实际生效）`#6b7078`、`src/styles/themes/legacy.css:714`（`.theme-legacy.theme-dark`）`#969ba3`。按各自主题的底色复算对比度是 **3.37 / 3.93 / 4.49 / 6.10**——四档里三档不过 AA，最好一档是最差一档的 **1.8 倍**。`next/shell` 有 **116 行**在引用这个变量（`grep -rn -- "--text-muted" next/shell | wc -l`），外壳并不知道"灰字"该是什么灰。这一条同时解释了 §5.1 里 OD 判的 `target-collision`（`#6b7078` 与 `#969ba3` 抢同一个目标名），也解释了为什么 impeccable 的 `low-contrast` 只在浅色下命中。

---

### 5.4 OpenDesign 官方 `od lint` 对我们界面的机器判词（第三个独立口径）

输入是活页面（8471 预览桥，1440×900，打开一章后的 `page.content()`，17,732 字符／UTF-8 落盘 18,953 B，存 `_tools/od-run/shell-live.html`）与"DOM＋把 `src/styles`／`themes` 目录下**全部** CSS 与 `next-shell.css` 内联成 `<style>`"两份（`shell-live-plus-css.html`，偏差已在脚本头登记；注意这一份的覆盖面比 Next 实际加载的 6 份 CSS 大，所以 191 这个总数必须按文件归位才有意义，见下表）。结果（`_tools/od-run/od-lint.json`、`od-lint-attribution.json`）：

```
0 个 P0（无紫渐变、无 emoji 图标、无编造指标、无 lorem 式填充文案）
2 个 P1：raw-hex（根外裸色值 191 条）、all-caps-no-tracking（.panel-header 全大写但字距 <0.06em）
1 个 P2：missing-section-anchor（<section> 缺 data-od-id）——这是 OD 自家批注协议的规则，对我们不适用，不计缺陷
页面加载期间 pageerror：0
```

按文件拆开定位 P1，结论比总数有用得多：

| 文件 | 根外裸 hex | 备注 |
|---|---|---|
| `next/shell/styles/next-shell.css` | **0** | Next 自己的 CSS 在 OD 的 anti-slop 口径下是干净的 |
| `src/styles/main.css` | 42 | 含 `.panel-header` 的全大写无字距 |
| `src/styles/themes/legacy.css` | 92 | 主题面裸值最集中 |
| `src/styles/experience-reading.css` | 54 | **Next 不引这一份**（`next/shell/styles/legacy.mjs:13-18` 明写故意跳过） |
| `workbench-controls.css` / `workspace-navigation.css` / `workspace-surfaces.css` / `interface-language.css` | 0 | — |

即**进入 Next 渲染面的根外裸色值约 134 条（42＋92），全部来自继承层，一条都不是 Next 自己写的**。这条与 §5.1 的 token-map 覆盖率是两件事：覆盖率低是"我们自己的词汇表太小"，裸 hex 是"实际渲染大量绕过词汇表"。两者同因——设计语言住在老前端里，Next 只是在借用。

两个计数口径要交代清（`_tools/od-run/probe-hex.mjs`、`probe-hex2.mjs` 实测）：整体拼成一个 `<style>` 块时 OD 报 **191**，逐文件各跑一次相加是 **188**（42＋92＋54），差的 3 条出现在拼接边界，属该 linter 自陈的"deliberately greppy、不解析 HTML"带来的计数差，不改变任何归属结论（Next 侧仍是 0）。同一段实验还量到一条**工具行为**：把 8 份 CSS 拆成 8 个并列 `<style>` 块时 `raw-hex` 直接报 0——它只看首个样式块。所以"按文件归位"必须一文件一进程单跑，这也是 `lint-attr.mjs` 的写法；顺带，内联进 artifact 的 8 份 CSS 共有 **236** 个 hex 字面量，191 是其中落在 `:root` 之外的部分。

顺带确认一个此前的担心不成立：本次 `od lint` 输出里没有 `sans-display`（缺省无衬线做展示体）与 `filler-copy`（填充文案）两条 P0 发现，说明我们的正文面没踩 AI 味最重的那两条。

---

## 6. 框架面（REA）：我们和 Obsidian 的结构差，以及它的代价

| 维度 | Obsidian（`obsidian.asar` 实测） | Pinax Next（源码实测） |
|---|---|---|
| IPC 通道名 | 42 个唯一字面名 / 118 个字面调用点（`frame`、`relaunch`、`vault-open`、`documents-dir`、`create-browser-session`…）。**这条不是 REA 的产出**，是我对 `obsidian.asar` 直接 `grep -a -o 'ipc[A-Za-z]*\.[a-zA-Z]*("[A-Za-z0-9_-]*"'` 的结果（方法归属见 §10-P5） | 56 条通道常量全部集中在 `next/shell/ipcContract.mjs`，命名统一 `pinax:agent:*`（唯一字符串 57 个） |
| 注册方式 | 分散在各功能模块按名注册 | **一句**通用注册：`next/shell/main.mjs:775` `ipcMain.handle(channel, async (_e, payload) => slimForIpc(await dispatcher.dispatch(channel, payload)))` |
| 渲染层护栏 | 无统一白名单（按名调用） | `next/shell/preload.mjs:14-17` 用 `ALLOWED_REQUEST` 挡未注册通道，并回结构化错误码 `PINAX_INVALID_INPUT` |
| 数据面 | vault 逻辑大量留在渲染层（REA 里 `sources_seen 31`，`application_routes: unknown`） | 一切经 IPC 过主进程；`.pinax/workspace.json` 落盘四轴状态（批次61） |
| REA 覆盖 | 3 文件入选、33 清单项未进范围、`modes.min.js` 300s 超时中断 | 253 文件入选、coverage 各族 `partial`、`semantic_unknowns 72,882`、语义节点触顶 100,000 |

判读：我们的收敛是**架构优点**（单一入口、白名单、可版本化协议），但同一件事让**外部可理解性变差**——REA 明说「Dynamic IPC channel expressions remain unresolved」「missing findings do not establish absence」，也就是说任何第三方（含 AI 工具）要靠静态分析摸清我们的界面契约都会得到"部分覆盖"。目标①的"高可玩性"如果指望插件生态，这条是隐性成本。

---

## 7. 复现清单

```bash
# REA（CLI 与 MCP 同一套动词；本机跑 CLI，命令是 kebab-case）
npx -y rea-agents@latest doctor
npx -y rea-agents@latest analyze-javascript-application "<asar 或解包目录>" \
  --detail summary --evidence_output D:/Pinax-main/_tools/xxx-evidence.json \
  [--source-path app.js --source-path main.js] [--analysis-timeout-ms 300000]
npx -y rea-agents@latest inspect-analysis-view '{"source":{"kind":"retained-evidence","evidence_id":"ev_…"},"view":{"kind":"javascript","collection":"modules","projection":"references","offset":0,"limit":20}}' \
  --evidence-bundle D:/Pinax-main/_tools/xxx-evidence.json
# 它另有官方取证口可服务"要认证不要附和"：capture-web-screenshot / capture-browser-scenario（Playwright 场景回 Evidence）/ compare-application-versions

# impeccable（官方 skill 安装 + 确定性检测器；目标是位置参数，可混排文件/目录/URL）
npx -y impeccable@latest install --providers=qoder --scope=project -y
npx -y impeccable@latest --list-rules                 # 62 条规则目录
npx -y impeccable@latest detect next/ --json          # 静态：报「35 files scanned … only .css, .js, .vue」
npx -y impeccable@latest detect http://localhost:5273/            # 运行时（vite dev）
npx -y impeccable@latest detect http://127.0.0.1:8471/ --viewport 390x844   # 运行时（手机预览桥，窄屏档）
# 桌面应用官方口径（reference/audit.md）：起窗口后
#   impeccable detect --cdp 9222 --target <页面 URL 或标题片段> --json

# OpenDesign 原子链路（不装 daemon，Node 24 类型擦除 + .js→.ts 钩子）
cd D:/Pinax-main/_tools/od-run
node --experimental-strip-types --import ./register.mjs run.mjs        # code-import→design-extract→token-map
node --experimental-strip-types --import ./register.mjs vue-gap.mjs    # 补 .vue 盲区后的同一链路
node --experimental-strip-types --import ./register.mjs lint.mjs       # 官方 od lint：抓活页面 → lintArtifact
node --experimental-strip-types --import ./register.mjs lint-attr.mjs  # 把 P1 按文件归位
node --experimental-strip-types --import ./register.mjs probe-hex.mjs  # 191 vs 188 的计数口径差
node --experimental-strip-types --import ./register.mjs probe-hex2.mjs # 证明 OD 只看首个 <style> 块

# 我们自己的测量
node _tools/sweep3.mjs        # 14 步逐动作 CLS/INP/longtask/transition/aria 面
node _tools/narrow.mjs        # 390 / 768 / 1440 排布与命中区
node _tools/forensics.mjs     # 首屏时间线 + 重复文本取证（→ forensics-out.txt）
node _tools/design-census.mjs # token 普查（8 自有 vs 61 继承 vs Obsidian 1049）
node _tools/contrast-recheck.mjs  # 两位小数对比度复核（修 P1 那类假绿）
node next/testing/bundleAssertions.mjs   # 我们的打包门禁（全绿）
# 前置：运行时口径（impeccable detect 的 URL 扫、sweep/narrow/forensics、od lint 的活页面）
# 需要一个活页面——8471 桥本轮收尾已停，复现时先 `node D:/next-preview/serve-next-preview.mjs`；
# vite dev 5273 仍在（[::1]:5273），但它是"未接主进程桥"的开发态，界面结论请以 8471 为准。
```

主要产物：`_tools/{sweep3,design-census,narrow-probe,sweep-result,forensics-out,obsidian-core-rea,pinax-next-rea-summary}`、`_tools/{impeccable-detect-next.txt,impeccable-detect-next.json,impeccable-detect-vite5273.txt,impeccable-detect-8471.json,contrast-recheck.json}`、`_tools/.impeccable/config.vue-html-engine.json`（§2.2 那条官方出路的实例，故意放在仓外不污染仓库）、`_tools/od-run/{summary.json,vue-gap.json,od-lint.json,od-lint-attribution.json,shell-live.html,shell-live-plus-css.html,next/code/tokens.json,map-full/token-map/*.json}`、`_tools/shots/*.png`（15 张，含 `fresh-desktop-1440/fresh-tablet-768/fresh-phone-390`）。

---

## 8. 待裁定（本轮不动手）

| # | 议题 | 我的倾向（仅供裁） |
|---|---|---|
| A | 补 `DESIGN.md` + 把 `--nx-*` 从 8 扩到覆盖 63 条 unmatched | 这是同时解开 OD 设计系统形态与 impeccable 漂移规则的一把钥匙；先只做文档＋词汇表，不改视觉 |
| B | 载体切换的 0.1245 位移：给 `col-center` 宽度过渡，还是固定列宽消掉重排 | 先消位移源，再谈统一 150ms；数值只记账不设闸 |
| C | 「1／N 在哪一组」的常驻可见化（工作区级标记，不只靠菜单动词对 `PaneWindow.vue:81`） | 需要设计稿，属于目标②的正脸 |
| D | 竖条 `transition: 0s` 与外壳 120ms／继承 150ms 归一，并给 Next CSS 补 `prefers-reduced-motion` | 归一到 150ms 缺省＋高频 ≤200ms |
| E | 444/633 个 <12px 文本节点、11px 是否收进字号 token | 与 A 同批裁，避免二次改 |
| F | 真模型长跑补 15s 变慢提示 + 取消（`AbortController` 目前只在探针里） | 按 OD `state-coverage.md:91-106` 分档实现 |
| G | 渲染层 1127 kB 未压缩单 chunk（1,153,375 B）、无体积闸 | 只加"记账进复核清单"，不设自动打回（作者既往裁决） |
| H | 23 个 <24×24 可点控件（含 22×22 新建资料/约束） | AA 底线，优先 |
| I | 窄屏倒挂：助手 dock 比核心区高（390：439 vs 325；768：532 vs 412）＋标题栏「帮助」右缘 335 压到项目 chip 左缘 155（chip 文本见 §3.2-3） | 需要一条窄屏排布规则，与批次9 同族 |
| J | 内部词汇外泄（`nov`、`第 1 版`、整句徽标）与标题三重渲染 | 文案层，风险低、观感收益高 |
| K | 是否真要部署 OD daemon（原生编译＋pnpm＋BYOK 键）——还是继续只用它的 `craft/` 手册与原子契约 | 建议后者：本轮已拿到它全部的判据价值，daemon 只多一个自动打分流水线 |
| L | `.qoder/skills/impeccable/**` 22 MB 未跟踪，`.gitignore` 没排除它 | 三选一：入库／加忽略／卸载 |
| M | 手机预览服务 `8471` 无鉴权（`D:/next-preview/serve-next-preview.mjs`），本轮为测量一直开着 | **本轮收尾已停**（PID 488 已杀，curl 000 为证）；下次要复现运行时口径需重新 `node serve-next-preview.mjs`，并决定要不要给它加 token 或改绑 `127.0.0.1`。vite `5273` 实测只绑 `[::1]`，不构成暴露，未停 |
| N | 继承层 134 条根外裸 hex（`src/styles/main.css` 42／`themes/legacy.css` 92）动不动 | 老轨按作者裁定只收 bugfix，**不建议为它单开工**；建议在 A（DESIGN.md＋扩表）时把这些值一次性收进 token，Next 侧零成本受益 |
| O | 是否把 `od lint`（0 模型、headless、`--fail-on` 可 gate CI）与 `impeccable detect` 接进 `verify:next` | 二者都是纯确定性检查、能接在提交链路上；但要先解它们的盲区（`.mjs`／`.vue`），否则是假绿。先只做"记账进复核清单"，不设为打回条件（作者既有裁决） |
| P | `--text-muted` 一个名字 4 个值（3.37／3.93／4.49／6.10），其中浅色三档不过 AA | token 级一行改：先让 4 个定义收敛成"一名一值＋主题覆盖表"，浅色档提到 ≥4.5。属目标③最小可验证动作，可并入 A 那把钥匙一起做 |

---

## 9. 本轮边界（如实声明）

改了什么：**仓内源码零改动**，本轮我在仓内只落了两个东西——这份 md，以及官方安装器落下的 `.qoder/skills/impeccable/**`（`du -sh` 实测 22 MB，含 `scripts/bin/windows-x64/impeccable.exe`）。`npm run next:build:renderer` 重新生成的 `next/.build/renderer-next` 不入库（`.gitignore:108` 忽略 `next/.build/`）。所有测量脚本与证据都在仓外的 `D:/Pinax-main/_tools/`。未 commit（按既有口径，无明确指令不提交）。

一条必须说清的仓库现状：`git status --porcelain` 当前是 **249 条**（95 改／9 删／145 未跟踪），HEAD 还停在 `36b0fe2 chore: 首次入库快照（Pinax.Next 至批次41）`。**这些改动不是本轮做的**——是并行会话把批次 42→61 推在同一个工作树里、尚未入库。所以本轮的任何"前后对比"都不能拿 git 当批次级 A/B 基线，只能拿磁盘实物当证据；这也是本文所有数字都附 `_tools/*.{json,txt}` 出处的原因。

没测到的：impeccable `audit.md` 对桌面应用要求的 **`--remote-debugging-port=9222` 真 Electron 窗口 CDP 测量没跑**——本轮界面测量走的是同源 HTTP 桥预览（8471）与 vite dev（5273），两者都不是打包态，因此**原生菜单、窗口级 IPC、iframe 承载位（批次44）在本轮结论之外**。OD daemon 未部署（成本证据见 §2.3）。impeccable 会改稿的命令（`live`/`polish`/`bolder`）未跑。

工具盲区（别让"没报"读成"没有"）：impeccable 不扫 `.mjs`；OD `code-import` 跳过 `.vue`（next/ 32 个、全仓 250 个）且不认 `.build`；OD `od lint` 只看首个 `<style>` 块——8 份 CSS 拆成 8 个并列块时 `raw-hex` 报 0（`probe-hex2.mjs` 实测），所以按文件归位必须逐文件单跑；REA 未解析任何 `.vue`、在动态通道名上显式承认无法解、Obsidian 侧 33 个文件未进范围且有一次 300s 超时。**语义层判断（"这个入口好不好找""这个重复该不该留"）仍是人裁，本文只保证每条判断都有磁盘出处。**

收尾（已执行，可核）：测量用的 **`8471` 手机预览桥已停**——`Stop-Process -Id 488 -Force`（命令行是 `node serve-next-preview.mjs`），停后 `curl http://127.0.0.1:8471/` 返回 `000`（连不上）。**vite dev `5273` 保留**：`netstat -ano -p tcpv6` 实测它只绑 `[::1]:5273`（PID 3576，IPv6 环回），不在局域网暴露面里；且并行会话可能正用它跑 `next:dev`，代杀会踩别人的现场。它的去留并入 §8-M 一起裁。

---

## 10. 本轮踩坑账（每条都是自己的错，带出处）

| # | 坑 | 症状 | 根因与出处 | 处置 |
|---|---|---|---|---|
| P1 | **自己的扫描器把结论洗白了** | `sweep-result.json` 报 `<4.5:1` 文本 **0 条**，而 impeccable 报 3 条 | `_tools/sweep.mjs:91` 先 `Math.round(ratio*10)/10`，`:189` 再 `ratio < 4.5` 过滤 → 4.487 进位成 4.5 被放行 | 新增 `_tools/contrast-recheck.mjs`（保留两位）重扫，§5.3 结论改写；教训：**判据比较必须在未舍入的原始值上做** |
| P2 | **取证脚本的截断被当成了原文** | 文中一度写「标题栏显示 `雨夜靶场 · nov`」 | `_tools/narrow.mjs:20` 对菜单项 `slice(0, 10)`，中文 4＋分隔 3＋`nov` 正好 10 字符；真实文本是 `项目名 · 载体 id · 第 N 版`（`next/shell/AppNext.vue:573-580`） | §1／§3.2／§8-I 改成原文并标注截断来源；几何结论（x=155 与 帮助 r=335 重叠）不受影响 |
| P3 | **递归没 await，盲区量化第一次算成 0** | `vue-gap.mjs` 首跑只扫到 13 个文件、0 token | 目录遍历时 `walk(abs, out)` 未 await，子目录尚未走完就返回 | 改 `await walk(abs, out)`；复算得 `.vue` 单独 34 token、并入后 81 token／294 文件 |
| P4 | **以为 OD 报的是全量 CSS** | 拆成 8 个并列 `<style>` 块后 `raw-hex` 突然变 0 | `lintArtifact` 自陈"deliberately greppy … does NOT parse HTML"，只取首个样式块（`_tools/od-run/probe-hex2.mjs` 实测） | 归位改为"一文件一次进程单跑"；同时记下拼接口径 191 与单文件求和 188 差 3 条，属同一 greppy 边界的计数差 |
| P5 | **把工具能力记成了工具结论** | 一度写"REA 检出我们 6 条 IPC 通道" | 两份证据包（84 MB／222 MB）里 grep `pinax:agent:`／`ipcMain.handle` 字面量 **0 命中**——REA 不把动态通道名存成字面量，且它自己声明「Dynamic IPC channel expressions remain unresolved」 | 撤回该归属：Obsidian 的 42 名／118 点改为**直接 grep `obsidian.asar`**（方法写在 §6），REA 只用于其自陈覆盖度；符合"因果声明也要证据" |
| P6 | **静态 0 发现被读成干净** | `impeccable detect next/` exit 0、`[]` | 它只吃 `.css/.js/.vue`（`next/` 实际 238 个 `.mjs`／56,030 行），且 banner 自己写着 "findings are an undercount, not a clean bill of health"；按它提示把 `.vue` 切 HTML 引擎后仍 0 发现——静态 SFC 没有 computed style | 界面结论一律改走活页面 URL 扫描（5273／8471），静态扫只作为盲区记账 |
| P7 | **复现命令凭记忆写** | 初稿 §7 写 `impeccable detect --url …` | 真实 CLI 是位置参数 `detect [file-or-dir-or-url...]`，另有 `--viewport/--cdp/--target/--list-rules` | 跑 `--help` 与 `--list-rules`（62 条、v4.8.0 已核）后改写；发布前命令必须实测 |
| P8 | **单位混用把加法做错了** | 「1959 kB ＝ JS 1127＋CSS 190＋woff2 593」对不上（差 49） | 1959 是 `forensics-out.txt` 的传输量累加（含 IPC 响应，资源列表只截前 10 条），1910 是磁盘三产物的 KiB 和（1,955,177 B） | §4.4 与 §8-G 统一成"B／kB 注明、磁盘与传输分开" |

