# 批次45 工单：v3 协议补全——沉浸态＋写族闸收口＋每插件配置命名空间＋解注册接线（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 基线：`feat/pinax-electron-next` tip `460bdb5`（批次42–44 收口，门禁验收 20/20、内核 499/499、界面 147/147、eslint 0 警、打包 a–m3）。工作树干净，无半成品。
> 背景：作者三条诉求对照 v3 的差距收口——①「不注册不行动」的写族闸有结构性后门；②形态四态缺沉浸态；③插件独立配置无命名空间、无通用渲染器；④解注册机制（disposeOwner/uninstall）是零调用方的死代码。本批是标杆插件计划（小说套件＋toonflow/ComfyUI）的地基。

## 任务① 沉浸态（placement 第五值 `immersive`）

作者形态四态对齐：悬浮态＝已有 overlay（＋bubble/collapsed），分屏态＝已有 split，全屏态＝已有 fullscreen（不隐 chrome），**沉浸态＝全屏几何＋隐去左侧工具栏（ActivityRail）与右侧 Agent 栏（RuntimeDock），保留顶栏菜单行**（顶栏是退出口）。

1. `next/shell/workspace.mjs`：`PLACEMENTS`（:31 附近）加 `'immersive'`；place('immersive') 的几何语义与 fullscreen 同窗体全幅（复用 fullscreen 的 restore 记忆逻辑 :293-314 同款——进入前记住原 placement，退出还原）；持久化/多实例/pinned 不变。
2. `next/shell/paneForms.mjs`：`PANE_FORM_WORDS` 同步加 `'immersive'`（与 PLACEMENTS 相等由既有测试钉住，同步改断言并写理由）。
3. `next/kernel/carrierManifest.mjs`：forms 校验词表（:91 `PANE_FORM_WORDS` 与 :543-555 校验）加 `'immersive'`。
4. `next/host-descriptor.json` 的 forms 词表＋`next/doctor.mjs` 对表逻辑同步（十二块内置载体对真描述符仍须全 ok）。
5. 载体声明：**七块文档面载体**（novel/outline/notes/worldbook/setting/reference/script）manifest 的文档面 pane `forms` 数组加 `'immersive'`；五块记录型载体（material/comic/video/experience/online）不加。
6. `next/shell/AppNext.vue`：沉浸态生效时 ActivityRail（:1446 附近）与 RuntimeDock（:1545 附近）条件渲染（`v-if`/`v-show` 均可，选其一并说明）；打开菜单（forms 右键/竖条菜单，批次35 体系）加「沉浸」项——只对声明了 immersive 的 pane 出现；**退出三口**：顶栏固定退出钮、Esc 键、再点菜单「退出沉浸」。Esc 与 FloatingWidget 的全局收起手势并存时的优先级：有浮窗激活先收浮窗，无浮窗才退沉浸。
7. 样式如需（隐藏动画/占位）进 `next/shell/styles/next-shell.css`，沿用 token，不写裸 px。
8. 兼容：旧 `.pinax/workspace.json` 不会有 immersive 值，读侧对未知 placement 的现有行为保持（执行方核实读侧校验路径并如实记录）；新写才出现新值。

## 任务② 写族闸收口（补「外部 MCP 工具绕过 review 策略」的结构性后门）

现状：`next/runtime/writePolicy.mjs` 的写族判定＝`KERNEL_WRITE_CLASS` ∪ `CARRIER_WRITE_CLASS`（`next/runtime/kernelWriteGuard.mjs`），**外部 MCP 工具不在其中**——review 写策略下，外部 MCP 的写类工具（如某 server 的 `xxx_save`）会直接执行，不转提案。载体自有写工具的 IO 层已有 fileService DIR_CONFLICT 闸，模型层 review 转提案也已覆盖；本任务只收外部这一洞＋补观测面。

