# 批次14 派工单：git 快照历史（D0–D2）（执行方：workflow coder · DeepSeek）

> 作者裁定（2026-10-28）：R3 关闭——全面摒弃浏览器缓存、全面本地化；变更历史用 git 机制定时存。
> 体积裁定：「Kit 包的体积不算大，忽略这个门禁，可以把它打到包里面」→ **内置 git 库进包**，1.6 MB 门禁按裁定抬高。
> 设计全文：[next-git-history-design-20261028.md](./next-git-history-design-20261028.md)。
> 分工：调度方（Zcode）写单/验收/提交；执行方（workflow coder）实现，不 commit/push。

## 全局纪律

1. 门禁：`npm run verify:next` 五段全绿（验收＋内核单测＋外壳界面测＋eslint 0 警＋打包 a–k）。
2. 视觉：颜色/字号/圆角一律 token（`--fs-*`/`--radius-*`/`--nx-*`）；button 落共享词汇；jsdom 无 `matchMedia`。
3. 依赖白名单变动（**本批特批**）：允许改 `package.json` **新增且只新增** `isomorphic-git` 一个依赖，允许抬高 `next/testing/bundleAssertions.mjs` 的 1.6 MB 体积门禁到 6 MB（保留实际值打印＋注释写明「按 R3 裁定：内置 git 库随包发布」）。除此之外 `package.json` 不许动。
4. 渲染层不得引入 git 库：`next/shell/**` 与渲染层入口不许 import `next/history/*`；git 库只出现在主进程 bundle。
5. 不执行 git 命令、不启动 electron 进程；完整 verify:next 由调度方实跑，你只跑点名文件自查。
6. 断言同步（工具计数/白名单/declaredOutsideKernel/acceptance record）按常备授权直接做并逐处列明；**内核 MCP 面 19 工具红线不碰**；改门禁判定逻辑须升级。

## D0 历史引擎（无 UI，可独立验收）

- 新增依赖：`isomorphic-git`（唯一新增项）。
- 新模块 `next/history/gitHistory.mjs`（主进程用，纯函数式接口）：
  - `ensureHistoryRepo({ root })`：在 `<root>/.pinax/history.git` 初始化裸仓库（`git.init({ dir, bare: true })` 或等价），并确保工作树排除规则：`.pinax/`、`assets/` 不进历史（用 `git.add({ filepath, ... })` 白名单式暂存即可——**只 add 允许目录**，比 exclude 更稳），仓库本地配置 `user.name=pinax`、`user.email=pinax@local`。
  - `markDirty({ root, paths })`：把脏文件清单写 `.pinax/state/history-dirty.json`（合并去重，带时间戳）。写盘复用 `next/fs/atomicWrite.mjs`。
  - `commitSnapshot({ root, message })`：读脏清单→逐个 `git.add`（只允许 `正文/ 大纲/ 世界书/ 构思/ 约束/ 资料/ .pinax/project.json` 前缀）→ `git.commit`（author 固定 pinax）→ 清脏文件；无脏返回 `{ committed: false }`。
  - `listFileHistory({ root, path, limit })`：`git.log({ filepath })` → `[{ oid, message, when, author }]`。
  - `readVersion({ root, oid, path })`：`git.readBlob` 取该版内容（UTF-8 文本；非 UTF-8 返回 typed error）。
  - `diffVersions({ root, a, b, path })`：两版文本做行级 diff（可自写 LCS 或引 `diff` 小库——**若引库需在 limitations 报备，优先自写 ≤80 行**），返回 `{ hunks: [{ type: 'add'|'del'|'ctx', line, text }] }`。
  - 全部接口失败返回 typed error（`HISTORY_UNAVAILABLE`/`HISTORY_INVALID_INPUT`），不抛裸异常。
- 门禁：`bundleAssertions.mjs` 体积上限 → 6 MB（注释写裁定）；新增断言「渲染层产物不含 isomorphic-git」；`shell-contract` 或新 `history.test.mjs` 断言 `next/shell` 源码不 import `next/history/`。
- 单测 `next/tests/history-git.test.mjs`：临时目录建仓→写文件→标脏→提交→改→再提交→`listFileHistory` 两版；`readVersion` 内容正确；`diffVersions` 有增删行；`assets/x.png` 不在历史里；空脏提交返回 `committed:false`；非法路径拒绝。
- 允许文件：`package.json`（只加依赖）、`next/history/*`（新）、`next/tests/history-git.test.mjs`（新）、`next/testing/bundleAssertions.mjs`、`next/tests/shell-contract.test.mjs`（如需）。

