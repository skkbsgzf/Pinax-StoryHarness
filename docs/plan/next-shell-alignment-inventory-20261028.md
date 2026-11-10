# 老壳层 vs Next 壳层：逐项差异清单与封装迁移可行性（2026-10-28）

> 回答作者之问：「三栏式架构和原版仍有较大差距，很多新增图标和暗示，结构也略有不同；
> 这部分代码是如何迁移的，能否封装老代码、视作整体组件或插件迁移过来？」
> 方法：两侧源码逐行取证（path:line），**不运行老前端**（5173 未跑）——视觉实况对照另批。
> 配套：[一致性规范 U13](./pinax-electron-next-ui-consistency-plan-20261028.md)（弹窗目录化已按本批 C0 落地）。

## 0. 结论先行

1. **Next 壳层不是"抄了一份老壳层"，是三代复用**：叶子件直用（WorkbenchIcon/WorkbenchTooltip）→ CSS 本体直用（5 份老样式，token 与控件词汇 100% 原件）→ 骨架抽取（AssistantDialog 抽自 950 行助手面板；本批 SettingsModal 抽自 798 行 SettingsPopup）。**每一代都有"引的是原件不是拷贝"的门禁钉着**（visual-contract U4/U5/U8）。
2. **"新增图标与暗示"的根因是语义变了，不是审美变了**：老竖条 = 内容工具（文件/搜索/书稿/扩展，4 格固定），Next 竖条 = 载体板（一格一个载体，来自插件注册表）。同一个 44px 竖条承载两种概念，图标只能按新概念挑。**这是 spec 裁定（两级公民模型）的直接后果，属于差异表里的 A 类（不追平）**。
3. **结构差异的三条主线**：①老版有顶部浏览器式标签带（466 行）＋Next 没有（载体内导航改为"竖条换板＋索引窗换树"）；②老版右栏是"参考/检查器"混合面，Next 右栏是运行时独占对话框（spec §2 一级公民）；③老版三区宽度记忆是 200–360/320–680（`useWorkspaceHost.js:286`），Next 是 200–360/260–640（`AppNext.vue:223-224`，差在右栏下限 320 vs 260）。
4. **封装迁移可行性分三级**：一级叶子件（已做，成本≈0）；二级骨架抽取（已做两次，**每个候选页 0.5–2 批**）；三级整页插件化（**R3 未裁前不可行**——数据供血是 Pinia+localStorage(67 文件)+IndexedDB 三重耦合，把整页塞进 Next 等于把浏览器轨的存储体系一起搬进来）。

## 1. 两侧壳层解剖

### 1.1 老壳层（`src/layouts/AppShell.vue`）

| 区域 | 实现 | 耦合 |
|---|---|---|
| 顶部标签带 | `WorkspaceTabs.vue`（466 行） | `useRoute/useRouter`（vue-router） |
| 左竖条 | `WorkspaceContentGroups.vue`（284 行），`activityItems` 四项固定（`:23`：文件/搜索/书稿/扩展） | `useRoute` + host 注入 |
| 目录窗/参考区 | `useWorkspaceHost.js` 三区可拖宽；宽度记忆 200–360（目录）与 320–680（参考，`:286`） | Pinia store + 路由 |
| 设置弹窗 | `SettingsPopup.vue`（798 行）：左栏 `nav.settings-tabs.settings-navigation[role=tablist]`（`:15`）＋右栏 `section.settings-section[role=tabpanel]`（`:33` 起七节：写作/外观/记忆/模型/体验/备份/本地项目）＋`trapFocusWithin` | `useRouter`、themeStore、i18n、backupExport、4 个 composable |
| 宿主 | 整壳是 `RouterView` 的**宿主**——所有页面走路由渲染 | vue-router 深度绑定 |

### 1.2 Next 壳层（`next/shell/`）

| 区域 | 实现 | 备注 |
|---|---|---|
| 左竖条 | `ActivityRail.vue`（54 行），图标来自载体 pane 声明的 `icon`（novel: book/writing；setting: library/list） | 一格一载体，主载体置顶（`slots.orderActivityItems`） |
| 索引窗 | `IndexWindow.vue`：四棵树（章节/大纲/构思/只读归档） | 宽度 256 默认，200–360（`AppNext.vue:223`） |
| 核心区 | `CarrierPaneHost.vue`：正文编辑器 / 条目阅读与编辑 / 构思编辑 / 大纲编辑 / 占位说明 | 纯净面（U13：无配置按钮） |
| 右栏 | `RuntimeDock.vue`＋`AssistantDialog.vue`：运行时独占对话框 | spec §2 一级公民，插件不得占用 |
| 设置面 | `SettingsModal.vue`＋`settings/` 四节（本批 C0）：左栏目录 tablist＋右栏面板 | 目录表注册制；目录外弹窗被门禁禁止 |
| 宿主 | 无路由、无 Pinia：`createIpcDispatcher` 的 IPC 合同 + `useBoardData` 单通道取数 | 薄渲染层门禁（`shell-contract`） |

## 2. 逐项差异表