1. `next/runtime/kernelWriteGuard.mjs`：新增导出 `EXTERNAL_WRITE_HINT`（正则：`/_(save|write|import|delete|create|update)$/`）与 `isExternalWriteToolName(name)`。
2. `next/runtime/writePolicy.mjs`：写族判定扩为三支——内核写族 ∪ `CARRIER_WRITE_CLASS` ∪ `isExternalWriteToolName`。review 模式下外部写工具转 tool-call 提案（前缀路由重放已支持，`proposalStore.applyProposal` 走普通 callTool 即可落回远端）；auto 直写；blocked 拒。**不改**提案 schema、不改落点表静态结构、`guardCarrierWriteGaps` 门禁语义不动。
3. 审计面：`next/runtime/surfaceAggregate.mjs` 增加模块级环形审计缓冲（最近 50 条写类调用：`{ at, tool, owner, argsSummary }`，owner 用 `agentRuntime.ownerOf` 同源口径），导出 `recentWriteCalls()`；载体分支与外部 MCP 分支的写类调用都记。只记账，不改变调用行为与返回值。
4. 测试：①夹具 mcp server（参照 `next/testing/fixtures/plugin-demo` 的 mcp.mjs）加一把 `_save` 命名的工具；②review 模式下调用它→产出 tool-call 提案且远端未执行；③auto 模式→直执行；④审计缓冲记到该调用。

## 任务③ 每插件配置命名空间＋通用设置渲染器

现状：settings 声明校验齐全（`carrierManifest.mjs:896-969`，类型 section|string|number|boolean|enum）但唯一活口是宿主硬编码 `novel.writing → WritingPrefsSection`（应用级偏好 `next-preferences.json`）。本任务给声明制的 settings 一个项目级、每载体隔离的持久化与通用渲染器。

1. 新文件 `next/settingsStore.mjs`（照 `next/workspaceStore.mjs` 的模式）：存储 `.pinax/settings.json`，形状 `{ version:1, carriers:{ <carrierId>:{ <settingId>: value } } }`；tmp＋原子 rename；内容没变不写盘；坏文件回空并记账（console 记账即可，与 workspaceStore 同风格）。
2. 写入闸：`set(carrierId, settingId, value)` 只接受该载体 manifest `settings` 声明过的 id，且按声明类型校验（number/boolean/string 同型、enum 须在 options 内、section 类型不直接存值只作分组）。未声明即拒（返回错误，不写盘）。
3. IPC（`next/shell/ipcContract.mjs`＋`next/shell/main.mjs`）：新增 `settings:load`／`settings:save` 两通道（照 `workspace:load|save` 的风格与位置）；load 返回全量 carriers 映射；save 按 store 的白名单闸校验后落盘。通道白名单、合同测试同步。
4. 通用渲染器：新文件 `next/shell/settings/CarrierSettingsGeneric.vue`——按声明渲染：string→文本输入、number→数字输入（尊重 min/max/step 如声明）、boolean→开关、enum→下拉、section→分组标题；值经 IPC 读写 `.pinax/settings.json`；保存反馈沿用 `.nx-save-chip` 词汇。
5. `next/shell/SettingsModal.vue`（:46-83 `carrierSectionComponents`）：保留既有硬编码映射（novel.writing 仍走应用级 WritingPrefsSection，**不迁移**）；其余载体声明走通用渲染器；声明了 settings 但两者皆无的仍出空态文案。
6. 测试：store 单测（原子写/坏文件/白名单拒/enum 校验/内容不变不写盘）；界面 spec（四类控件渲染＋改值写回＋未声明拒）。

## 任务④ 解注册接线（禁用＝关 pane＋清工作区＋服务随重建收掉）

现状：载体禁用链 `next/project/carriers.mjs carrierSetEnabled` → `session.refresh` 重建运行时（工具面自然收掉、services/MCP 随重建不起），但**已打开的 pane 实例不关、workspace.json 里该 owner 的状态残留**；`viewRegistry.disposeOwner`（`next/shell/viewRegistry.mjs:149-158`）零调用方。内置载体不 uninstall（它们是内建的），接的是 disposeOwner 这半。

