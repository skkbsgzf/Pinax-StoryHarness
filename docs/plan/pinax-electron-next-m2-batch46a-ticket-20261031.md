# 批次46A 工单：标杆1 写作核心——章节管理＋审查本章＋五动作信封升级（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 前置：批次45 已收口（沉浸态/写族闸/设置命名空间/解注册接线，tip 见分支）。
> 背景：小说创作套件作为 v3 协议标杆插件（标杆1）。本批补「作者每天真正会用的手」的核心三件：章节管理（删除/重命名/排序——fileService 至今无 delete/rename）、审查本章（老线校对轨，新线零实现）、五动作升级（现在裸补全不带大纲/世界书参考）。

## 任务① 章节管理：受控 delete/rename＋右键菜单＋上移/下移

1. `next/fs/fileService.mjs` 新增受控 `deleteFile(relPath)` 与 `renameFile(relPath, nextRelPath)`：
   - **归属闸照旧**：目标必须在本插件 dataDirs 内（DIR_CONFLICT 语义复用 :355-360）；`canPerform(grantFor(pluginId), {type:'file', dir, mode:'write'})` 照走。
   - **删/改名前强制历史快照**：调用 gitHistory 的 commit-now 路径对当前内容落一次快照（`next/history/gitHistory.mjs`），失败即中止不操作。快照制历史的语义：删除/改名后由下一次定时提交自然记录。
   - **修订账清理**：`.pinax/state/revisions.json` 的对应条目——删除即移除，改名即迁移到新路径（照 ：451-466 的「盘外删除」清理风格，以盘为准）。
   - **未决提案保护**：目标章在 `.pinax/proposals/` 有未决（pending）提案时拒绝删除/改名，报带提案文件名的错误（提示先到提案审阅处理）。已采纳/已弃用的提案文件不动。
   - rename 的 nextRelPath 只允许同目录下改文件名部分（含 NNN- 前缀变更）；跨目录 move 本批不做。
2. novel 载体新增两把写工具（`next/carriers/novel/manifest.mjs` tools 数组＋`next/carriers/novel/tools.mjs` 实现，`annotations.readOnlyHint:false`）：
   - `pinax_chapter_delete`（args: file）
   - `pinax_chapter_rename`（args: file, title——title 不带 NNN 前缀，工具负责按现前缀规则生成新文件名；显式带 NNN 的如实拒绝）
3. `next/runtime/kernelWriteGuard.mjs`：`CARRIER_WRITE_CLASS` 加两行（dir:'正文'）——`guardCarrierWriteGaps` 门禁必须继续全绿。
4. **agent 写策略**：agent 工具循环里这两把工具照落点表自然走 writePolicy（review 转提案、auto 直写）——提案是 tool-call 重放，删/改名重放可行，**不要特判**。作者 UI 通道不经 writePolicy（UI 直调 IPC→callTool，现状语义）。
5. `next/runtime/toolSelect.mjs`：写工具披露正则（:23-31 附近的 `/(_save|_write|_import)$/`）**必须**扩入 `_delete|_rename`，否则 agent 披露不到这两把——改断言写理由。
6. `next/shell/IndexWindow.vue` 章节树右键节点菜单加四项：删除（确认弹窗，词汇照现有 confirm 风格）、重命名（行内输入，Enter/Esc/失焦照批次33 的临时输入惯例）、上移、下移（上移/下移＝相邻两章交换 NNN- 前缀＝两次 renameFile，同号章冲突时如实报错）。
7. **acceptance.mjs 计数同步**：toolCount 37→39、carrierTools 22→24、名字枚举加两把——写明理由。d/d2 内核计数（19/20）不变。
8. 测试：fileService 删/改（快照前置/修订账清理/未决提案拒/归属闸拒）；工具层两把的形状与契约；agent review 模式下调 delete 产出提案；spec 右键菜单四项与上移下移换前缀。

## 任务② 审查本章（骑 authoring.review.chapter 只读轨）

机制确认：`buildRuntimeEnvelope`（`next/runtime/contextProfiles.mjs:164+`）按主载体 profile 反查只读任务——novel 的 writing-chapter 档命中的就是 `authoring.review.chapter`（`shared/agentCapabilityContract.js:39`，review-only，产出 `review-suggestions.v1`）。信封自动带 rules/style/selection/outline/worldbook 块。

1. 正文面动作带加「审查本章」钮（与批次41 五动作同排）。
2. 点击→IPC ask 走既有 runner（`next/shell/main.mjs:447-452` 的 createAdvisorRunner 链），question 固定为审查本章指令文案（如「审查当前章节：体检结构、连贯性、设定一致性，输出问题清单与建议动作」）。
3. 结果卡：按 `review-suggestions.v1` 的 schema（先读 `shared/` 合同与 `next/runtime/runnerAdvisor.mjs:155-165` 的既有解析对齐字段名）渲染 summary＋issues 列表＋actions；每条 issue 给「转改写」钮＝预填五动作的改写动作并带该 issue 描述作为额外要求（复用批次41 的动作带通道，选中段定位尽力而为、取不到就让作者手选）。
4. 结果不进会话存储（一次一报，丢了就重跑）；不做批次会话管理（老线 useAuthoringReviewWorkflow 的多批次事务本批挂账）。
5. 测试：信封组块断言（审查请求带大纲/世界书块）；结果卡渲染 spec；「转改写」预填 spec。模型真实调用不测（无凭据），失败路径如实展示。

