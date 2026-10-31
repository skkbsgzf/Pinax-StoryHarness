# 载体内核深化排线 · 工单包（批次50–57）：把 Cordis 的参考落成能干的活

日期：2026-10-31 · 立项依据：[Cordis／dsh 内核对照评估](./pinax-cordis-dsh-kernel-evaluation-20261031.md)
路线裁定：**甲（协议层对齐）＋乙（只借语义不借包）**，丙（嵌内核）已否掉——本文不再重复论证，只排活。
基线：批次49 已收口，门禁为**验收 23/23、内核 562/562、界面 179/179、eslint 0 警、打包 a–n3＋l 系全过**。12 份载体清单、69 个 `.test.mjs` ＋ 13 个 `.spec.mjs`。

---

## 0. 先说怎么用这份文档

- **线 A（批次50、51）现在就能开工**：不动协议面、不打回既有工具、不碰 12 份清单，纯收口执行合同与卸载纪律。它的收益是**消掉两个已经写进文档的真实风险**（外部工具写族靠名字后缀猜；插件卸载残留无断言）。
- **线 B（批次52–54）需要你先点名**：三批都动协议面。按你在 v3 那轮定的口径——**协议先一次收口，再改 12 载体**——所以批次52（schema）与批次53（12 载体迁移）必须连着批、不能夹带第三批功能进去。
- **线 C（批次55–57）是体感与工程基建**：批次55（渲染器＋长稿分页）建议排在批次53 之后立刻做，因为它是你天天能看见的那一处（编辑器仍是 textarea、《大梦》正文 1 MB 级整读）。

**建议顺序**：`50 → 51 → 52 → 53 → 55 → 54 → 56 → 57`。理由：50/51 是还债且零外部影响；52/53 是合同收口，后面 55/56 都要吃它的字段；54 是运维收益（不挡作者视线，可插队）；56 最重（要打回全部存量认领工具），单独留出成本；57 在词表稳定后才有生成源。

**数值口径（照你既有的裁定走）**：本文所有"记账指标"只进账本与复核清单，**不设隐形阈值、不当代打回依据**；打回只来自确定性完整性（校验器、门禁、断言）或你点名。每个新增数值线都标了「需人裁留名」。

---

## 1. 排线总览

| 批次 | 线 | 一句话工程收益 | 依赖 | 动协议 | 打回既有 | 规模 | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 50 | A | 外部 MCP 工具的写族判定从**名字后缀猜测**换成工具自带 annotations，猜错就漏闸的那扇门关上 | 无 | 否 | 否 | 小（2–3 文件） | 低 |
| 51 | A | 插件卸载从手工配对变成**注册即返回 disposer、逆序回卷**，卸载残留进门禁断言 | 无 | 否 | 否 | 中（3–5 文件） | 中（碰到 registry 全局） |
| 52 | B | 清单 @4 四组声明面：槽语义四态／资源认领（patterns＋priority＋canOpen）／渲染器注册／合同上界 `maxKernel` | 50、51 | **是** | 否 | 大（校验器＋夹具） | 中 |
| 53 | B | 12 载体迁 @4，宿主真消费：争用按 priority/canOpen 裁决，**批次44 那个 kind 例外表清零** | 52 | 是 | 是（12 清单＋测试断言） | 大 | 中高（并行会话热点） |
| 55 | C | 渲染器可被载体按扩展名接管＋长稿**分页读**，正文面不再是 textarea 一条路 | 52 | 是（消费 previews） | 否 | 大（渲染层） | 中 |
| 54 | B | 工程层覆盖插件默认值（改端口不动插件文件）＋仅 volatile 可 GUI 写＋设置 dump 出 JSON Schema | 52 | 是（消费 settings） | 否 | 中 | 低 |
| 56 | C | 工具强制声明输出 schema＋判别式成功/失败体＋协作式取消；Agent 面从"约定返回"变"合同返回" | 52 | 是（tools 字段扩） | **是（全部存量认领工具）** | 特大 | 高（成本要你认） |
| 57 | C | `host-descriptor.json` 由注册表**自动导出**＋每载体结构化 README＋开发者指南接生成器，手写文档不再漂移 | 52、53 | 否 | 否 | 中 | 低 |

---