1. 禁用流程（`carrierSetEnabled` 的调用侧/外壳侧）在重建前对被禁载体调用 `viewRegistry.disposeOwner(id)`：关闭该 owner 的全部已开 pane 实例（含 overlay 浮窗实例与多实例 `#n`），并从 `workspace.json` 清除该 owner 的实例状态（placement/geometry/minimized/pinned）。
2. `next/kernel/pluginRegistry.mjs` 的 `onDispose` 钩子照常触发（幂等）；运行时重建后 `registry.dirOf` 对被禁载体返回空的行为保持。
3. `next/shell/ipcContract.mjs`（:221-232 附近）「运行时不可停用」合同表述更新为「禁用走重建＋pane 关闭＋工作区清理」，对应合同测试同步（改断言写理由）。
4. 测试：禁用 novel → viewRegistry 无其 view、workspace.json 无其实例、事件照常；再启用 → pane 可重新打开、工作区从干净状态开始。

## 允许文件清单

- 形态：`next/shell/workspace.mjs`、`next/shell/paneForms.mjs`、`next/kernel/carrierManifest.mjs`、`next/host-descriptor.json`、`next/doctor.mjs`、`next/shell/AppNext.vue`、`next/shell/styles/next-shell.css`、七块文档面载体的 `next/carriers/{novel,outline,notes,worldbook,setting,reference,script}/manifest.mjs`（只动 forms 数组）
- 闸与审计：`next/runtime/kernelWriteGuard.mjs`、`next/runtime/writePolicy.mjs`、`next/runtime/surfaceAggregate.mjs`
- 配置：`next/settingsStore.mjs`（新）、`next/shell/ipcContract.mjs`、`next/shell/main.mjs`、`next/shell/SettingsModal.vue`、`next/shell/settings/CarrierSettingsGeneric.vue`（新）
- 解注册：`next/shell/viewRegistry.mjs`、`next/project/carriers.mjs`（如需）、`next/shell/main.mjs`（如需，禁用链路侧）、`next/kernel/pluginRegistry.mjs`（如需，仅注释/钩子确认）
- 测试：`next/tests/` 与 `next/tests/*.spec.mjs` 相应新增/调整；`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs` 仅在计数/断言确需同步时改并写明理由
- `docs/plan/` 本工单 §7 回填不新增文件

## 禁止边界

1. 不改 `server/**`、`src/**`（老线只读；import 例外维持现状）。
2. 不新增 npm 依赖；不加新 IPC 通道白名单之外的任意执行口。
3. 不动 12 载体 manifest 的 tools/context/entry/services/mcp 声明（本批只许动七块文档面的 forms 数组）。
4. novel.writing 偏好不迁移、不改 WritingPrefsSection 行为。
5. 不改提案 schema（`pinax-proposal@1`）、不改 fileService 三道闸语义、不改 `guardCarrierWriteGaps` 门禁语义。
6. 不启动/不杀 electron 进程；不执行 git 命令。

## 守卫标记（收尾自查＋调度方评审对照，这些既有修复不许在本批丢失）

- `next/shell/IndexWindow.vue` 不出现「只读归档」；
- `next/shell/styles/next-shell.css` 保留 `.editor-area:focus-visible { outline: none`；
- `next/shell/AppNext.vue` 保留 `overlayPane?.id === id` 分屏映射、无 card* 死代码块；
- `next/shell/wikiLinks.mjs` 保留 `buildEntryTokenMap`；`next/shell/formTaxonomy.mjs` 三档与八视图词表完整；
- `next/shell/useBoardData.mjs` 保留 `AUTOSAVE_DELAY_MS` 自动保存链。

## 测试与断言纪律

