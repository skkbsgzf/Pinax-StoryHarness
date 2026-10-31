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

**任务① 章节管理**

- `next/fs/fileService.mjs`：新增受控 `deleteFile({pluginId, dir, file})`／`renameFile({pluginId, dir, file, nextFile})`。归属闸（DIR_CONFLICT）与 `canPerform(..., {type:'file', dir, mode:'write'})` 照旧；操作前经注入的 `snapshotBeforeDestructive` 落一次历史快照，失败即中止（`PINAX_IO_FAILED`，正文与修订账一个字节不动）；`.pinax/proposals/` 里 status=proposed 且 target.file 指向目标章时拒删／拒改名，错误 details 带提案文件名；修订账删除即移除、改名即迁移到新路径；rename 只收同目录文件名（跨目录拒），空名／`.`／`..`／隐藏名／同名／已存在都拒。
- `next/history/gitHistory.mjs`：只把既有 `snapshotBeforeDestructive` 作为 fileService 的默认快照口（提交语义未改；删除／改名后由下一次定时提交自然记账）。
- `next/carriers/novel/manifest.mjs`＋`next/carriers/novel/tools.mjs`：新增 `pinax_chapter_delete`（args: file）与 `pinax_chapter_rename`（args: file, title｜nextFile）。title 不带排序前缀，工具按原文件 `NNN-` 前缀生成新名；显式带 `001-` 这类前缀的 title 如实拒绝。`readOnlyHint:false`，走 fileService 同一套闸。
- `next/runtime/kernelWriteGuard.mjs`：`CARRIER_WRITE_CLASS` 加两行（dir: '正文'）。
- `next/runtime/toolSelect.mjs`：写工具披露正则扩为 `/(_save|_write|_import|_delete|_rename)$/`，删／改名不再被当成读工具。
- `next/shell/IndexWindow.vue`：章节行右键菜单四项——删除（两步确认，历史快照即安全网）、重命名（行内输入，Enter 提交／Esc 取消／失焦取消，照批次33）、上移、下移（相邻两章交换 NNN- 前缀＝两次 renameFile；同号冲突原样报错）。边界项置灰。
- `next/shell/useBoardData.mjs`：`deleteChapter`／`renameChapter`／`moveChapter` 接上述工具；删当前章前先收自动保存，删／改名后重读章节树。
- `next/testing/acceptance.mjs`：M2 工具面计数 37→39、carrierTools 22→24，名字枚举与理由随批次46A 更新。
- 测试：`next/tests/file-service.test.mjs`（快照前置／失败中止／未审提案拒／修订账清理与迁移／跨目录与非法名）、`next/tests/carrier-novel.test.mjs`（两把工具形状、前缀保留、带前缀拒、nextFile 换名、跨目录拒、删前快照、提案保护）、`next/tests/tool-select.test.mjs`（删／改名按写工具披露）、`next/tests/chapter-menu.spec.mjs`（四项菜单、两步删除、行内重命名、边界置灰与换前缀调用）、`next/tests/runtime-inprocess.test.mjs`＋`next/tests/skeleton-contract.test.mjs`（载体自有工具名单同步两把）。

**任务② 审查本章**

- `next/shell/useBoardData.mjs`：新增固定问句 `CHAPTER_REVIEW_QUESTION` 与 `reviewChapter()`／`discardReview()`。审查前先把未落盘改动送下去；本章只载入前段且未保存时拒审（不拿旧稿充数）；结果只存本栏内存（summary／issues／actions），不进会话存储、不动正文；换章／删章／过期回答用请求序号丢弃。
- `next/shell/CarrierPaneHost.vue`：动作带加「审查本章」；结果卡渲染摘要、问题列表（高／中／低标签）与动作列表；每条问题「转改写」＝预填五动作的改写并带该问题描述为额外要求（选区保持现状，取不到就由作者手选）。
- `next/shell/styles/next-shell.css`：审查卡与写作结果同档面板样式（上细线，无新配色）。
- 测试：`next/tests/review-chapter.spec.mjs`（按钮走 runtimeAsk 固定问句、无 sessions 通道、卡片三层、转改写预填、收起不丢草稿）、`next/tests/runtime-context-runner.test.mjs`（固定问句走 writing-chapter 信封，带 rules/style/selection/outline/worldbook 块）。

**任务③ 五动作信封升级＋提示词预览口**

