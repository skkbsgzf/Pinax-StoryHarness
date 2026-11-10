# Pinax-Electron-Next M2 批次20：顶部菜单四组制＋设置归类＋pane 协议落地（2026-10-28）

> 作者指令：①顶部栏精简（「运行时」「视图」很奇怪；保留项目/设置/帮助，最多加一个）；②设置弹窗归类（参照 Obsidian：搜索框＋分组目录，账号/项目/字体外观完全可归类）。
> 执行：workflow coder（DeepSeek flash）三单全绿；调度方验收（与批次19 合并态独立复跑 203/203＋70/70）。

## 1. 交付

**A 顶部菜单四组制**：MENU_TEMPLATE 七组→四组——「项目」（新建/打开/导入/备份/文档历史/打开提案目录/退出）、「编辑」（undo/redo/cut/copy/paste/selectAll 全部补 id `edit.*`，main.mjs 映射到 webContents 方法——页内菜单行因此可用）、「设置」（偏好与模型/载体管理/切换主题）、「帮助」（规范/门禁＋DevTools/重载从视图迁来）。删组：视图（焦点×3 记账、缩放已在偏好节且与 native zoom 双轨冲突）、运行时（入口在右栏）、窗口（系统窗控）。shell-contract 顶层 label 断言钉四组＋被删组禁现断言。
**B 设置弹窗归类（Obsidian 式）**：目录顶部**搜索框**（过滤目录项标题与 keywords）；左栏按 group 归组（应用：偏好与模型/备份与恢复；项目：载体管理/导入既有稿/新建项目/主载体选择；文档：文档历史；载体：每块已注册载体一格占位）；三 manifest 加 `settings: []` 注册制字段（P14 第一步）。截图 `png/42/43`。
**C pane 协议落地（去噪＋统一头部）**：大纲/条目保存按钮文案「保存为第 N 版」→「保存」（P3）；七个视图头部统一 `.nx-pane-header`＋动作位 `.nx-pane-actions`（P2）；「已载入」notice 已于 H1 移除（C 复核零 diff）；visual-contract 加两断言（「保存为第」禁现＋`.nx-pane-header` ≥5）。

## 2. 门禁

调度方独立复跑（两批合并态）：内核单测 **203/203**、界面测 **70/70**、eslint 0 警、打包 a–k 全过（内核 bundle 910.9 kB——含 git 库＋知识服务）。

## 3. 执行方上报、调度方已核

1. B 的**载体 settings 声明未真正接通**（最重要）：`validateCarrierManifest` 白名单丢弃未知字段、`shellView` 只挑字段——manifest.settings 到不了渲染层，目录里的载体占位节目前按 view.carriers 标题生成。**下批修**：carrierManifest＋shellView 透出 settings（两文件均不在本批允许清单）。
2. 搜索是浅匹配（标题＋手抄 keywords），无全文/拼音；keywords 需人工维护。
3. 组标题用 `.settings-group-label` 而非 `.workspace-nav-section`（老版该规则作用域在 workspace-sidebar 内，弹窗套不上）。
4. 动态载体占位节对全部已注册载体出现（含停用的）；「记忆上次打开的节」未做。
5. A 的页内菜单「悬停即展开」保留（作者嫌扫过弹开可改保守）；project.proposals 仍是既有空接线（渲染层无监听，记账）；help.spec/gate 空条目保留。
6. C 的保存 chip 仍显示「已保存 · 第 N 版」（工单只改按钮文案；chip 版本号去留待裁）；提案「采纳（写入为新一版）」是采纳动作非保存按钮，保留。
7. notice 条仍承载非 open 类消息（已新建/已采纳/已弃用/大纲已保存）——工单只点名 open* 五处，未扩大。

## 4. 诚实边界

- 真窗口观感由调度方截图确认（40–45）；overlay 色不随主题实时切换；DevTools/重载无 id（页内渲染为禁用行，原生菜单可用）。
- 「最近项目」未实现（删除记账）；载体设置节内容为占位空态（注册制先落地）。
- 两批合并验收：批次19/20 共享文件（CarrierPaneHost/useBoardData/shell-ui）交叠，提交为合并态单提交（信息分批记账），未做 hunk 级拆分。