- 词表类既有断言（PLACEMENTS↔PANE_FORM_WORDS 相等、manifest forms 校验、doctor 对表、view-registry HOST_VIEW_TYPES）随本批扩展属**预期漂移**：改断言必须在 §7 写明理由，不许静默放宽。
- acceptance.mjs 的 toolCount/carrierTools 计数本批不应变化（无新工具）；若执行中发现必须变，先停下在 §7 说明，不许顺手改。
- 新测试命名与分层照惯例：纯逻辑 `next/tests/*.test.mjs`（node --test），界面 `next/tests/*.spec.mjs`（vitest＋jsdom）。

## 门禁要求（完成定义）

```
npm run next:build:main && npm run next:build:shell   # 重建通过
npm run verify:next                                    # 五段全绿
```

---

## §7 执行方回填（执行完成后填写）

### 交付清单

**① 沉浸态（placement 第五值）**
- `next/shell/workspace.mjs`：`PLACEMENTS` 加 `immersive`；`FULL_WINDOW_PLACEMENTS`／`isFullWindowPlacement` 把沉浸与全屏归为整窗，复用同一套 restore 记忆与整窗几何；另补 `removePanes(paneIds)`（任务④用，逐条删除实例并提交）。
- `next/shell/paneForms.mjs`：`PANE_FORMS` 加 `immersive`，`PANE_FORM_LABELS.immersive = '沉浸'`。
- `next/kernel/carrierManifest.mjs`：`PANE_FORM_WORDS` 加 `immersive`，forms 越界报错文案同步。
- `next/host-descriptor.json`、`next/doctor.mjs`：形态词表对表同步；十二个内置载体清单的 doctor 校验仍全过。
- 七块文档面载体 `next/carriers/{novel,outline,notes,worldbook,setting,reference,script}/manifest.mjs`：文档面 pane 的 `forms` 加 `immersive`；五块记录型载体不动。
- `next/shell/AppNext.vue`：`immersiveTarget` computed；进入／退出沉浸；顶栏退出按钮；Esc 退出（活动浮窗先收）；沉浸时 `ActivityRail`／右栏运行坞 `v-show` 让位（运行坞用 `v-show` 保留会话状态）；右键「打开方式」与页内菜单出现「沉浸／退出沉浸」。
- `next/shell/styles/next-shell.css`：顶栏沉浸退出按钮的 `-webkit-app-region: no-drag`。
- 测试：`next/tests/workspace.test.mjs`、`pane-forms.test.mjs`、`visual-contract.test.mjs`、`doctor.test.mjs`、`manifest-v2.test.mjs`、`next/tests/shell-ui.spec.mjs`。

**② 写族闸收口（外部 MCP 工具）**
- `next/runtime/kernelWriteGuard.mjs`：`EXTERNAL_WRITE_HINT` 与 `isExternalWriteToolName`（`_save/_write/_import/_delete/_create/_update` 后缀）。
- `next/runtime/writePolicy.mjs`：写族判定改为「落点表 ∪ 外部后缀启发式」；review 档转 `dir:null` 的 tool-call 提案，auto 放行，blocked 拒绝并明说是外部写工具。
- `next/runtime/surfaceAggregate.mjs`：模块级 50 条写调用审计环（`recentWriteCalls()`），载体分支按 `annotations.readOnlyHint === false` 记录，外部分支按后缀启发式记录；不改放行行为。
- `next/testing/fixtures/mcpEchoServer.mjs`：补 `echo_save` 写工具描述符。
- 测试：`next/tests/write-policy.test.mjs`（六后缀／review 提案／auto／blocked／读口放行）、`next/tests/write-family-external.test.mjs`（真 stdio 夹具：review 不执行远端＋不记审计、auto 直执行＋审计归属、外部读口不审计、载体分支审计）、`next/tests/mcp-client.test.mjs`（工具名清单同步）。