## 任务③ 五动作信封升级＋提示词预览口（续写参考）

现状：`next/runtime/writingComplete.mjs` 固定 system prompt＋裸 user（正文＋选区＋500 字要求），**不带任何本书参考**——这是「续写参考」缺口的根。

1. `writingComplete.mjs` 升级：请求处理时调 `buildRuntimeEnvelope`（同 ask 链的组装口径）拿裁剪好的参考块，把块文本以【本书参考】段并入 user prompt（块前标注来源 kind，如【大纲】【世界书·设定】）；envelope 失败（DEPENDENCY_UNMET 等）时**降级为现状裸补全并在结果里如实标注**「参考块缺席」，不硬失败。
2. 返回结构加 `references: [{kind, chars}]` 清单（用了哪些块、各多少字），供 UI 展示。
3. **提示词预览口**：主进程留存最近一次写作请求的完整 system＋user，新增只读 IPC（如 `writing:last-preview`）返回；结果卡加「查看提示词」折叠层展示。这是老线 PromptPreviewPanel 的语义（作者可见），不做实时预览。
4. 五动作的语义清单不动（续写/改写/扩写/压缩/润色）；预算与截断全信 envelope 的 clip，不自造第二套截断。
5. 测试：信封块并入 user 的形状（mock 运行时面）；降级路径；预览 IPC 与折叠层 spec。

## 允许文件清单

- `next/fs/fileService.mjs`、`next/history/gitHistory.mjs`（仅暴露 commit-now 给 fileService 的接口，不动快照语义）
- `next/carriers/novel/manifest.mjs`、`next/carriers/novel/tools.mjs`
- `next/runtime/kernelWriteGuard.mjs`（CARRIER_WRITE_CLASS 两行）、`next/runtime/toolSelect.mjs`（正则扩展）
- `next/runtime/writingComplete.mjs`、`next/shell/main.mjs`（IPC 接线）、`next/shell/ipcContract.mjs`（通道合同）
- `next/shell/IndexWindow.vue`（右键菜单）、`next/shell/CarrierPaneHost.vue`（动作带＋审查结果卡＋提示词折叠层）、`next/shell/useBoardData.mjs`（如需）
- `next/shell/writingActions.mjs`（预填改写；动作语义不动）
- `next/shell/styles/next-shell.css`（如需，token 纪律）
- 测试：`next/tests/*.test.mjs`、`next/tests/*.spec.mjs`；`next/testing/acceptance.mjs`（计数同步，写理由）
- `docs/plan/` 本工单 §7 回填

## 禁止边界

1. 不改 `server/**`、`src/**`；不新增 npm 依赖。
2. 不动提案 schema（`pinax-proposal@1`）、不动 fileService 三道闸与 expectedRevision 语义、不动自动保存链（AUTOSAVE_DELAY_MS 一套照旧）。
3. 删除不做回收站/软删除（历史快照即安全网）；跨目录 move、拖拽排序本批不做。
4. 审查本章不建会话存储、不改 writePolicy、不加新 canonical 任务（骑现有 authoring.review.chapter）。
5. 五动作不接流式；不动 kitModelGateway。
6. 不启动/不杀 electron 进程；不执行 git 命令。

## 守卫标记（收尾自查＋调度方评审对照）

- 批次45 四件不丢：`PLACEMENTS` 含 `'immersive'`、`EXTERNAL_WRITE_HINT` 在 kernelWriteGuard、`next/settingsStore.mjs` 存在、AppNext 沉浸条件渲染在；
- 既有：IndexWindow 无「只读归档」、css 有 `.editor-area:focus-visible { outline: none`、AppNext 有 `overlayPane?.id === id`、wikiLinks 有 `buildEntryTokenMap`、formTaxonomy 八视图词表完整、useBoardData 有 `AUTOSAVE_DELAY_MS`。

## 门禁要求（完成定义）

```
npm run next:build:main && npm run next:build:shell
npm run verify:next        # 五段全绿；acceptance 计数同步后 39/24
```

---

## §7 执行方回填（执行完成后填写）

### 交付清单
（改了什么文件、每项任务落点、新增测试清单）

### 门禁自报
（build 体积、verify:next 五段计数）

### 偏离
（与工单不一致处，逐条给理由；没写＝无偏离）

### limitations
（没做的、没验证的，如实列）

## §8 调度方验收（Zcode 填，执行方不要动本节）

- 独立复跑五段门禁；评审员对照工单读未提交 diff（基线＝批次45 收口提交号）；守卫标记 grep；断言漂移逐条核对。
- dameng-px 真数据端到端（审查本章出真结果卡、章节删除/改名在真项目跑通、历史快照可回看）由调度方接管。
- 验收结论与批次记录落 `docs/plan/pinax-electron-next-m2-batch46-20261031.md`（调度方写，46A/46B 合并一笔记录）。