| # | 差异点 | 老版做法（path:line） | Next 做法 | 性质 | 建议动作 |
|---|---|---|---|---|---|
| 1 | 顶部标签带 | `WorkspaceTabs.vue` 466 行，多标签页 + 路由同步 | 无标签带；竖条换板＝换上下文 | **A**（spec：载体内导航取代多标签） | 不追平；若作者要"多开"，立项新 spec 另议 |
| 2 | 竖条语义 | 内容工具四项固定（`WorkspaceContentGroups.vue:23`） | 载体板，来自注册表 | **A**（两级公民模型） | 不追平；图标差异是语义后果 |
| 3 | 竖条图标词汇 | 文件=`sources`、搜索=`search`、书稿=`outline`、扩展=`extensions` | 小说=`book`、设定=`library` | **B** | 可对齐：把 novel 的 `left-dock` 图标改为 `outline`（与老版"书稿"一致），成本 1 行 |
| 4 | 竖条度量 | 44/46/4/8（scoped） | 同数字（`next-shell.css` 抄本，`visual-contract` U8 钉住） | — | 已一致 |
| 5 | 右栏语义 | 参考/检查器混合面（`AuthoringDock` 孤儿＋`AuthoringKnowledgeAssistant` 在用） | 运行时独占纯对话框 | **A**（spec §2） | 不追平 |
| 6 | 右栏宽度记忆 | 参考区 320–680（`useWorkspaceHost.js:286`） | 260–640（`AppNext.vue:224`） | **B** | 对齐下限 320 |
| 7 | 索引窗宽度 | 目录 200–360 | 200–360 | — | 已一致 |
| 8 | 目录/索引窗内容 | 文件树（项目导航＋书稿章节混排） | 章节/大纲/构思/归档四棵树分区（`.workspace-nav-section`） | **B** | 可对齐：分区标题与行高已用老词汇；如需"文件视图"作第五棵树可立项 |
| 9 | 设置面形态 | `SettingsPopup` 798 行，左栏 tablist 七节 | `SettingsModal` 四节目录（本批 C0 抽出） | **C**（Next 缺 3 节：写作偏好/记忆与历史/备份与恢复） | 逐节立项迁：写作偏好→B 级（纯本地偏好）；记忆与历史→**待 R3**（依赖修订史存储）；备份恢复→B 级（文件轨可实现） |
| 10 | 焦点陷阱 | `trapFocusWithin`（`useTransientLayer`） | 未移植（薄渲染层门禁不许引 src/ composable） | **B** | 在 `next/` 内重写一份（约 40 行，不算抄），C0 已记账 |
| 11 | i18n | `tr()` 全量 | 中文直写 | **C** | 独立工单（i18n 基建 + 词表抽取） |
| 12 | 空态文案 | 各面自带引导 | 部分面为空（如散文稿大纲 warning 未上面板） | **C** | 逐面补，随功能迁移批次走 |
| 13 | 主题/缩放 | themeStore（`app_theme` + zoom 档） | 同键 localStorage（`theme.mjs`）＋`uiZoom` 偏好 | — | 已一致（缩放多一处偏好持久化） |
| 14 | 图标库 | `WorkbenchIcon`（lucide） | 同组件直用 | — | 已一致 |

**统计**：A 类（spec 裁定，不追平）3 项；B 类（可对齐）5 项；C 类（缺失可补）3 项；已一致 4 项。

## 3. 封装迁移的可行性（三级）

### 一级：叶子件直用（已做，成本≈0）
判据：只依赖 vue/lucide、无 store/router/i18n。`WorkbenchIcon`／`WorkbenchTooltip`／提示宿主三个已是这样接进来的，`shell-contract` 有白名单测试钉死"只许引这三个"。

### 二级：骨架抽取（已做两次，每候选 0.5–2 批）
判据：自洽面板，结构可照抄、数据面可替换。
- 先例 1：`AssistantDialog.vue` ← `AuthoringKnowledgeAssistant.vue`（950 行）：结构与度量照抄（块首 `legacy-copied`），数据面换成 Next 通道。
- 先例 2：`SettingsModal.vue`（本批）← `SettingsPopup.vue`（798 行）：目录解剖照抄，七节里迁四节。
- 下一步候选（成本从低到高）：写作偏好节（纯本地）→ 备份与恢复（文件轨直做）→ 世界书编辑器（4,699 行，需先裁双轨真源）→ 大纲面板（215 行，已被 B2 覆盖大半）。

### 三级：整页插件化（R3 未裁前不可行）
判据：页面能作为整体工作，且数据供血可切到文件服务。
- 代价清单（以 Authoring 3,549 行为例）：页面内的取数点全部经 Pinia store（`src/stores/` 7 个 store 全带 `defineStore`）与 `useStorage.js`（localStorage，**67 个文件**直接调用），另有 IndexedDB 四类数据（修订史/事实账本/媒体二进制/资料长文）。
- 结论：整页封装＝把浏览器轨的存储体系一并搬进 Next，与"文件夹即数据"根基冲突。**正确姿势是 R3 裁决后按页适配**：页面结构保留，取数口从 localStorage/IndexedDB 换成 Next 文件服务＋载体工具。R3 未裁，本项不立项。
- 反例记录：老桌面轨正是"整包塞进去"（打包排除 `server/` ⇒ 桌面版没有 AI），spec §1 已把这条路判为不可行。

## 4. 建议的下一步（按价值/成本排序）

1. **B 类对齐小包**（1 批可完）：#3 竖条图标 vocabulary、#6 右栏下限 320、#10 重写焦点陷阱。
2. **设置三缺节**（2 批）：写作偏好 → 备份与恢复（记忆与历史挂 R3）。
3. **视觉实况对齐**（需作者起老前端 5173 或提供截图）：本清单只到源码层；像素级对照另出工单。
4. **R3 裁决**（作者的球）：决定三级封装能否开张，也是 M2.5 唯一剩余前置。

## 5. 诚实边界

- 本清单未运行老前端，视觉实况（悬停/焦点环/滚动条/真实点击态）未对照；差异表条目均基于源码取证。
- "C 类缺失"以用户手册与老组件清单为底，未逐屏穷举老版的空态与帮助文案。
- 图标差异的 A/B 归类按 spec 两级公民模型判；若作者本意是"竖条仍应叫文件/搜索/书稿/扩展"，则 #2 应改判为需要重新裁定的 spec 变更。
