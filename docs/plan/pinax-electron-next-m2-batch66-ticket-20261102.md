# 批次66 工单：状态轴收敛＋lastOpenFiles＋订阅词表扩展（Obsidian 框架轮·桩3）（2026-11-02）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。工单源：框架计划 §6 桩3＋§11 批次66；前置裁定 Q2 已裁（**删** fullscreen/immersive，登记未采用照 chain 先例）。
> 前置：批次65b 已收口（tip `fa660e6`，CI run 124 偶发红为 vitest 并行竞态、run 125/126 同树绿、run 127 起 verify:next 的 vitest 段已改 `--no-file-parallelism`——本批沿用该脚本）。

## 任务（四条）

1. **形态词表收敛（Q2 落地）**：`PANE_FORM_WORDS`（paneForms.mjs）删 `fullscreen`/`immersive` → 三值（dock/split/overlay）；`carrierManifest.mjs` 校验词表同步；`host-descriptor.json` 的 forms 同步；**12 份清单的 forms 数组删去这两值**；workspace v3 的 form 轴（page/floating/tab）不动。**断言**：「清单声明的 forms ⊆ 词表」既有校验保持＋「词表与状态机落点同构」（FORM_ACTIONS/PAGE_FORMS 对照表进 acceptance 记账）。批次61 limitation 2 的待裁随之闭合。
2. **lastOpenFiles**：打开文档窗时把 resource 记进 workspace v3 的 `lastOpenFiles`（滚动 20 条封顶、去重最近优先）；**恢复语义＝预填不自动开**——AppNext 启动后按 lastOpenFiles 提供「最近打开」的可点列表（落点：索引窗顶部或状态栏左键菜单，选一并在 §7 说明），点击＝按 resource 开窗；关闭的文档留在列表里。
3. **逐视图状态**：folder 模板索引窗的**树展开态＋选中 resource** 按资源记进 workspace 条目（每页自己的状态），重启恢复；滚动位置不进本批（记账）。范围收窄：只做 folder 模板的树态，其它视图登记。
4. **订阅词表扩展（F7）**：`CARRIER_SUBSCRIPTIONS` 从 `['project.changed']` 扩 `+ file.changed + layout.changed`——**两处真实发射点接线**：fileService 写钩子（批次49 已有）发 `file.changed`、workspaceStore 落盘发 `layout.changed`；批次39 的 projectEvents 投递链把新事件按订阅词送达已声明载体的 `onProjectEvent`。`selection.changed` **登记不做**（壳层尚无干净的选择发射点，诚实登记不硬造）。事件负载形状与投递语义写进 spec v2 附录。

## 允许文件

`next/shell/paneForms.mjs`、`next/kernel/carrierManifest.mjs`（词表）、`next/host-descriptor.json`、12 份 `next/carriers/*/manifest.mjs`（仅 forms 数组删值）、`next/shell/workspace.mjs`＋`workspaceStore.mjs`（lastOpenFiles＋视图状态）、`next/shell/AppNext.vue`（最近打开入口）、`next/shell/IndexWindow.vue`（树态恢复）、`next/runtime/eventBus.mjs`、`next/runtime/serviceLogPool.mjs`（如需）、`next/fs/fileService.mjs`（写钩子发事件，语义不变）、`next/shell/ipcContract.mjs`（如需）、`next/tests/`＋受影响 spec、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（计数写理由）、`docs/plan/pinax-electron-next-spec-v2-20261102.md`（事件附录）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不动协议 schema 版本（@4 词表内收敛）；**不恢复 fullscreen/immersive 的任何入口**；不动窗口系统行为（批次59/61 语义）；不动写族闸/expectedRevision；`selection.changed` 不硬造发射点；不改 `server/**`、`src/**`；不加 npm 依赖；不起 Electron、不执行 git。

## 守卫标记

批次45–65b 全清单继承；本批新守卫：词表三值断言、`fullscreen`/`immersive` 全仓零声明、lastOpenFiles 滚动封顶用例、file.changed/layout.changed 投递用例。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿；「声明形态必有落点」断言在；重启后树展开/选中/最近打开一致（真窗口实拍调度方接管）；订阅扩展后批次39 的投递链测试照绿。

## 记账指标（不进闸）

lastOpenFiles 首版内容样例；12 清单 forms 清理对照表。

---

## §7 执行方回填 ／ §8 调度方验收

批次记录全文执行方已落盘 `docs/plan/pinax-electron-next-m2-batch66-20261102.md`（交付细节、记账实测值、门禁读数、limitations、复现命令都在那里）；diff 指引用临时索引法。以下为摘要。

### 任务达成态（四条）

1. **形态词表收敛（Q2 落地）——达成**。`PANE_FORMS` 三值（dock/split/overlay），`fullscreen`/`immersive` 从词表、`FORM_ACTIONS`、`host-descriptor.json`、清单校验词表全部退净。**「声明形态必有落点」的守卫分三层**（工单守卫标记要求的「全仓零声明」按声明面落实）：①`doctor.test.mjs` 逐份扫 11 份 `carriers/*/manifest.mjs` 的 `forms: [...]` 串，命中旧词即红，并钉 `dirs.length === 11`（守卫写法失效会当场报，不静默）＋两份词表（`PANE_FORM_WORDS`／`PANE_FORMS`）与 `host-descriptor.json` 的 `forms` 必须同为三值；②`pane-forms.test.mjs` 负向断言：旧词喂进 `sanitizePaneForms`／`formActionsFor`／`formMenuItems` 都出不来任何动作；③`acceptance.mjs` 的 `RETIRED_FORM_WORDS` 对货架清单声明做零命中判定。workspace v3 的 form 轴（page/floating/tab）逐字未动。**「清单 forms ⊆ 词表」既有校验保持，新加「词表与状态机落点同构」断言**：`carrierFormTable()` 逐载体读 `manifest.contributes.panes[*].forms` 反查 `FORM_ACTIONS`，并断言 `Object.keys(FORM_ACTIONS).length === PANE_FORMS.length`——三值与三个落点动作一一同构，菜单里不存在「点了没差别」的项。批次61 limitation 2 随之闭合（spec v2 §4.2 的 J4 由「待裁」转「达成」）。
   - 计数偏差照实记账：工单写「12 份清单」，注册表实际可装载的清单是 **11 份**（`host-descriptor.json` 的 carriers 数即 11）；11 份的 forms 数组清理对照表见批次记录记账②。