## D1 定时与 IPC 接线

- `next/runtime/historyScheduler.mjs`：`start({ root, intervalMinutes })` 定时器（默认 5，`0`＝关闭）、`stop()`、`requestCommit(message)`（手动）、`beforeQuit()`（关窗兜底提交）。定时器 `.unref()`，不阻止进程退出。
- `next/fs/fileService.mjs`：`write` 成功后调 `history.markDirty`（**单点接入**，钩子以可选依赖注入 `createFileService({ ..., onWrite })`，未注入时零行为——保持现有单测不受影响）。
- `next/shell/main.mjs`：项目打开后 `ensureHistoryRepo`＋`start`；`app.on('before-quit')` 兜底提交；新增五条 IPC 通道（`pinax:agent:history:*`：list/show/diff/commit-now/probe），在 `ipcContract.mjs` 声明并把 `historyScheduler`/`gitHistory` 经 deps 注入分发器（不注入时如实报缺，同 prefs 惯例）。
- 偏好：`next-preferences.json` 加 `historyIntervalMinutes`（默认 5，0–120 校验；`0`＝关闭）。`appPreferences.normalizePrefs` 同步扩展＋单测。
- 门禁：`shell-contract` 断言五通道存在、deps 未注入时如实报缺、偏好新字段值域。
- 允许文件：`next/runtime/historyScheduler.mjs`（新）、`next/fs/fileService.mjs`、`next/shell/main.mjs`、`next/shell/ipcContract.mjs`、`next/runtime/appPreferences.mjs`、`next/tests/app-preferences.test.mjs`、`next/tests/shell-contract.test.mjs`、`next/tests/file-service.test.mjs`（如需）。

## D2 UI（统一二级页「文档」组）＋ 浏览器缓存退役

- 统一二级页（`SettingsModal`）目录加一组「文档」：**文档历史**节——左栏该文件提交列表（时间＋摘要＋选中态），右栏 diff（`+`/`-` 行着色走既有 token，`--signal-warm`/`--control-danger` 语义色）、「恢复到这一版」（`.control-primary`，二次确认用弹窗内确认态，不另开弹窗）、空态与不可用态（无提交/引擎不可用）。
- 入口：索引窗行上下文动作「历史…」（章节/条目/构思/大纲通用）＋菜单「文件 → 当前文档历史…」（`MENU_TEMPLATE` 加 `project.history`）。
- 恢复：`history.show` 取内容 → 经现有 `runtimeToolCall` 的载体 save（chapter/worldbook/notes/outline 各自工具，带 expectedRevision）写回——**恢复＝新增版本**；不直接写文件服务绕过载体权限。
- `next/shell/theme.mjs`：`app_theme` 从 localStorage 迁到偏好 JSON（过渡期双写 localStorage 一版，注释写明老前端退役后删）。
- 门禁：`visual-contract` 加「`next/shell` 源码不得出现 `localStorage`」；`shell-ui.spec` 加历史面板用例（列表→选中→diff→恢复走载体工具、不可用态如实显示）。
- 允许文件：`next/shell/settings/HistorySection.vue`（新）、`next/shell/SettingsModal.vue`、`next/shell/AppNext.vue`、`next/shell/IndexWindow.vue`、`next/shell/theme.mjs`、`next/shell/menus.mjs`、`next/tests/visual-contract.test.mjs`、`next/tests/shell-ui.spec.mjs`、`next/tests/shell-contract.test.mjs`（如需）、`next/runtime/appPreferences.mjs`（如需 theme 字段）。

## 验收口径（调度方执行）

1. 写三次→等一个周期→历史面板出对应快照；关窗补提交。
2. 两版 diff 正确；恢复到旧版→内容回退且新增一版（历史未被改写）。
3. 引擎不可用（把 `.pinax` 设只读或用假实现）→ 面板如实显示不可用，其它功能零影响。
4. `verify:next` 五段全绿；`assets/` 不进历史；渲染层产物不含 git 库。
