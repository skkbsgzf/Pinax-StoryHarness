# Pinax-Electron-Next M2 批次13：弹窗归一化（统一二级页）＋壳层差异清单（2026-10-28）

> 作者两条指令：①弹窗设计归一化——参照 IDE/ZCode，弹窗是统一二级页（左栏索引、右栏设置项），
> 任何功能弹窗必须被统一目录收录；②追问三栏壳层如何迁移、能否封装老代码整体迁移。
> 执行：C0（弹窗归一化）由 coder 工作流完成；**C1（差异清单）因提供方额度耗尽（BigModel 5 小时上限，19:15 重置），
> 由调度方直接完成**——纯文档任务，未续跑工作流。

## 1. C0 弹窗归一化（统一二级页）

- 新组件 `next/shell/SettingsModal.vue`：底座复用 `WorkbenchModal`（遮罩/圆角/Esc/过渡），内部左栏目录（`role=tablist`，roving tabindex＋方向键换节，词汇照抄老版 `SettingsPopup.vue:15` 的 `settings-tabs/settings-navigation`）＋右栏面板（`role=tabpanel`，`settings-section`）。
- 目录表注册制 `sections = [{ id, title, component, props? }]`，本批四节：**偏好与模型 / 载体管理 / 新建项目 / 主载体选择**（needsPrimary 自动打开且不可关，D1 硬闸）。
- 四块内容抽成独立 SFC：`next/shell/settings/{Prefs,Carriers,NewProject,PrimaryCarrier}Section.vue`——照 `AssistantDialog` 从老助手面板抽取的同一模式（结构与度量照抄、数据面经 props 注入）。`AppNext.vue` 变薄，只留挂载与 `activeSection` 状态。
- 菜单接线：`settings.preferences → prefs`、`settings.carriers → carriers`、`project.create → newProject`（都在同一弹窗内换节）。
- **「目录外弹窗不允许存在」落成机器门禁**（`visual-contract.test.mjs`）：`WorkbenchModal` 在 `next/shell` 里只允许被 `SettingsModal.vue` 挂载；`SettingsModal` 必须用老版目录词汇。任何新功能想开弹窗，只能登记进目录表——从机制上堵死"再开一个野弹窗"。
- 截图：`png/20-light-settings-modal.png`（浅色·偏好节）、`21-light-settings-carriers.png`（目录切到载体管理）、`22-dark-settings-modal.png`（深色，U12）、`23-dark-settings-newproject.png`（深色·新建项目节）。

**C0 执行方诚实边界**（原文保留）：焦点陷阱未整段搬 `useTransientLayer`（薄渲染层门禁不许引 src/ composable），Tab 走浏览器默认顺序；主载体选择标题从弹窗头移成面板内标题，弹窗头统一为「设置」；新建项目/载体管理的「无项目不开」闸保留在菜单处理器。

## 2. C1 壳层差异清单（调度方完成）

`docs/plan/next-shell-alignment-inventory-20261028.md`——回答「三端与原版差距」之问：

- **三代复用的事实**：叶子件直用（WorkbenchIcon/Tooltip，只依赖 vue+lucide）→ CSS 本体直用（5 份老样式，token 与控件词汇 100% 原件，门禁钉住）→ 骨架抽取（AssistantDialog ← 950 行老助手；SettingsModal ← 798 行老 SettingsPopup）。
- **14 项差异表**（每项给 path:line＋A/B/C 定性）：A 类（spec 裁定不追平）3 项——标签带 vs 载体板、竖条语义、右栏运行时独占；B 类（可对齐）5 项——竖条图标词汇、右栏宽度下限（老 320 vs Next 260）、焦点陷阱、索引窗内容分区、设置三缺节；C 类（缺失可补）3 项——i18n、空态文案、设置节；已一致 4 项。
- **封装迁移三级结论**：一级叶子件（成本≈0，已做）／二级骨架抽取（每个候选页 0.5–2 批，已做两次）／**三级整页插件化：R3 未裁前不可行**（老页面供血＝Pinia 7 store＋localStorage 67 文件＋IndexedDB 四类数据；整页塞进 Next 等于把浏览器轨存储体系一起搬进来，与"文件夹即数据"冲突）。正确姿势＝R3 裁决后按页适配取数口。
- **本次顺手落的一处 B 类对齐**：#3 竖条图标——novel 的 `left-dock` 图标 `book`→`outline`（老版「书稿」格用的就是 outline，`WorkspaceContentGroups.vue:23`）。

## 3. 门禁

调度方独立复跑 `verify:next`：验收 16/16、内核单测 **140/140**、外壳界面测 **44/44**、eslint 0 警、打包 a–k 全过（含 C0 新增的目录外弹窗断言与统一二级页词汇断言）。

## 4. 诚实边界

- C0 的焦点陷阱未移植（记账，B 类对齐小包待做）；主载体选择节的标题位置与弹窗头文案有位移（功能语义未变）。
- C1 未运行老前端（5173 未跑），视觉实况（悬停/焦点环/真实点击）未对照；像素级对齐需老前端在跑或作者提供截图。
- 设置面现有四节，老版七节里「写作偏好」「备份与恢复」可迁（B 类），「记忆与历史」挂 R3。
- 提供方额度（BigModel 5 小时上限）在 C0 后耗尽，C1 由调度方完成；后续如需继续派单，需等 19:15 重置或改派其它模型。