2. **lastOpenFiles——达成**。`open()`/`setResource()` 真实变更时 `noteRecent(entry)` 记 `{pane, resource}`，`pushRecentFile` 去重最近优先、`LAST_OPEN_FILES_LIMIT=20` 封顶滚动；`close()` 不记也不删——**关闭的文档留在列表里**。恢复语义＝**预填不自动开**：`load()` 把 lastOpenFiles 原样带进快照，`recentFiles()` 只读，不产生任何 `open()` 调用。记账①已打到封顶（25 次打开含 3 次重开 → 20 条、去重、置顶）。
3. **逐视图状态（folder 模板树态）——达成**。`viewState` 落在 workspace v3 的**每页条目**上（`normalizeViewState`：键为字符串数组、单键值去重、整条目封顶 200；空集归 `null` 不写占位）。索引窗树「展开态（collapsed 卷名）＋选中 resource」按页记、重启恢复；其它视图与滚动位置登记不做（见 limitations）。
4. **订阅词表扩展（F7）——总线侧达成，宿主精投那一行留给调度方**。`CARRIER_SUBSCRIPTIONS` 三词；`PROJECT_EVENT_TOPICS` 建 kind→订阅词同构表（五老 kind 归 `project.changed`，`file-changed`/`layout-changed` 各归新词），`emitProjectEvent` 负载恒定四键 `{kind, topic, at, path}`，`subscribeProjectEvents` 新增可选 `{subscriptions}` 挑词投递（不给＝全收，批次37/39 两条宿主订阅行为逐字不变）。两处真实发射点已接线：fileService 写钩子发 `file.changed`（带 relativePath，写族闸/expectedRevision 语义不变）、workspaceStore 落盘发 `layout.changed`。`selection.changed` **按工单裁定不做**，不硬造发射点。事件附录写进 spec v2 附录 A（两张词表、负载形状、六处发射点、八条投递语义、两条消费链、测试口径）。

### 任务2 落点选择（工单要求 §7 说明的一项）

选 **索引窗顶部**（folder 模板索引窗 `.nx-recent` 一栏，可折叠），不用状态栏左键菜单。三条理由：①批次63 的视觉合同把状态栏可点件收成「只有一枚」，再加一枚等于自行改合同，而 `StatusBar.vue` 也不在本批允许文件内；②「最近打开」是导航语义，与索引窗「找文件」是同一件事，放在状态栏要靠二层菜单才够得着；③folder 模板是跨载体常驻位，一栏服务所有用它的载体，不必逐载体复制入口。用例见 `shell-ui.spec.mjs`「最近打开（批次66 任务二）」：预填不自动开、点击按 resource 开窗并置顶去重、关闭后列表不动。

### limitations 摘要（9 条，全文见批次记录）

12→11 份清单计数偏差；任务4 的「逐载体按订阅词精投」需要改 `mcpSurface.mjs:88-89`／`agentRuntime.mjs:42/168`，两者不在允许清单，本批只做到总线能力＋宿主全收链路可观察；宿主 IPC 转发仍只带 `{kind, at}`（渲染层拿不到 topic/path，属批次49 既有形状）；recentOpen 只在本地项目；其它视图状态与滚动位置不做；`exportHostDescriptor.mjs:20` 的「五态」文案与 `next-shell.css:166` 的 `.nx-titlebar-immersive-exit` 死规则登记待处置（两文件均不在允许清单）；**自报**：`next/shell/PaneFormMenu.vue:12-14` 有一处允许清单外的注释同步改动（把旧词表描述改为三值，无行为变化）；真窗口实拍按工单由调度方接管，执行方未起 Electron；jsdom 的 `v-show` 口径备忘（`isVisible()` 递归父链会误判，用例改断 `style` 属性）。

### 门禁读数

`npm run verify:next` 五段全绿（exit 0）：acceptance 44/44、`node --test` 727 pass / 0 fail、vitest 201 passed（14 files，`--no-file-parallelism`）、`lint:next` 零警告、bundleAssertions 全部通过（宿主描述符 `forms 3`，未改任何计数）。
一次如实登记的偶发：**同树第一次**跑第五段红 7 项，报的全是「产物文件不在盘」（`.build/skills/*/SKILL.md`、部分载体 `.mjs` 缺，目录在），与本批源码无关；原地重跑第五段即全绿，之后连续两次完整 `verify:next` 均 exit 0。两个已核实的结构性事实与候选根治面都在批次记录「复现」段，改法涉及 `bundleAssertions.mjs`／vite 配置，不在本批允许文件内——**请调度方按偶发处置，勿当本批回归**。

## §8 调度方验收

（待补。）
