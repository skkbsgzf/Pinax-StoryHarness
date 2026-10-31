# Pinax.Next 插件开发者指南（v3 协议·以小说载体为活样板）（2026-10-31）

> 给要往 Pinax.Next 里写插件（载体）的人——包括未来的我们自己与外部开发者。
> 活样板：`next/carriers/novel/`（标杆1，批次1–46A 逐步长成）；反例与边界见各节末尾。
> 口径基线：`feat/pinax-electron-next` 批次46A（`694938f`）；协议 `pinax-carrier@3`。

## 0. 一条底层法：不注册，不行动

底座关系是单向的：**文件 → 插件 → MCP/工具面 → agent kit**。

- 插件对**自己 dataDirs 声明的目录全权负责**；想碰别人的目录，装载期就被拒（`SCOPE_OUTSIDE_OWNER`）。
- 想让模型（agent kit）用到你的能力，必须在 manifest `tools` 登记并真实实现——聚合面只收「声明 ∩ 实现」的交集，声明了没实现的进 `missingImplementations` 记账，不会虚列。
- 跨插件访问走**对方声明的工具**（MCP 语义：ListTools/CallTool 统一路由＋授权＋审计），没有后门。运行期文件层的 `DIR_CONFLICT`、模型层的写族闸（批次45 后含外部 MCP 工具）、面板桥的只读限制，三层闸全部只认注册。
- 用户禁用一块载体＝工具面收掉、pane 关闭、工作区清理、服务随重建收掉（批次45 解注册接线）。

## 1. pinax-carrier@3 字段速查

清单是 `manifest.mjs` 默认导出的冻结对象；`spec:'pinax-carrier@3'`＋`manifestVersion:3` 显式声明。校验在 `next/kernel/carrierManifest.mjs`（`validateCarrierManifest`）。

| 字段 | 形状 | 要点 |
|---|---|---|
| `id` | `pinax.carrier.<名>` | `^[a-z][a-z0-9.-]{0,79}$`；全局唯一 |
| `title`/`version`/`minKernel` | 字符串/semver | `compatibleKernel` 兼容闸 |
| `primary` | `{projectKind, defaultPane, contextProfile}` | contextProfile 必须能映射到**只读任务**（信封组装硬性要求） |
| `dataDirs` | 逻辑名→物理目录（中文真源，R1） | 一目录一逻辑名；file 权限只能申请这里面的 |
| `contributes.panes` | slot/view/kind/forms 数组 | v3 强制显式 view＋kind 成对；slot ∈ left-dock/center/overlay |
| `tools` | 工具名数组 | 装载期命名空间仲裁，撞名整份拒装 |
| `context.providers` | kind 数组＋`budgetChars` | 你的 `blocks()` 工厂只喂声明过的 kind |
| `permissions` | `[{type:'file',dir,mode}]`＋`'agent:ask'` | 越界即 `SCOPE_OUTSIDE_OWNER` 拒装 |
| `settings` | `[{id,title,type: section\|string\|number\|boolean\|enum,...}]` | 值落 `.pinax/settings.json` 每载体命名空间（批次45）；通用渲染器按 type 自动出控件 |
| **`entry`**（v3） | `{kind:'iframe', path}` | 自带面板；必须与 `pinax.view.custom` 的 pane 成对（只写一边拒装）；样板＝素材载体 |
| **`services`**（v3） | `[{id,command,args,env,cwd,port,healthPath,restart,autostart}]` | 宿主拉起的子进程（监督器：健康检查/崩溃退避重启）；样板＝comic 的 preview-server（批次48） |
| **`mcp`**（v3） | `[{id,transport: stdio\|sse,prefix,command,args,url,allow}]` | 外部 MCP 工具以 `<prefix>.<remote>` 进聚合面；allow 白名单 ≤256；样板＝comic 的 comfy 桥（批次48） |
| **`agentMd`**（v3） | 单个 `.md` 相对路径 | 作者须知，组信封时以最高优先级注入（单份 1200 字/合计 8000 字封顶）；**12 块内置载体每块都有** |

## 2. 五步接入