**③ 每插件配置命名空间＋通用渲染器**
- `next/settingsStore.mjs`（新）：`.pinax/settings.json`，形状 `{version:1, carriers:{<carrierId>:{<settingId>:value}}}`；tmp＋rename 原子写、内容不变不写、坏文件回空并 console 记账；唯一写闸 `set()` 只认清单声明，按声明类型（string/number/boolean/enum/section）校验，未声明／类型不符／section 存值一律拒且不落盘。
- `next/shell/ipcContract.mjs`：新增 `settings:load`／`settings:save` 两条通道与 `settingsStoreFor` 依赖；未注入／未开项目如实报缺。
- `next/shell/main.mjs`：按当前项目根懒建 `settingsStore`，声明从 `session.registry` 现取（不在主进程复制第二份清单）。
- `next/shell/settings/CarrierSettingsGeneric.vue`（新）：按声明渲染文本／数字（声明了 min/max/step 才带）／开关／下拉／分组标题；值经 IPC 读写，保存反馈沿用 `.nx-save-chip`。
- `next/shell/SettingsModal.vue`：保留 `novel.writing → WritingPrefsSection` 硬编码映射（不迁移）；其余带受支持 `type` 的声明走通用渲染器；无 type 也无渲染器的仍出既有空态文案。`AppNext.vue` 给 `SettingsModal` 传 `bridge`。
- 测试：`next/tests/settings-store.test.mjs`（原子写／坏档回空／白名单拒／类型与 enum 校验／内容不变不写／声明 getter／IPC 集成）、`next/tests/carrier-settings-generic.spec.mjs`（四类控件＋数字属性、读回已存值、写回与反馈、未声明拒、section 不存值、SettingsModal 路由、无 type 空态）。

**④ 解注册接线**
- `next/shell/AppNext.vue`：新增 `releaseCarrierPanes(carrier)`——先 `hostViewRegistry.disposeOwner(carrier.id)`，再把该载体清单 pane id（并用视图里的 `pluginId` 兜一层）交给 `hostWorkspace.removePanes()`，清掉 `#1` 与多开 `#n` 的 placement／geometry／minimized／pinned；`setCarrierEnabled` 在停用时先走这一步再发 `carrierSetEnabled`（随后 `refresh`）。
- `next/shell/viewRegistry.mjs`：`disposeOwner` 用途注释改为「载体停用：外壳先释放它注册的视图，再清工作区实例、交内核重建」。
- `next/shell/ipcContract.mjs`：`view.runtime` 与 `carrierSetEnabled` 分支补合同注释——运行时自身不可停用；载体停用走重建＋pane 关闭＋工作区清理（服务／MCP／工具面随 `session.refresh` 收掉）。
- `next/kernel/pluginRegistry.mjs`：未改。确认 `onDispose` 仍幂等（重复调用只跑一次）、`uninstall` 广播行为不变；`registry.dirOf` 对被禁载体的行为由既有 rebuild 路径保持。
- 测试：`next/tests/shell-ui.spec.mjs` 新增「停用载体＝解注册」用例——载体 owner 的视图被 `disposeOwner` 释放且宿主内置视图不受影响；该载体 `#1`／`#2` 实例全部清出工作区存档，小说沉浸态原样；缺省实例回 dock（geometry null／pinned false）；项目事件订阅照常；再启用后浮窗从干净工作区重开。`next/tests/workspace.test.mjs` 新增 `removePanes` 单测（多实例全清、别的 pane 不动、重复清理 no-op）。`next/tests/shell-contract.test.mjs` 的 `runtime.disableable === false` 断言保留并补理由注释。

### 门禁自报

```
npm run next:build:main && npm run next:build:shell   通过
  next/.build/pinax-next-main.mjs      1,154.35 kB
  next/.build/pinax-next-shell-main.mjs 1,914.88 kB
  next/.build/preload.mjs                  4.46 kB
npm run verify:next                                    通过（五段全绿）
  1) acceptance：M1 空框架＋M2 真载体验收 20/20
     toolCount 未变：运行时 20；聚合面 37／carrierTools 22；记录面 43／carrierTools 23
  2) node --test next/tests/*.test.mjs：518 passed / 0 failed
  3) vitest（jsdom）：7 files / 157 tests passed
  4) eslint next --max-warnings 0：0 errors / 0 warnings
  5) bundleAssertions：构建参数／裸导入白名单／无 Express／产物可执行全通过
```