## 2. 批次50 工单：工具执行拦截点＋写族判定去启发化

**目标**：给工具执行加一层**环绕式拦截点**（可否决、可记账、可改写结果），并把外部 MCP 工具的写族判定从名字后缀猜测换成工具自身声明的注解。

**背景（Cordis 对应物 → 我们的欠账）**：dsh 的事件面有 `waterfall` 分发（处理器拿到 `next`，不调即否决；`prepend:true` 抢前置），工具面有 `tools/pre-execute｜execute｜post-execute｜result` 四个拦截点。我们这边：[next/runtime/kernelWriteGuard.mjs:48](file:///D:/Pinax-main/Pinax-main/next/runtime/kernelWriteGuard.mjs#L48) 的 `EXTERNAL_WRITE_HINT = /_(save|write|import|delete|create|update)$/u`，[:51](file:///D:/Pinax-main/Pinax-main/next/runtime/kernelWriteGuard.mjs#L51) 用它判外部工具，[next/runtime/writePolicy.mjs:53](file:///D:/Pinax-main/Pinax-main/next/runtime/writePolicy.mjs#L53) 的"写族三支"第三支就是这条后缀。后果在[开发者指南 §6](file:///D:/Pinax-main/Pinax-main/docs/plan/pinax-plugin-author-guide-20261031.md#L70)里自己写着：「外部 MCP 写工具按名字后缀启发式进写族——你的外部工具命名请避开这些后缀除非它真是写操作」。**一个真写盘却叫 `comfy_submit` 的工具会绕过写族闸；一个只读却叫 `xxx_save` 的工具会被拖进 review 档。** 这是当前内核面最实在的一处误判敞口。

**任务**

1. **拦截点模块** `next/runtime/toolInterceptors.mjs`（新）：`createInterceptorChain({ interceptors })`，导出 `runBefore(name, args, ctx)`（任一返回 `{ veto: true, reason }` 即拒，顺序执行，后者拿不到被否决的调用）、`runAfter(name, result, ctx)`（不改结果，只记账）。执行侧接入点：[next/runtime/toolLoop.mjs:92](file:///D:/Pinax-main/Pinax-main/next/runtime/toolLoop.mjs#L92) `createToolLoop` 与 [next/runtime/toolTurn.mjs:70](file:///D:/Pinax-main/Pinax-main/next/runtime/toolTurn.mjs#L70) `createKitToolTurn` 的实际调用处，**不新建第二条执行路**。
2. **写族判定改锚 annotations**：`next/runtime/mcpClient.mjs` 连上后把每个工具的 `annotations`（MCP 规范字段 `readOnlyHint`／`destructiveHint`／`idempotentHint`／`openWorldHint`）挂到工具元数据上；`writePolicy.mjs` 第三支改成**三级优先**：① 工具声明 `annotations.readOnlyHint === true` → 判读；② `destructiveHint === true` 或非只读 → 判写；③ **两者都没声明**才回落 `EXTERNAL_WRITE_HINT`，并在池里记一条 `level:'warn'` 的"该工具无写声明，按后缀兜底"（复用批次49 的 `serviceLogPool` 出口，作者能在设置节看见）。
3. **拦截点装两个内置消费者**（证明这层真有用，不做成空框架）：① 写族闸消费者——把现在散在执行路的写策略判定收进 `runBefore`，返回体带 `guardDecision` 便于测试；② 审计环消费者——`runAfter` 把 review 档直执行的提交类工具（先例：`comfy_submit`）记进池，替掉零散 console 记账。
4. **反向断言进验收**：`next/tests/tool-interceptors.test.mjs`（新）必须含一条「annotations 与后缀不一致时**以 annotations 为准**」的用例（造一个只声明 `readOnlyHint:true` 却叫 `fake_save` 的夹具工具，断言它被判读），和一条「两者全无声明时回落后缀且记账」的用例。

**允许文件**：`next/runtime/toolInterceptors.mjs`（新）、`next/runtime/kernelWriteGuard.mjs`、`next/runtime/writePolicy.mjs`、`next/runtime/mcpClient.mjs`、`next/runtime/toolLoop.mjs`、`next/runtime/toolTurn.mjs`、`next/shell/main.mjs`（接线）、`next/tests/tool-interceptors.test.mjs`（新）＋受影响测试、`next/testing/acceptance.mjs`（计数同步写理由）。

**禁止边界**：不改 `server/**`、`src/**`；不加 npm 依赖；**不动清单 schema**（@4 的事留给批次52）；不改 `expectedRevision` 语义与 `STALE_REVISION` 拒绝行为（[next/fs/fileService.mjs:14](file:///D:/Pinax-main/Pinax-main/next/fs/fileService.mjs#L14)）；`server/mcp` 的 19 工具合规面不动；不启动/不杀 Electron；不执行 git 命令。

**验收判据（完成定义）**：`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段全绿；新增内核用例 ≥6 条；「annotations 优先于后缀」与「无声明回落并记账」两条断言存在且非空转；grep 确认 `EXTERNAL_WRITE_HINT` 只剩一处引用点（writePolicy 的兜底支），不在其它文件被复制。

**记账指标（不进闸）**：现网（12 载体＋ComfyUI 桥＋夹具）里 annotations 缺失的外部工具条数；后缀兜底命中次数。→ **需人裁留名**：是否要把"外部 MCP 工具必须声明 annotations"升级为拒装级，请你点名。

**规模**：小–中（2–3 个改文件＋1 新文件＋测试）。

---

## 3. 批次51 工单：可逆效应纪律（注册即 disposer，逆序回卷）

**目标**：把"注册一个东西就要负责拆掉它"从人工默契变成**接口合同**，并让卸载残留可被门禁抓到。

**背景（Cordis 对应物 → 我们的欠账）**：`ctx.effect(execute, label?)` 的形态是**execute 立即跑、返回一个 disposer**（可以是 async disposer，生成器可逐 yield 注册多段），回卷按注册**逆序**启动，向已 dispose 的 fiber 注册直接抛 `INACTIVE_EFFECT`。我们的 [next/kernel/pluginRegistry.mjs](file:///D:/Pinax-main/Pinax-main/next/kernel/pluginRegistry.mjs) 有 `disposePlugin`（:31）与 `onUninstalled`（:132），但退订靠各调用方自觉：历史账本里已经踩过两次——「假桥的旧函数引用不会退订」（批次37）、「`disposeOwner` 没接线」（批次45–48 守卫清单里挂着）。**残留不是理论风险，是这个仓反复复发的 bug 类别。**

**任务**

1. **`registerEffect(pluginId, setup, label?)`**：新增到 registry 面（放在 `createRegistry` 里，与 `disposePlugin` 同文件），`setup(ctx)` 必须**返回 disposer 或 disposer 数组**；返回 `undefined` 即 `fail('INVALID_EFFECT', ...)`——**拒收"注册了但没法拆"的注册**，这与 v3 的"声明了不生效就拒装"（[carrierManifest.mjs:37](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L37) `V3_ONLY_FIELDS` 的纪律）是同一条哲学，不是新规矩。
2. **逆序回卷＋失败不中断**：`disposePlugin` 改为按注册逆序跑 disposer，单个抛错只记 `serviceLogPool` 的 `level:'error'` 条目并继续拆（照 Cordis 的"吞错继续拆"，但**必须留痕**，不许静默）；全部拆完才允许从注册表移除。
3. **向已卸载插件注册即抛**：等价 `INACTIVE_EFFECT`，新增错误码 `EFFECT_ON_DISPOSED`（走 [next/kernel/errors.mjs](file:///D:/Pinax-main/Pinax-main/next/kernel/errors.mjs) 既有码表家族，不新造格式）。
4. **存量迁移（只做四处，不撒网）**：事件总线订阅（`runtime/eventBus.mjs`）、视图注册表 owner 卸载（`shell/viewRegistry.mjs` 的 `disposeOwner`）、面板桥监听（`shell/pluginBridge.mjs`）、运行时服务事件订阅（`shell/main.mjs` 里对 supervisor 的 push 订阅）——这四处改为走 `registerEffect`，其余保持现状但在 `docs/plan` 记一张未迁移清单。
5. **门禁接线**：`next/tests/plugin-registry-effect.test.mjs`（新）三条硬断言——① 不返回 disposer 的注册被拒；② 卸载后事件总线上该插件的监听器数量为 0（用 `eventBus` 的可观测接口，不许靠"没报错"间接判）；③ 一个 disposer 抛错时其余仍被执行（逆序顺序也断言）。

**允许文件**：`next/kernel/pluginRegistry.mjs`、`next/kernel/errors.mjs`、`next/runtime/eventBus.mjs`（暴露计数只读接口）、`next/shell/viewRegistry.mjs`、`next/shell/pluginBridge.mjs`、`next/shell/main.mjs`、`next/tests/plugin-registry-effect.test.mjs`（新）＋受影响测试、`next/testing/acceptance.mjs`。

**禁止边界**：不改插件加载为进程外（`trustMode` 仍 `same-process`，见 [next/host-descriptor.json](file:///D:/Pinax-main/Pinax-main/next/host-descriptor.json)）；不引入 `AsyncDisposable`/`Symbol.dispose` 之类需要新 TS/Node 特性的写法（本机 dev 线 Node `>=22.13 <23`，别赌）；不动清单 schema；不加 npm 依赖；不改 supervisor 的 spawn／退避重启语义（[next/runtime/serviceSupervisor.mjs:77](file:///D:/Pinax-main/Pinax-main/next/runtime/serviceSupervisor.mjs#L77)）；不起 Electron、不执行 git。

**验收判据**：`verify:next` 五段全绿；三条硬断言存在；批次45–49 守卫清单全部继承（含 `disposeOwner` 接线那条，本次由"手工接线"升级为"接口强制"）。

**规模**：中（5 文件迁移＋1 新模块＋测试）。

---

## 4. 批次52 工单：载体清单 @4 的 schema 与校验（协议一次收口）

> **这条需要你先点头**：四组新字段都动协议面。按 v3 那轮的口径，本批**只收口协议、不动 12 载体**，载体迁移在批次53。

**目标**：`pinax-carrier@4` 落地四组声明面，每组都有独立校验器、独立夹具、独立用例，且**老版本写了新字段照旧拒装**（沿用 `V3_ONLY_FIELDS` 的纪律，改名 `V4_ONLY_FIELDS`）。

### 4.1 四组字段（逐项带 Cordis 出处与我们的落点）

1. **槽语义四态**（对 `ctx.slots` 的 `SlotKind = single｜list｜keyed｜chain`）
   - 现状：[carrierManifest.mjs:113](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L113) `OPEN_SLOTS = ['left-dock','center','overlay']` 只说"放哪"，不说"能开几块、绑不绑会话"；多实例是**运行时约定**而非合同——[next/shell/workspace.mjs:19](file:///D:/Pinax-main/Pinax-main/next/shell/workspace.mjs#L19) 定 `<paneId>#<n>`，[:70](file:///D:/Pinax-main/Pinax-main/next/shell/workspace.mjs#L70) `instanceIdFor(paneId, index=1)` 造 id，[:77](file:///D:/Pinax-main/Pinax-main/next/shell/workspace.mjs#L77) 解析时"不带 # 的旧写法当作 #1"（M2.5-C 的 C2 落的地基）。清单里没有任何字段能说"这块 pane 允不允许开第二份"。
   - @4 新增：`pane.multiplicity = single | list | keyed`（`chain` 我们暂时用不上，**登记为未采用**，避免以后有人照着抄出第五态）与 `pane.scope = project | entry | session`（绑什么上下文）。校验：`keyed` 必须给 `pane.keyField`；同一 pane 声明 `single` 却在工作区里有 >1 实例 → `doctor` 报错而非静默复用。
2. **资源认领与接管**（对 `ctx.sidebarRightTabs.register({patterns, priority, canOpen, builtin|extension|fallback})`）
   - 现状：载体认领目录用 [carrierManifest.mjs:419](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L419) `validateDataDirs`（目录唯一主人硬规定），**没有"两个载体都想显示同一条资源"的裁决**；批次44 被迫在测试里登记 `KIND_OVERRIDES_BY_PANE_ID` 例外表（[next/tests/carrier-v3-rollout.test.mjs](file:///D:/Pinax-main/Pinax-main/next/tests/carrier-v3-rollout.test.mjs)）——那是权宜，不是设计。
   - @4 新增：`pane.claims = ['世界书/**/*.md', '素材/**.json']`（glob，只允许项目内相对路径、禁绝对路径与 `..`）、`pane.priority = 0..100`、`pane.canOpen = { field, equals | in }`（**声明式谓词，不许塞 JS**——我们是 JSON 清单，塞函数就等于开 RCE 口）；接管档 `pane.takes = 'extension' | 'fallback'`，`builtin` 由宿主保留。
   - 校验器：`validateClaims`（新）复用 [carrierManifest.mjs:443](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L443) `validateAppPane` 那套"地址/路径纪律"的写法：长度上限、字符集、协议白名单三件套一条不少。
3. **渲染器注册**（对 `ctx.documentPreviews.register({extensions, priority, loading: 'text-pages'|'bytes-complete', wrap})`）
   - @4 新增：`preview.register = [{ id, extensions: ['.md','.txt'], priority, loading: 'text-pages' | 'bytes-complete', maxBytes }]`。`loading` 这一档是本次最值钱的借鉴——它把"大文件怎么读"写进合同，批次55 直接消费。校验：`extensions` 必须是小写带点、`maxBytes` 有上限（沿用现有 `*_MAX` 常量家族，见 [carrierManifest.mjs:73-84](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L73)）。
4. **合同上界与粒度**（对 `engines.dsh` 的 SemVer 区间）
   - 现状**订正**（我初稿判成"死标签"，复核后改）：下限闸已经有了——清单可声明 `minKernel`，[carrierManifest.mjs:392](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L392) `compatibleKernel()` 比对、[:152](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L152) 不符即 `KERNEL_INCOMPATIBLE` 拒装，[next/doctor.mjs:75](file:///D:/Pinax-main/Pinax-main/next/doctor.mjs#L75) 给 `needs-host-upgrade` 修法。真差口是三条：**只比 major**（`split('.')[0]`）、**没有上界**（为合同 1 写的插件无法声明"合同 2 会坏"）、**没有豁免通道**。
   - @4 新增：`maxKernel`（与 `minKernel` 成对出现才有效，缺省＝不设上界，保持既有清单行为不变）＋把比对粒度从 major 降到 `major.minor`；**豁免机制先不做**（v3 定的"声明了不生效就拒"不允许半成品豁免，登记为未采用）。
   - 硬要求：改 `compatibleKernel` 是**收紧既有闸**，必须先在测试里证明 12 份现有清单全部仍能装上（现在它们都写 `minKernel: '1'`，见 [next/carriers/comic/manifest.mjs:30](file:///D:/Pinax-main/Pinax-main/next/carriers/comic/manifest.mjs#L30)），任何一条被误拒就是回归。

### 4.2 本批的验收判据（完成定义）

- `npm run verify:next` 五段全绿；`@4` 进 `SUPPORTED_CARRIER_SPECS`，`CARRIER_SPEC` 指向 `pinax-carrier@4`，**@1/@2/@3 仍可读**（向后兼容是硬要求，不许让《大梦》工作副本现在就读不动）。
- 夹具插件（`next/testing/fixtures/`）出一个 `@4` 全字段样例；用例含：四组字段各自的**非法输入各 ≥3 条**（超长、非法字符、越界、缺配对字段）；一条「@3 清单写 `claims` 必须被拒」。
- `next/testing/acceptance.mjs` 与 `bundleAssertions.mjs` 的计数同步**逐处写理由**（不许静默改数）。
- **反向断言**：一条用例证明"未消费的协议字段会被拒装"——即本批声明的每个字段都要有宿主侧读取点，读不到的字段先别进协议。这条是防我们自己也长出死字段。

**允许文件**：`next/kernel/carrierManifest.mjs`、`next/kernel/capabilities.vocab.mjs`、`next/doctor.mjs`、`next/host-descriptor.json`、`next/tests/carrier-v4-*.test.mjs`（新）、`next/testing/fixtures/**`、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`。

**禁止边界**：本批**不改 12 份载体清单**（批次53 的活）；不改 `PANE_KIND_WORDS` 既有 14 值的语义（只加，不动旧值）；不动外壳渲染层；不改写族/revision 语义；不加 npm 依赖；不起 Electron、不执行 git。

**规模**：大（校验器四个＋夹具＋用例；`carrierManifest.mjs` 现在 1017 行，预计 +300～400 行——**若超 1400 行需先拆文件再收口**，拆法在工单里定：`carrierManifest.mjs` 留词表与主入口，四组字段各进 `carrierManifest.claims.mjs` 等，禁止测试去读私有函数）。

---

## 5. 批次53 工单：12 载体迁 @4 ＋ 宿主真消费

**前置**：批次52 收口。**依赖风险**：本批与并行会话最可能撞（`next/carriers/**` 是热点目录），派单前先看 `docs/STATUS.md` 的「当前安排」表确认没人占。

**目标**：12 份清单升到 `pinax-carrier@4` 并填上新字段；宿主真消费，把"两个载体争一条资源"从人工裁决变成合同裁决。

**任务**

1. 12 份 `next/carriers/*/manifest.mjs` 升 spec＋填 `multiplicity/scope`（逐份写为什么这么定，不许整批复制粘贴同一值——小说正文是 `single＋entry`，世界书条目是 `keyed＋entry`，素材看板是 `single＋project`）。
2. `shell/viewRegistry.mjs` 与 `shell/useBoardData.mjs`（2376 行，**改动要小切口，禁止顺手重构**）：按 `pane.priority` 与 `canOpen` 谓词裁决同一资源的归属面板；裁决过程记一条可观测结果（测试要能断言"谁赢了"）。
3. **清掉批次44 的例外表**：`KIND_OVERRIDES_BY_PANE_ID`（在 `next/tests/carrier-v3-rollout.test.mjs`）应当能被 `@4` 的 `claims/multiplicity` 正面表达而删除。删除时**必须**在同批测试里补等价断言（世界书两块 pane 的形态不许回退），这是你定的"断言漂移要改断言并记理由，不许静默"。
4. 《大梦》工作副本 `D:\Projects\大梦` 的启用清单同步 @4；**C 盘原稿仍一个字不碰**（v3 那轮的硬口径）。
5. 打包断言：12 块载体的 @4 清单全进包、字段齐全（`bundleAssertions.mjs` 加一条新守卫，命名延续 a–n3/l 系）。

**验收判据**：`verify:next` 全绿；`grep -rn "pinax-carrier@3" next/carriers/**` 归零（`@3` 只在 `SUPPORTED_CARRIER_SPECS` 与兼容用例里存在）；例外表已删且有等价断言；真窗口至少拍一张世界书与素材争用裁决的界面（沿用 `scripts/tmp-next-dameng-capture.mjs` 那套路子）。

**规模**：大（12 清单＋2 外壳文件＋测试＋打包）。

---

## 6. 批次55 工单：渲染器注册＋长稿分页读（体感优先）

> 编号排在 54 前：**55 是你天天看见的那一处**——编辑器仍是 textarea（[开发者指南 §6](file:///D:/Pinax-main/Pinax-main/docs/plan/pinax-plugin-author-guide-20261031.md#L70)：「编辑器是 textarea（md 单真源，R1）；PM 块编辑器/行内 ghost/批注是协议级岔口，未裁」）。

**目标**：消费批次52 的 `preview.register`，让正文/条目面按扩展名与声明接管渲染，并落地"大文件怎么读"的合同。

**任务**

1. `fs/fileService.mjs` 增**只读分页口** `readRange({ pluginId, dir, file, from, to })`（**绝不与写口混用**：写仍必须 `expectedRevision`，见 [:116](file:///D:/Pinax-main/Pinax-main/next/fs/fileService.mjs#L116)）；按字节区间读，返回 `{ text, from, to, totalBytes, revision }`。
2. 渲染层：按 `preview.loading` 分两档——`text-pages` 首次只读首屏若干 KB 并懒补（滚动/翻页），`bytes-complete` 保留整读（小文件、写前校验用）。载体可用 `register` 指定哪个 pane 用哪档。
3. 治理"看着能点却点不动"的老问题在新路径上的复发面：分页渲染后，批次38/44 的 Wiki 双链词表（`shell/wikiLinks.mjs` 的 `buildEntryTokenMap` 唯一归属才进词表）**必须对每页各自生效**，跨页残留锚点用批次44 那招 `:key` 强制重渲染（先例已记在批次44 踩坑账）。
4. 不做块编辑器（PM 岔口仍未裁，本批不碰），textarea 保留为"编辑态"，`text-pages` 只服务"阅读态＋大稿"。

**验收判据**：用《大梦》真稿（1 MB 级）量一次首屏读取字节数与首绘时间，**只记账**；用例含"分页读的 revision 与整读一致""跨页不残留旧蓝链"；`verify:next` 全绿。

**规模**：大（fileService＋渲染层 2–3 文件＋测试）。

---

## 7. 批次54 工单：配置分层与 volatile（运维收益）

**目标**：作者改一个端口／一条路径，不该去动插件源码。

**背景**：dsh 的配置层序是 bundle patch → profile patch → home patch → `--patch`（按 id 后写胜），且"仅 `volatile()` 字段 GUI 可写"。我们现在：载体默认值写在 `next/carriers/comic/manifest.mjs` 的 `services` 里，**换端口只能改插件文件**；`.pinax/settings.json` 外部直改不热感知（开发者指南 §6）；数字设置 min/max/step 渲染就绪但校验白名单未放开（潜伏能力）。

**任务**：工程级覆盖文件 `.pinax/carrier-overrides.json`（`{ pluginId: { paneId?/serviceId?/settingId?: 值 } }`）；合并序＝**清单默认 → 工程覆盖**，两级即可（**不引入他们四级层叠**——那是多 profile 产品需要的，我们没有 profile 概念，硬抄只会让 doctor 说不清"这个端口是谁定的"）；覆盖命中时 `serviceLogPool` 记一条 info 便于溯源；只有声明为 `volatile: true` 的设置项在 GUI 可写；放开 min/max/step 白名单；新增 `--dump-settings-schema` 出组合后的 JSON Schema（离线诊断用，不进运行时路径）。

**验收判据**：改端口后重启服务，`statusByCarrier()` 给出的是覆盖后的端口且能说出来源层级；`verify:next` 全绿。

---

## 8. 批次56 工单：工具输出契约（最重，成本需你认）

**背景**：dsh 的工具是**强制声明输出 schema**（`output {schema, render, presentationMeta?}`），返回体是判别式 `Success{isError:false, value, content[], meta?, concludesTurn?}`／`Failure{isError:true, error}`，错误统一码表（`UNKNOWN_TOOL`／`TOOL_TIMEOUT`／`OUTPUT_*`），取消是协作式 `AbortSignal`；流式只在模型层，工具结果不流式。我们的存量认领工具（批次40 记录 42 个，批次45–49 之后只多不少，派单前以 `surfaceInfo().carrierToolNames` 重数）全靠约定返回 `{ok, ...}`，无取消（批次41 自陈"无流式"）。

**任务拆分（必须分批，不许一次打回全部存量工具）**：① 合同定义（`validateTools`（[carrierManifest.mjs:863](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L863)）扩 `output` 字段，进 @4 或 @4.1 由你定）；② **新工具强制、老工具只记账**（存量数以 `surfaceInfo().carrierToolNames` 现值为准——批次40 记录是 42 个认领工具，批次45–49 之后只多不少，**派单前重数再写成本**；本批只出"缺 output 声明"的条数账，迁移排后续批）；③ 取消：执行链加 `AbortSignal`，`serializeToolOutput`（[toolLoop.mjs:40](file:///D:/Pinax-main/Pinax-main/next/runtime/toolLoop.mjs#L40)）识别取消态；④ 错误码表进 `kernel/errors.mjs` 家族。

**为什么排最后**：它打回面最广、收益却主要在 Agent 侧正确性（作者体感最弱）。**要不要做、做到哪一档，请点名**——不点就停在①合同定义，不动存量。

---

## 9. 批次57 工单：能力全表自动生成

把 `host-descriptor.json` 从手写变成**由注册表导出**（现在 9 视图／5 形态／3 槽是手填的；`doctor.mjs:51` 只核这些字段**存不存在**、`:73/:75` 核合同下限，**没人核"descriptor 与真实注册表是否一致"**——加了宿主视图却忘改 descriptor，现在抓不到），再加两个生成物：每载体结构化 README（照 dsh 每包 README 的 Summary／Public API／Config／Events／**Known Limitations** 六段式）、开发者指南里的字段速查表。收益：文档漂移这个老毛病从"记得改"变成"不改就对不上门禁"。规模中，风险低，**必须排在 53 之后**（词表稳定才有生成源）。

---

## 10. 明确不做（防止后面反复）

| 项 | 不做的理由 |
| --- | --- |
| 嵌 `@deepseek-ai/cordis`／上游 `cordis` 包 | 评估已否：换底座不是加功能；运行时 pnpm 装包顶穿"不新增 npm 依赖"与离线前提；官方拒绝非 dsh 入口；预览期 40/40 全是 alpha/rc；win32 无原生预编译 |
| 服务名 DI 容器（`ctx.<name>`）替代 `useBoardData` | 我们有 2376 行单一数据源＋"目录唯一主人"归属；换成容器＝同一份数据多主人，批次39 的事件刷新与批次43 的自动保存基线会重做 |
| "缺依赖静默停 PENDING" | 与 v3 定的"声明了不生效就拒装"（`V3_ONLY_FIELDS`）直接相反；我们要的是响亮失败 |
| 四级配置层叠（bundle→profile→home→`--patch`） | 我们没有 profile 概念，两级（默认→工程覆盖）够用，层叠越深 doctor 越说不清一个端口是谁定的 |
| `SlotKind` 的 `chain` 态 | 当前无消费者；**登记为未采用**，将来有需求再随协议版本引入，避免死字段 |
| 插件签名／能力授权声明 | Cordis 自己都没有（评估已确认"查无此机制"），不是成熟度差距，抄不了 |
| React 组件注入（`dsh.client.inject` 往宿主包名塞组件）、换肤/壁纸/IM 接入轨 | 我们渲染层是 Vue，且垂直写作工具不需要换皮生态 |

---

## 11. 待你裁定（就四条，其余按默认走）

1. **批次52–54 是否立项 @4**（动协议面；默认按 v3 口径"先收口后迁移"，52/53 连批、中间不夹功能）。
2. **批次50 的收尾强度**：外部 MCP 工具"必须声明 annotations"是只记账（默认），还是升级为拒装级。
3. **批次56 做到哪档**：只做①合同定义（默认），还是连存量工具的迁移一起排进来。
4. **批次55 的取舍**：分页读只服务阅读态（默认），还是要顺带裁 PM 块编辑器那个协议级岔口（那会牵动 md 单真源 R1）。

并行纪律：本文件与评估文档都是**我这一路写的唯一文件**，未碰 `next/carriers/**`、`next/runtime/**`；批次49 刚由并行会话收口，派单前请再扫一次 `docs/STATUS.md` 的「当前安排」表。所有改动未提交（本工作副本非 git 仓库），是否入库等你发话。

---

## 12. 取证与复现（我自己核过的那批数字）

```bash
cd /d/Pinax-main/Pinax-main
# 基线（批次49 收口后）
sed -n '28p' docs/STATUS.md | grep -oE "(验收|内核|界面|eslint|打包)[^，。]{0,26}"
ls -1 next/carriers/*/manifest.mjs | wc -l        # 12
ls -1 next/tests/*.test.mjs | wc -l               # 69
ls -1 next/tests/*.spec.mjs | wc -l               # 13
# 批次50 的靶子（写族启发式只有一处引用）
grep -rn "EXTERNAL_WRITE_HINT" next/runtime/*.mjs
sed -n '46,54p' next/runtime/kernelWriteGuard.mjs
sed -n '18,56p' next/runtime/writePolicy.mjs
# 批次51 的靶子（registry 现有卸载面）
grep -n "createRegistry\|disposePlugin\|onUninstalled" next/kernel/pluginRegistry.mjs
# 批次52 的靶子（清单校验器全景，函数名与行号）
grep -n "^function validate\|^export function validate" next/kernel/carrierManifest.mjs
# 合同闸现状（批次52 的靶子：已有下限、缺上界与 minor 粒度）
grep -rn "minKernel" next/kernel/carrierManifest.mjs next/doctor.mjs next/carriers/*/manifest.mjs
sed -n '391,396p' next/kernel/carrierManifest.mjs   # compatibleKernel：split('.')[0] 只比 major
```
