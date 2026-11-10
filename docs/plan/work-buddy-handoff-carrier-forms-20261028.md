# Work Buddy 交接包：批次24 多形态宿主（MiniMax M3.1 执行）（2026-10-29）

> 交接背景：DeepSeek 通道持续网络错误，执行层按作者裁定迁往 Work Buddy（MiniMax M3.1）。
> 本包是**自包含工单**——执行方只需本文件＋仓库现状，无需其他上下文。
> 分工：执行方实现＋自查；Zcode 调度方验收（独立 verify:next）、截图、提交推送。

## 0. 仓库与现状

- 仓库：`D:\Pinax-main\Pinax-main`（非 git 工作副本；提交由 Zcode 在 `D:\Pinax-pr` 的 clone 做）
- 分支：`feat/pinax-electron-next`（已推 `skkbsgzf/Pinax-StoryHarness` fork）
- 当前门禁基线：内核单测 **244/244**、界面测 **87/87**、eslint 0 警、打包 a–k 全过
- **纪律：不启动/不杀任何 electron 进程（作者真窗口开着）；不执行 git 命令**

## 1. 已完成（你接手时的现状，不要重做）

批次 11–23 已全部合入分支：提案审阅、载体管理、世界书/大纲/构思/资料/约束五域编辑、git 快照历史、备份恢复、统一二级页（弹窗目录制）、设置归类搜索、**多形态宿主已实现**（见 §2）。

**§2 多形态宿主——已实现并全绿，你只做剩余两项**：
- 已有：`next/shell/paneForms.mjs`（PANE_FORMS=['dock','split','overlay','fullscreen'] 状态机＋setPaneForm＋localStorage `paneForm.<paneId>` 持久化）、分屏容器（主/副栏，副栏≥420px 拖拽分界）、FloatingWidget 吸附左/右边缘（snap 字段）＋扩至全屏、竖条格/树行右键「打开方式」子菜单（按 manifest.forms 声明列出）、Esc/点外收起。
- 已知缺口（你要补的）：①`next/kernel/carrierManifest.mjs` validatePanes 会丢弃 `forms` 字段——需加 forms 声明的词表校验并保留透传（宿主词表外的形态拒装）；②六个 `next/carriers/*/manifest.mjs` 目前 0 处 `forms` 声明——给 novel/outline/notes/worldbook/setting/reference 各补 `forms: ['dock', ...]`（按载体性质：novel=['dock','split','fullscreen']，outline=['dock','overlay']，notes=['dock']，worldbook=['dock','overlay']，setting=['dock']，reference=['dock','overlay']）；③`next/shell/slots.mjs` 的 SLOT_OVERLAY 已有，无需动。
- 测试：manifest-contract 补 forms 校验用例（合法透传/词表外拒装）；shell-ui 补「右键按声明列出打开方式」。
- 门禁：verify:next 五段全绿。
- 允许文件：next/kernel/carrierManifest.mjs、next/carriers/*/manifest.mjs（六块）、next/tests/manifest-contract.test.mjs、next/tests/shell-ui.spec.mjs（如需）。
- 诚实边界：不做拖拽排序、不做多开。

## 3. 全局纪律

1. 门禁：`npm run verify:next` 五段全绿（验收＋内核单测＋外壳界面测＋eslint 0 警＋打包 a–k）。
2. 视觉：颜色/字号/圆角一律 token（--fs-*/--radius-*/--nx-*），禁裸 px 字号圆角（布局 px 例外）；button 落共享词汇（.control-*/.nx-row/.workspace-nav-item/.nx-ribbon-item）；jsdom 无 matchMedia。
3. 文件所有权：只改工单点名文件；**不要动 next/shell/styles/next-shell.css 的 860px media query 区**；不碰 server/、src/、docs/、electron/。
4. **不启动/不杀任何 electron 进程**（作者真窗口开着）。
5. 完整 verify:next 由 Zcode 调度方统一实跑；你只跑点名单测文件自查。
6. 断言同步（聚合面计数/白名单/declaredOutsideKernel/acceptance record）按常备授权直接做并逐处列明；内核 MCP 面 19 工具红线不碰；改门禁判定逻辑须向 Zcode 升级。
7. 做不到的如实写进 limitations。

## 4. 交接回执（执行方填）

（改动文件清单、verify:next 五段数字、诚实边界、异常与踩坑。）

## 5. 验收与提交（Zcode 填）

（diff 复核、独立复跑 verify:next、真窗口截图、提交推送后回填。）