### 偏离

1. 工单测试纪律里写的是 `PLACEMENTS↔PANE_FORM_WORDS`，外壳侧实际导出名是 `PANE_FORMS`（`next/shell/paneForms.mjs`）。本批沿既有导出名扩展，未改名（改名会波及大量调用点，且不属于本批范围）。
2. 工单 §④.3 写「`ipcContract.mjs`（:221-232 附近）『运行时不可停用』合同表述」——该文件此时没有这句话（`disableable` 只是从 `RUNTIME_CONTRACT` 透出）。处理方式是：在 `view.runtime` 与 `carrierSetEnabled` 分支补合同注释，把「运行时不可停用／载体停用＝重建＋pane 关闭＋工作区清理」写清；`runtime.disableable === false` 的断言值保留（运行时确实仍不可停用），只补理由注释，未放宽断言。
3. 配置存储没有走 `session` 方法：`next/index.mjs` 不在允许文件清单内，故在 `main.mjs` 用 `createIpcDispatcher` 的 `settingsStoreFor(root)` 依赖注入接入，按项目根懒建并随注册表现取声明。
4. 词表类既有断言按预期漂移：`workspace.test.mjs`（placement 五档）、`pane-forms.test.mjs`、`manifest-v2.test.mjs`、`doctor.test.mjs`、`visual-contract.test.mjs` 随「沉浸态」扩展；`view-registry` 的 `HOST_VIEW_TYPES` 本批未动（八视图是批次44 的既定词表），相关用例原样通过。`acceptance.mjs` 与 `bundleAssertions.mjs` 未改（计数确无变化）。

### limitations

1. 数字输入的 `min/max/step`：通用渲染器在声明对象带这三个字段时会照渲染，但 `carrierManifest.validateSettings` 目前只白名单 `id/title/type/default/options`，内置载体清单无法声明它们；按禁止边界未改 manifest 校验，因此实际生效范围仅限将来放开声明后。
2. `disposeOwner` 在生产路径当前基本是零命中：宿主单例把八种宿主视图＋`pinax.view.custom` 都注册为 `builtin`，而 v2 第三方尚不能真正注册视图。本批完成的是「禁用必调用」的接线，测试里用临时注册到载体 owner 的 custom 视图证明调用真实生效，并在用例结束后恢复宿主注册。
3. 停用清理发生在 `carrierSetEnabled` 发出之前（按工单「重建前」的要求）。若内核以 `STALE_REVISION` 等拒绝停用，pane 已在渲染层关闭、工作区已清；刷新后载体仍为启用状态，重新打开 pane 即可，未做失败回滚。
4. 沉浸态真窗口实拍（Playwright）按 §8 由调度方接管；本批仅在 jsdom 界面测试与重建产物层面验证，未启动／未杀 Electron 进程。
5. 设置文件损坏时的 `warnings` 目前只在 store 读回载荷里，设置弹窗未展示告警条（本批未要求）。
6. `settingsStore` 的写盘队列只在 `set()` 内串行；外部直接改文件不会被感知（与 workspaceStore 同款语义）。

## §8 调度方验收（Zcode 填，执行方不要动本节）

- 独立复跑五段门禁；评审员对照工单读未提交 diff；守卫标记 grep；断言漂移逐条核对理由。
- 沉浸态真窗口实拍（Playwright）由调度方接管；禁用解注册用运行时进程内测试验证。
- 验收结论与批次记录落 `docs/plan/pinax-electron-next-m2-batch45-20261031.md`（调度方写）。