1. **建目录** `next/carriers/<名>/`：`manifest.mjs`＋`tools.mjs`（`impl.tools()` 工厂）＋`AGENT.md`；要进信封再写 `context.mjs`（`blocks()` 工厂，样板 `next/carriers/novel/context.mjs`）。
2. **注册**：`next/carriers/index.mjs` 的 `BUILT_IN_CARRIER_PLUGINS`（顺序＝竖条顺序）＋`BUILT_IN_CLAIMED_TOOLS`。
3. **写工具纪律**：写工具 `annotations.readOnlyHint:false`＋在 `next/runtime/kernelWriteGuard.mjs` 的 `CARRIER_WRITE_CLASS` 落点表点名（漏了 `guardCarrierWriteGaps` 门禁红）；意图域进 `next/runtime/toolSelect.mjs` 的 `DOMAINS`（不进则只有命中技能时才被披露）。
4. **测三层**：纯逻辑 `next/tests/carrier-<名>.test.mjs`（node --test）＋界面 `next/tests/*.spec.mjs`（vitest）＋`next/testing/acceptance.mjs` 的**硬编码计数同步**（toolCount/carrierTools/名字枚举——改计数必须在批次记录写理由）。
5. **过门禁**：`npm run next:build:main && npm run next:build:shell && npm run verify:next`（验收＋内核单测＋界面测＋eslint 0 警＋打包 a–n3）。带 `ui/` 或 `AGENT.md` 的载体被打包门禁 n/n2/n3 自动纳入。

## 3. 形态系统：三档 × 五态（声明什么就得到什么）

- **内容三档**（`formTaxonomy.mjs`，由 pane.kind 决定）：document 文档面／board 看板面／app 应用面（iframe）。渲染器一律归宿主，载体不自己开窗不自己弹层。
- **摆放五态**（`workspace.mjs` PLACEMENTS）：`dock` 停靠／`split` 分屏／`overlay` 悬浮（吸附卡片/气泡，每载体至多一枚 200–600px）／`fullscreen` 全屏（不隐 chrome）／`immersive` 沉浸（隐工具栏＋Agent 栏，顶栏/pane 头/Esc 三出口）。
- 在 pane 的 `forms` 数组里声明你支持哪几态；用户在竖条右键菜单里选。不声明＝该态不出菜单。
- 悬浮吸附（如「大纲卡片吸在正文旁」）就是 `slot:'overlay'` 的 pane——样板＝大纲载体的悬浮小窗。

## 4. 活样板：novel 载体拆解

以 `next/carriers/novel/` 为例（标杆1）：

- **工具面**：`pinax_chapter_list/read/save`（修订号三道闸）＋`pinax_proposal_list/read/discard`＋`pinax_chapter_delete/rename`（批次46A：删改前强制快照、未审提案保护）——读 4 把＋写 4 把＋提案 3 把，每把都有归属闸。
- **context**：`writing-chapter` 档产章节正文块；主 profile 映射到只读任务 `authoring.review.chapter`（审查本章骑的就是它）。
- **agentMd**：`AGENT.md` 三段式——数据在哪、工具有哪些、规矩几条。写它的标准：模型只读这一份就知道怎么用你的载体。
- **settings**：`novel.writing` 节（应用级偏好，历史原因）——新插件请直接用声明制（批次45 通用渲染器＋`.pinax/settings.json` 项目级命名空间）。
- **提案轨**：模型在 review 档调你的写工具→转 tool-call 提案（`.pinax/proposals/`）→作者在提案审阅面采纳/弃用。**不要在工具实现里自己造审批**，写策略是底座的职责。

## 5. 纪律清单（评审员会对照工单逐条查）

1. 只改工单允许的文件；`server/**`、`src/**` 是只读来源。
2. 断言/计数漂移必须写理由，不许静默放宽。
3. 零新 npm 依赖（载体目录内的桥/服务脚本用 node 内建）。
4. 行尾别整文件翻转（`.gitattributes` 已管 next/**，但别依赖它兜底）。
5. 收尾自查守卫标记（既有修复不许丢——最新清单见最近一张工单的「守卫标记」节）。
6. 不执行 git 命令、不起 electron——提交、实拍、验收归调度方。

## 6. 已知边界与挂账（写插件前先看有没有撞上）

- 编辑器是 textarea（md 单真源，R1）；PM 块编辑器/行内 ghost/批注是协议级岔口，未裁。
- 面板桥只读＋自有板；「面板 JS 调另一块载体的工具」的跨板授权声明制是 v3.1 议题（`permissions.tools:<namespace>`），未落。
- 外部 MCP 写工具按**名字后缀启发式**（`_save/_write/_import/_delete/_create/_update`）进写族——你的外部工具命名请避开这些后缀除非它真是写操作；非写后缀的提交类工具（如 `comfy_submit`）review 档直执行＋审计环记账是有意裁定。
- 数字设置的 min/max/step 渲染已就绪但校验器白名单未放开声明字段（潜伏能力）。
- `.pinax/settings.json` 外部直改不热感知（与 workspace.json 同语义）。

——本指南随协议演进而改；下一版覆盖 v3.1 跨板授权与外部插件目录发现（标杆2 真接批后补）。