- `next/shell/writingActions.mjs`：参考块 kind→中文标签表（`REFERENCE_KIND_LABELS`／`referenceLabel`）与 `buildReferenceSection`；`buildWritingRequest` 增加可选 `references`，在【任务】之前并入【本书参考】段。五个动作的语义与提示词其余部分逐字不变。
- `next/runtime/writingComplete.mjs`：请求时经注入的 `contextSources` 调 `buildRuntimeEnvelope`（与 ask 链同一组装口径），信封裁剪后的块按 kind 标注并入用户提示词；失败／缺项／零块时降级为批次41 的裸补全，结果返回 `degraded:true` 与 `referenceNote`（以「参考块缺席」开头），不硬失败；返回 `references:[{kind,chars}]` 与 `missingKinds`；留存最近一次请求的 system＋user，新增 `preview({root})` 只读口，跨项目拒给。
- `next/shell/ipcContract.mjs`：新增只读通道 `writingPreview = 'pinax:agent:writing:last-preview'`；`runtimeComplete` 把当前项目根一并交给服务；预览通道只认当前项目根，未接入／未开项目如实报缺。
- `next/shell/main.mjs`：`writingComplete` 注入 `contextSources`（取自 `session.runtime.contextSources()` 的 registry／view／fileService）。
- `next/shell/useBoardData.mjs`：结果携带 `references`／`referenceNote`；新增 `writingPreview`／`writingPreviewError` 与按需 `loadWritingPreview()`；换章／重新发起／落位／丢弃时收回，过期回答丢弃。
- `next/shell/CarrierPaneHost.vue`＋`next/shell/styles/next-shell.css`：结果卡显示参考块清单（kind＋字数）或缺席原话，并加「查看提示词」折叠层（系统提示词／用户提示词两段只读展示）。
- 测试：`next/tests/writing-actions.test.mjs`（信封块并入形状与排序、references 清单、降级路径、预览服务与 IPC 通道三态）、`next/tests/writing-preview.spec.mjs`（参考清单、「查看提示词」按需拉取与收起、缺席原话、预览失败不白屏）。

### 门禁自报

```
npm run next:build:main && npm run next:build:shell
- 主进程 bundle：1,711.12 kB；外壳 bundle：1,932.40 kB；preload：4.61 kB

npm run verify:next
- acceptance：20/20 通过；M2 聚合工具面 toolCount=39 carrierTools=24（5 接管＋19 自有）
- node --test next/tests/*.test.mjs：529 测试，529 通过，0 失败
- vitest next shell：10 个文件、168 测试全过
- lint:next：0 error / 0 warning
- bundleAssertions：全部通过（主进程 1,729.6 kB < 6 MB；外壳 1,962.6 kB < 2.5 MB；渲染层 js 989.2 kB）
```

### 偏离

1. `pinax_chapter_rename` 在工单的 `title` 之外多收一个 `nextFile`（整名形式，与 title 二选一）。原因：上移／下移的本意是「交换相邻两章的 NNN- 前缀」，若只让界面拼 title，工具会按各自原前缀生成同名／错名；由界面传完整新文件名最不容易错。`nextFile` 只收同目录文件名、模型侧描述里明确标为界面排序专用，删除／改名其余闸不变。
2. 审查卡的动作列表把 `review-suggestions.v1` 的 `typedActions` 与 `action` 合并去重后展示（各取最多 8 条），只做展示层归一，不改合同与任务号。
3. 五动作参考块的检索问句用「作者额外要求＋选中段／光标附近 400 字」，上限 2000 字；这是块提供者打分用的问句，不进最终提示词的【任务】段。
4. 提示词预览通道名取 `pinax:agent:writing:last-preview`（工单示例为 `writing:last-preview`），归入既有 `pinax:agent:*` 命名空间。

### limitations

- 未做真模型调用：本机无模型面凭据，审查本章与五动作的真实模型输出未跑；已覆盖信封组装、失败／降级路径与界面契约。真数据端到端按工单 §8 由调度方接管。
- 未启动 electron 窗口（工单禁止），IPC 与折叠层只在 dispatcher 单测与 jsdom 组件测试里验证，未做真机窗口端到端。
- 上移／下移只换相邻两章的 NNN 前缀；两章同号或无前缀时改名冲突会如实报错，不自动寻找空号。
- 提示词预览只留最近一次请求，不做历史列表，也不实时刷新（与老线 PromptPreviewPanel 的「作者可见」语义一致）。
- 审查结果不落会话存储；关闭／收起后无法回看，只能重跑（工单口径）。

## §8 调度方验收（Zcode 填，执行方不要动本节）

- 独立复跑五段门禁；评审员对照工单读未提交 diff（基线＝批次45 收口提交号）；守卫标记 grep；断言漂移逐条核对。
- dameng-px 真数据端到端（审查本章出真结果卡、章节删除/改名在真项目跑通、历史快照可回看）由调度方接管。
- 验收结论与批次记录落 `docs/plan/pinax-electron-next-m2-batch46-20261031.md`（调度方写，46A/46B 合并一笔记录）。
