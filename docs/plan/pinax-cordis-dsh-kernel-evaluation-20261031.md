# Cordis／dsh 内核对照评估（纯调研，零代码改动）

日期：2026-10-31 · 调研执行：四条线并行（本仓进度对齐／Cordis 内核机制／dsh 插件协议面／接入可行性与风险）
作者原问（三问）：① Cordis 内核是否与我们的思路高度契合 ② 对方的协议与接口规划能否给我们大量参考 ③ 是否值得直接接入 Cordis 内核

---

## 0. 结论先行

| 子命题 | 判定 | 一句话理由 |
| --- | --- | --- |
| ①「Cordis 内核与我们的思路高度契合」 | **不成立（表层契合，内核相反）** | 词汇与形式化程度像；但它的插件能力**全在代码里**，清单只管"装哪个、传什么参数"，没有"认领工程目录／面板形态／写并发保护"这套声明面——而那三条恰好是我们载体层的骨架。安全模型还反向：它零沙箱、插件进程内直接 `import`。 |
| ②「对方的协议与接口规划能提供大量参考」 | **成立（本次最值钱的一块）** | 它的 UI 插槽注册表、按 glob 认领资源并接管内置视图、按扩展名注册文档渲染器、`engines` 版本协商、工具输入＋**强制输出 schema**、五种事件分发模式（含可否决的环绕拦截）——六项直接命中我们文档里明写的欠账。 |
| ③「是否值得直接接入 Cordis 内核」 | **不值得，现在不接** | 接它换不到我们最想要的三样（并发写保护／目录归属／单一数据源），代价却包含：插件分发＝运行时 pnpm（顶穿"不新增 npm 依赖"与离线本地文件夹前提）、官方明确拒绝非 `dsh` 入口、`engines.node>=24.9.0` 与本地 Node 线不一致、官方自陈预览期"必有无兼容变更"且不收外部 PR。**这是换底座，不是加功能。** |

**建议路线**：**甲＋乙**——协议层照它的成熟度对齐（清单 v4 扩三块词表），机制层自研不引包；只把 `ctx.effect` 的"注册即返回 disposer"纪律借给我们已有的 dispose 链做命名与语义收紧。详见 §5。

---

## 1. 对象澄清：Cordis 不是 DeepSeek 的内核，是被 vendor 的上游框架

这条决定了"接不接"的实质，先单独摆出来。

- dsh = `github.com/deepseek-ai/deepseek-harness`，MIT，DeepSeek 2026-08 开源的 agent harness，"一切皆插件"。
- Cordis = 它以 **vendor 方式引入的上游 [cordiverse/cordis](https://github.com/cordiverse/cordis)**，改 scope 重发布为 `@deepseek-ai/cordis`（[vendor/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/vendor/README.md) 逐条登记上游 commit 与 V2…V26 差异）。包内 LICENSE 署名仍是 **© 2021-present Shigma**，DeepSeek 那份是 © 2026 —— 移植其代码要**同时保留两份版权**，仓库另有 `THIRD_PARTY_NOTICES.md`。
- 上游本体在 npm 直接可得：`cordis@4.0.0-rc.12`（维护人 shigma，repo `cordiverse/cordis`，MIT，deps `cosmokit`＋`@standard-schema/spec`，`type: module`）——即腾讯云那篇《从开源 QQ 机器人内核到 DeepSeek Harness 平台底座》说的同一血统。**要依赖就走 `cordis`，不必绑 DeepSeek 的 scope。**
- DeepSeek 那份实测同样极轻：`@deepseek-ai/cordis@4.0.5`，MIT，tarball 55 KB／解包 314 KB／32 文件／含 `.d.ts`，**runtime 依赖只有 2 个**（`@deepseek-ai/cosmokit~1.8.6`、`@standard-schema/spec^1.1.0`），`sideEffects:false`，**无 engines、无 install 脚本、无原生模块**；`lib/index.js` 1829 行纯函数式，import 里**零 Node builtin** → 技术上能跑在 Electron 主进程甚至浏览器里。
- 理论出处：arXiv **2608.25512**《A Programming Paradigm for Spatiotemporal Composability》，arXiv 页显示 **92 页**（"88 页"的说法不准）。temporal＝副作用可随组件移除回卷；spatial＝依赖在作用域内管理、上下文变化驱动组件激活／休眠。
- 术语归属（合规相关）：**"DeepSeek Harness" 是 DeepSeek 注册商标**（`BRAND_GUIDELINES.md`），禁用于我们的项目命名，只可作事实性描述；**"Cordis" 这个名字归上游 shigma/cordiverse，不归 DeepSeek**。→ 即便只移植设计，也不能自称 "Cordis 内核" 或 "DSH 兼容"。

---

## 2. 我方现状基线（本仓证据，全部亲自核过）

进度对齐：`docs/STATUS.md` 顶部到**批次 46B（10-31）**；批次 47 是纯文档批；批次 48（《漫画》接 ComfyUI 桥）代码已落盘未收口（`next/carriers/comic/comfy-mcp-bridge.mjs` 15:49、`preview-server.mjs` 15:52）；批次 49 工单里的 `next/runtime/serviceLogPool.mjs` **本会话开始时查无、现在已存在（10-31 17:12）**——并行会话正在推进，本文档零改动、不与它抢文件。协议仍 `pinax-carrier@3`，全仓**查无 @4**。

| 我们的东西 | 落点 | 现状 |
| --- | --- | --- |
| 载体清单 schema＋校验 | [next/kernel/carrierManifest.mjs:26-30](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L26)（@1/@2/@3 白名单）、[:37](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L37)（`V3_ONLY_FIELDS = entry/services/mcp/agentMd`，老版本写了**拒装**）、[:121](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L121) | 1017 行 |
| 内容面词表 | [:40-58](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L40) | `PANE_KIND_WORDS` 14 值（含批次44 的 `entries-workspace`／`entries-categories`／`external-app`，与 `custom-panel`） |
| 打开位置／形态 | [:113-119](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L113) `OPEN_SLOTS = left-dock/center/overlay`＋`RESERVED_SLOTS`；[:91](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L91) 五态 forms；[:97](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L97) `CARRIER_VIEW_TYPES` **只有 `pinax.view.custom` 一个口** | 槽位粗、富视图未开 |
| 宿主八视图＋custom | [next/host-descriptor.json](file:///D:/Pinax-main/Pinax-main/next/host-descriptor.json) `views` 9 项、`forms` 5、`slots` 3、`uiLayers` 3、`supportsPopout:false` | descriptor 内容**手填**；`kernelContract:"1"` 有下限消费（清单 `minKernel` 比对，见 §4 第 4 条），缺上界与 minor 粒度 |
| 插件注册与卸载 | [next/kernel/pluginRegistry.mjs](file:///D:/Pinax-main/Pinax-main/next/kernel/pluginRegistry.mjs) `install`／`uninstall`／`disposePlugin`／`onUninstalled`／`activate` | 332 行，**手工配对**，无"注册即返回 disposer"的强约束 |
| 写语义（我们的立身之本） | [next/fs/fileService.mjs:14](file:///D:/Pinax-main/Pinax-main/next/fs/fileService.mjs#L14)、[:116-119](file:///D:/Pinax-main/Pinax-main/next/fs/fileService.mjs#L116) | `expectedRevision` 必填，不符即 `STALE_REVISION`，**不覆盖不合并**；三道闸＝归属＋scope＋并发 |
| 写族闸 | [next/runtime/kernelWriteGuard.mjs](file:///D:/Pinax-main/Pinax-main/next/runtime/kernelWriteGuard.mjs) | 269 行；外部 MCP 靠工具名后缀**启发式**判写族 |
| 外壳单一数据源 | [next/shell/useBoardData.mjs](file:///D:/Pinax-main/Pinax-main/next/shell/useBoardData.mjs) | 2376 行；`useBoardData(bridge)` 独占数据面，无 DI 容器 |
| 事件总线 | [next/runtime/eventBus.mjs](file:///D:/Pinax-main/Pinax-main/next/runtime/eventBus.mjs) | 134 行、进程内、五类**通知型**事件、**无拦截点**；清单侧只认 `project.changed`（carrierManifest.mjs:88） |
| 服务监督（子进程） | [next/runtime/serviceSupervisor.mjs:77](file:///D:/Pinax-main/Pinax-main/next/runtime/serviceSupervisor.mjs#L77) `createServiceSupervisor`、:143 `spawnService`、:343 `restart`、:375 `defaultProbeHealth` | 端口／健康探针／退避重启／环形日志齐；**载体代码本身是进程内**（host-descriptor `trustMode:"same-process"`） |
| 外部 MCP | [next/runtime/mcpClient.mjs](file:///D:/Pinax-main/Pinax-main/next/runtime/mcpClient.mjs) | 官方 SDK，stdio＋sse，prefix 命名空间，断线重连 |
| 面板沙箱 | [next/shell/pluginProtocol.mjs](file:///D:/Pinax-main/Pinax-main/next/shell/pluginProtocol.mjs)（`pinax-plugin://`）＋`pluginFileServer.mjs`＋[pluginBridge.mjs](file:///D:/Pinax-main/Pinax-main/next/shell/pluginBridge.mjs)（只读）＋[PluginPanelHost.vue](file:///D:/Pinax-main/Pinax-main/next/shell/PluginPanelHost.vue) | iframe 沙箱，**比 Cordis 严** |
| 形态三分类（批次44） | [next/shell/formTaxonomy.mjs](file:///D:/Pinax-main/Pinax-main/next/shell/formTaxonomy.mjs) | 82 行，document／board／app 三档 |

已文档化的欠账（`docs/plan/pinax-plugin-author-guide-20261031.md` §6，作者指南原文）：编辑器仍是 textarea；面板桥只读＋自有板，跨板工具授权 `permissions.tools:<ns>` 属 v3.1 **未落**；外部 MCP 写族靠后缀启发式；数字设置的 min/max/step 渲染就绪但校验白名单未放开；`settings.json` 外部改不热感知；外部插件目录发现未做。

---

## 3. 内核机制对照（问题①的判据）

Cordis 侧接口形态取自 master 源码（`vendor/cordis/src/*`），我方取自上表。

| 维度 | Cordis／dsh | Pinax 载体层 | 契合判定 |
| --- | --- | --- | --- |
| 能力声明在哪 | **代码里**：`export const inject`、`apply(ctx)`、`ctx.provide()`；清单 patch 行只有 `{id,name,config,group,disabled,inject}` | **清单里**：panes/kind/view/services/mcp/agentMd 全显式声明，老版本写了新字段**拒装** | **不契合**（哲学相反：他们"声明=装载与参数"，我们"声明=能力与归属"） |
| 副作用回卷 | `ctx.effect(execute, label?) → Disposable`，execute 立即跑并返回 teardown 闭包（生成器可逐 yield 多段注册）；回滚按注册**逆序**启动，多个 async disposer **并发**跑；disposer 抛错只 `ctx.logger.error` 吞掉继续拆；向已 dispose fiber 注册抛 `INACTIVE_EFFECT`；无事务回滚 | `disposePlugin`＋`onUninstalled` 手工配对，无类型强制 | **契合（值得抄语义）** |
| 依赖注入 | 服务名为 key，`ctx.inject(deps, cb)`／`ctx.<name>` 代理读／`ctx.get(name)` 可选；**反应式**：依赖消失→依赖方自动卸载，恢复→自动重跑；同名服务重复 provide **直接 throw**（天然单例）；`ctx.isolate(name,label)` 分域多实例；`ctx.intercept(name,config)` 注入拦截配置；**无 semver** | `useBoardData(bridge)` 单一真源＋"目录唯一主人"归属；无容器 | **不契合**（无对应物；强接会把数据源从一变成多） |
| 生命周期 | `PENDING→LOADING→ACTIVE→UNLOADING→DISPOSED`＋旁支 `FAILED`；**缺依赖静默停 PENDING（不报错）**；热替换原生（HMR＝先全量回卷再加载），`fiber.restart()/update()`，`inertia`／`committed` 承载在途转换 | `pluginRegistry.activate`＋事件刷新映射（批次39）；无热替换 | **半契合**（状态机该学；"静默 PENDING"这条**我们的规矩相反**——协议 v3 是"声明了不生效就拒装"） |
| 依赖图 | 无插件↔插件直连，全经服务名间接成图；加载序无关 | `capabilityGraph` 的 `requires` 闭包（如体验板要 `script.scenes`）显式声明 | **不契合**（我们的显式闭包更适合垂直工具的可诊断性） |
| 事件／钩子 | 类型化 `Events`＋五种分发：`emit`／`waterfall`（带 `next` 的环绕，不调 next 即否决；`prepend:true` 抢前置）／`parallel`／`serial`／`bail`；工具面有 `tools/pre-execute / execute / post-execute / result` 拦截点 | 134 行进程内通知总线，无否决、无环绕 | **不契合现状，但这是我们最该补的一环** |
| 隔离与安全 | 插件**纯进程内 `import`**，Cordis 层**零沙箱、零 capability 声明**；风险全压在 harness 层 `packages/sandbox`＋`native/system`（Landlock，仅 darwin/linux 预编译，**无 win32**）；`SAFETY.zh.md` 自陈"未审计，插件不可信即等同宿主权限" | `pinax-plugin://` 自定义协议＋iframe 沙箱＋只读工具桥＋写族三道闸＋保留槽 `right/top-menu` | **反向契合**：这一项**我们比它严**，不能拿它当"更成熟"的证据 |

→ 问题① 落判：**词汇层契合（都在做"插件生命周期形式化"）；协议层相反；数据与写语义层无对应物；安全层我们更严。综合不成立"高度契合"。**

---

## 4. 协议与接口面：可参考清单（问题②的主体）

对方文档化程度先说一句：无单一 protocol 规范文件，合同分散但**自动生成度极高**——`docs/capability-seams.md`（约 108 个 `ctx.*` seam 全表，静态 grep 计数含夹具）、`docs/subsystems/*.md`（55+ 篇）、`docs/tool-catalog.md`(107 KB)、`docs/config-catalog.md`(241 KB)、`docs/persistence-catalog.md`＋`persistence-schema.json`、`docs/module-graph.md`、`docs/event-producer-consumer.md`、`docs/cordis-api/*`、`docs/glossary.md`、每包结构化 README（Summary／Service／Public API／Config／Events／Model Experience／**Known Limitations**）、`.agents/notes/**` 决策记录（Problem／Decision／Alternatives／Consequences）。

按"命中我们哪条欠账 → 值不值得改"排序：

1. **类型化插槽注册表 `ctx.slots`**：`SlotKind = single｜list｜keyed｜chain`、`SlotScope = root｜session-maybe｜session`，`SlotMap` 靠 TS 声明合并扩键，全仓约 115 个槽键（`sidebar.*`／`conversation.*`／`settings.*`／`workspace.*`…）；**"声明子槽＝渲染授权"**；跨包贡献走 `ctx.slots.inject(key, cb)`。规范在 `docs/subsystems/slots.md`。
   → 命中我们 `OPEN_SLOTS` 只有三个粗槽、`CARRIER_VIEW_TYPES` 只开一个口（carrierManifest.mjs:97，作者指南 §6 明写"第三方富视图只登记类型名"）。**四态槽 kind 恰好是我们 `<paneId>#<n>` 多实例语义的现成词表。**
2. **按 glob 认领资源并接管内置视图**：`ctx.sidebarRightTabs.register({ id, kind, patterns, priority, canOpen, title, guide })`，`patterns` 是对 `dsh-resource://` 地址的 glob（`*.md`、`dsh-resource://file/**`），`builtin｜extension｜fallback` 三档可**接管内置视图**。
   → 这是"载体认领目录＋面板＋视图类型"三合一的成熟版本，也带了我们没有的两件东西：**多载体争同一资源的 `priority`** 与 **`canOpen` 谓词**。我们现在靠"目录唯一主人"硬规定，争用情形（世界书条目 vs 素材记录 vs 设定）会撞。
3. **按扩展名注册文档渲染器**：`ctx.documentPreviews.register({ id, extensions, priority, loading: 'text-pages'｜'bytes-complete', wrap? })`——把"分页读 vs 全字节读"写进契约。
   → 直接对上"编辑器仍是 textarea／md 原生渲染"那条欠账；`loading` 枚举是我们做长正文（《大梦》现稿 1 MB 级）迟早要的。
4. **版本协商**：`engines.dsh`（SemVer，`includePrerelease` 求值），缺失回落 `@deepseek-ai/dsh*` peer 范围，不满足需显式 `version-exemptions`／`allow-version`／`revoke-version`（`packages/boot/app-boot/src/plugin-compatibility.ts`）。
   → **订正（本文初稿判错，复核后改）**：我们并不是"没有协商"。已有的是**下限闸**——清单可写 `minKernel`，[next/kernel/carrierManifest.mjs:392](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L392) `compatibleKernel()` 比对、[:152](file:///D:/Pinax-main/Pinax-main/next/kernel/carrierManifest.mjs#L152) 不符即 `KERNEL_INCOMPATIBLE` 拒装，[next/doctor.mjs:75](file:///D:/Pinax-main/Pinax-main/next/doctor.mjs#L75) 再给 `needs-host-upgrade` 的修法建议。真正的差口是三条：**只比 major**（`compatibleKernel` 里 `split('.')[0]`，minor/patch 无粒度）、**没有上界**（为合同 1 写的插件无法声明"合同 2 会坏"，宿主升级时反向暴露）、**没有豁免通道**。→ 参考点是这三条，不是"从零加协商"。
5. **配置分层与热更新**：层序＝各 bundle 的 `cordis.patch.yml`（按 `profile.bundles` 序）→ profile 层 → `$DSH_HOME/cordis.patch.yml` → `--patch`；按 `id` 后写胜；设置命名空间＝profile 条目 id，schema 由宿主入口导出，**仅 `volatile()` 字段 GUI 可写**；`dsh --dump-config-schema` 吐组合后的 JSON Schema；`dsh.profile.patchReload: 'live'｜'startup'`。旧 `ctx.settings.register(ns, schema, {base, applies})` 三层（默认→base→用户）带 **`revision` 乐观锁与 `SETTINGS_CONFLICT`**。
   → 参考第 4、5 条的"每工程覆盖插件默认值"（我们改 ComfyUI 端口现在只能动插件文件）与 min/max 白名单。**但注意硬冲突**：他们的语义是"层叠后写胜"，我们 v3 的语义是"不认就拒装、不许静默丢弃"——这是优先级模型相反，属参考不属照搬。（顺手一条印证：他们 `packages/settings` 也有 `revision` 乐观锁，说明"拒绝覆盖"在插件框架里并非异物，只是 Cordis 内核层不管写盘。）
6. **工具调用协议**：输入是裸 JSON Schema（自研 ValueSchema DSL 编译到强制子集，非 zod）；**输出 schema 强制声明**（`output{schema, render, presentationMeta?}`）；返回体是判别式 `ToolExecutionSuccess{isError:false, value, content:ContentBlock[], meta?, additionalContexts?, concludesTurn?}`／`Failure{isError:true, error:{message, info?}}`；错误统一 `HarnessError.code`（`UNKNOWN_TOOL`／`TOOL_TIMEOUT`／`OUTPUT_*`）；取消为协作式 `AbortSignal`（`ABORTED_BEFORE_DISPATCH`／`ABORTED`）；**流式只在模型层**（`ctx.llm.stream() → AsyncIterable<StreamChunk>`，块为 `block-start｜text-delta｜reasoning-delta｜tool-call-delta｜block-end`），工具结果不流式。
   → 我们 42 个认领工具靠约定 `{ok,…}` 返回，无取消、无输出契约（批次41 边界自陈"无流式"）。这条影响 Agent 面正确性最大。
7. **能力全表自动生成**：`capability-seams.md`＋每包结构化 README（含 Known Limitations）＋决策记录格式。
   → 我们 `host-descriptor.json` 已是同位雏形，值得升级成"从注册表自动导出"的全表，而不是手写清单——`next/doctor.mjs:51` 已经在核 descriptor 字段齐不齐，方向一致。
8. **五种事件分发模式**（尤 `waterfall` 可否决／`prepend`）＋ `tools/pre-execute｜post-execute` 拦截点。
   → 我们 eventBus 无否决权。若把写族闸（kernelWriteGuard）挪到拦截点上，外部 MCP 写工具就不必再靠**后缀启发式**（作者指南 §6 明记这条是无奈之举）。
9. **MCP 接入形态**：无清单字段，`@deepseek-ai/dsh-mcp-client` 一行一个 server，`transport: stdio｜streamable-http`，工具上 `ctx.tools` 命名 `mcp__<server>__<tool>`，HMR 热换。
   → 我们**已对齐**（mcpClient 已做 stdio＋sse、prefix 命名空间、断线重连）。只剩两点可参考：`streamable-http` 传输、连接热替换。

**明确不必参考的**：他们的 `dsh.client.inject`（往 6 个宿主包名注入 React 组件）与皮肤／壁纸／IM 接入轨——我们渲染层是 Vue，且垂直写作工具不需要换皮生态。

---

## 5. 是否直接接入 Cordis（问题③的判据与路线）

### 5.1 不接的五条判据

1. **换不到我们最想要的**：并发写保护、目录归属、单一数据源、面板形态词表——Cordis 一个都不给（它是通用插件插座）。而这些正是我们 1017＋332＋269＋2376 行已经写着的东西。接它＝把这层重写一遍再在上面盖我们的垂直语义。
2. **顶穿硬口径**：插件安装是运行时 `dsh plugin … <pnpm args>`（直接破"不新增 npm 依赖"＋离线／本地文件夹前提）。
3. **官方反对非 dsh 入口**：`docs/architecture.zh.md` 明写"进程内直接挂载插件……不属于 Harness 应用启动器"，`verify-application-entrypoints` 会"拒绝任何绕过 `dsh` 的 Node 应用路径"，`dsh` CLI 硬拒 `desktop` profile（"managed exclusively by the Electron application"），官方给的嵌入口子只有 `@deepseek-ai/dsh/profile-boot`（供他们自己的 Desktop Host）。**"只嵌内核"技术上成立，官方口径上不欢迎。**
4. **成熟度与协作政策**：README 自陈"开发者预览、快速迭代、未来将出现破坏兼容性的变更"；SAFETY 自陈"实验性、未接受安全审计、不得视为可用于生产"；CONTRIBUTING 自陈"目前无法接受外部 PR"（API `has_issues:false`）。节奏实测：`@deepseek-ai/dsh` 80 天 40 版、**40/40 全是 alpha/rc**；**API 稳定性承诺与弃用策略文档查无**。
5. **环境错配**：monorepo 根 `engines.node: ">=24.9.0"`（我们本地 dev 线是 `>=22.13 <23`）；原生包 optionalDependencies **只发 darwin/linux，无 win32 预编译**（Landlock 是 Linux 专有），Windows 走 `dsh-sandbox-windows-acl`／`koffi` 另一条路。我们这台就是 win32。

**替换量实测口径**：`carrierManifest.mjs`(1017)＋`pluginRegistry.mjs`(332)＋`capabilityGraph`(137)＋`scopeGrant`(93)＋`projectSkeleton`(104)＋`viewRegistry.mjs`(200)＋`eventBus.mjs`(134)＋`kernelWriteGuard.mjs`(269)＋`fileService` 的 revision 闸＋12 份载体清单 ≈ **内核层 1700 行起**，再加校验与门禁重写。

**生态价值错配**：npm `keywords:dsh-plugin` 实测 **11,403** 个包（`cordis-plugin` 2,428），社区目录自称 7,924 条；分布几乎全围绕它的 chat／agent UI 注入点（记忆、换肤壁纸桌宠、QQ／微信／Telegram 接入、费用统计、图像生成、agent-teams、checkpoint）。适合本地文档型工作区的只有 `dsh-univer-office`、`dsh-archive-manager`、`dsh-mnemon` 这一类，**对我们 12 载体／看板形态的复用价值很低**——这是"生态锁定收益"侧的关键否定证据。

### 5.2 三条路线

- **甲（推荐）协议层对齐、机制层自研**：把 §4 的 1／2／3／4／6／8 六项落成**载体清单 v4** 的字段与词表扩展（槽位四态化＋资源 glob 认领与 `priority/canOpen`＋渲染器注册与 `loading` 契约＋`engines.host` 协商闸＋工具输出 schema 与取消语义＋waterfall 式拦截点）。一行外部代码不引，零新增依赖口径不破。
- **乙（同时做）只借语义不借包**：把 `ctx.effect` 的"注册即返回 disposer、逆序回卷"借成我们 `pluginRegistry.disposePlugin`／`onUninstalled` 的接口纪律与文档口径（现在靠手工配对，没有类型强制）。**命名与商标注意**：对外文档不要写"我们的内核是 Cordis"，`Cordis` 名归上游、`DeepSeek Harness` 是注册商标。
- **丙（记录但否掉）最小可行真接**：只装 `@deepseek-ai/cordis` 单包（314 KB、2 deps、纯 ESM、零 Node builtin）在 Electron 主进程起一个 `Context`，专门替换"服务监督＋依赖激活"这一小块。技术可行、体积便宜，但换来的外部绑定（预览期破坏性变更＋无反嵌入口＋win32 原生缺失）与它能替掉的那 100 多行 supervision 逻辑不成比例。**除非作者明确要"插件热替换"这个能力，否则不成立。**

---

## 6. 待作者裁定

1. **路线**：甲／乙／丙（我推荐**甲＋乙**，丙否掉）。
2. **要不要立项"载体清单 @4"**：若走甲，`slots` 四态、`previews` 认领、`engines.host` 三项都动协议面。作者既往口径是"协议先收口、细节后微调"（v3 那轮四问），这次同样是"先定协议再改 12 载体"，需要点名。
3. **`kernelContract:"1"` 要不要真做成协商闸**（现在只是标签）。
4. **工具输出 schema 强制声明**会打回全部 42 个认领工具的返回体——要不要一次做齐，还是只对新载体生效并登记旧的不一致。
5. **拦截点接进写族**：`tools/pre-execute` 式否决权一旦落地，外部 MCP 写工具就不再依赖后缀启发式（作者指南 §6 那条无奈）。这会改变 `kernelWriteGuard` 的执行位置，需确认。
6. **批次归属**：本仓被并行会话推到 48／49，这份评估要不要挂成批次 50（纯调研批）并进 `docs/STATUS.md`。

---

## 7. 已知瑕疵与「查无」（如实）

- **arXiv 2608.25512 正文未逐页读**（只取摘要页），"coeffect" 的形式化定义细节未核实。
- **GitHub API 限流**（0/60）→ releases／tags／commit 节奏未取到，破坏性变更频率改用 **npm 发布时间戳**替代取证。
- `raw.githubusercontent.com` 本机**不可达**（HTTP 000），`github.com` HTML 超时，`codeload` 仅 ~48 KB/s（整包下载不可行），jsDelivr 不可达；文档实际经 **ghproxy.net 镜像 raw** 取回，`registry.npmjs.org` 与 `registry.npmmirror.com` 均可达。`deepseek.com/harness` 返回 429 → 官方市场确切总数**未取证**。
- **`dsh.bundle` 无 JSON Schema**，只有 TS 类型（`packages/util/package-manifest/src/types.ts`）＋各读取方手写校验；`manifestVersion?: 1` 字段存在于 master 类型但**未查到消费它的兼容分支代码**。
- **npm latest 与 master 不一致**：`@deepseek-ai/dsh` npm `latest` 停在 `0.0.1-rc.x`，master 已 `0.2.2-alpha.2`；`dsh.bundle.patch` 在 master 已从 `string` 扩成 `string｜string[]` 并新增 `platforms`／`listedByDefault`。本文所有字段以 **master 源码**为准。
- 108 seam／115 槽键为静态 grep，**含测试夹具**（`test.*`、`dynamic.*`），精确数不可考。
- **Cordis 的"能力声明／插件签名"机制确认不存在**（cordis-api 全套文档无此主题），不是没查到。
- RFC #8317（插件市场与 profile 设计）状态 open、**官方 0 回复**，未采纳；官方市场结论原话："No official market exists, and one may be added later"。
- Electron 42.9.3 内置 Node 主版本**未实测**（按约束未起 Electron）→ `>=24.9.0` 到底卡不卡我们，需作者另行确认。
- `@deepseek-ai/dsh-tool-executor-native` 元数据查无（可能未发布／仅 workspace 内部包）。
- 许可多样性**只抽样 3 个社区包**（均 MIT），未穷举。
- 本调研**未改仓库任何文件**，所有下载落在 `%TEMP%\dsh-probe`；调研期间并行会话仍在推进批次 48／49（`serviceLogPool.mjs` 于 17:12 落盘），我方现状一节若隔几天再读需重新核对。

---

## 8. 复现方式（命令级）

```bash
# 1) 两个包的区分（本文档最关键的一条事实，亲自复核过）
npm view cordis@latest repository.url homepage license maintainers version
npm view @deepseek-ai/cordis@latest repository.url license version dependencies
npm view @deepseek-ai/dsh@latest version dependencies engines 2>&1 | head -40

# 2) 内核体积与运行时假设
npm pack @deepseek-ai/cordis        # tarball 55 KB / 解包 314 KB / 32 文件
# 取包后：grep -E "require\('node:|child_process|worker_threads|process\.send|readline" lib/index.js → 0 命中

# 3) 一手文档（本机 raw.githubusercontent 不可达，走 ghproxy 镜像）
curl -s https://ghproxy.net/https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/capability-seams.md
curl -s https://ghproxy.net/https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cordis-primer.zh.md
curl -s https://ghproxy.net/https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/README.zh.md      # 预览期口径
curl -s https://ghproxy.net/https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/SAFETY.zh.md      # 未审计口径
curl -s https://ghproxy.net/https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/CONTRIBUTING.zh.md # 不收外部 PR
gh api repos/deepseek-ai/deepseek-harness/git/trees/master?recursive=1   # 会限流，隔 45 分钟再试

# 4) 生态规模与分发模型（本文复核：dsh-plugin=11,403 / cordis-plugin=2,428，两天前是 11,391——还在长）
curl -s "https://registry.npmjs.org/-/v1/search?text=keywords:dsh-plugin&size=1"   # 读 JSON 里的 total
curl -s "https://registry.npmjs.org/-/v1/search?text=keywords:cordis-plugin&size=1"
npm view @deepseek-ai/cordis-plugin-loader version    # 1.0.6 MIT：patch 行的字段就在这里（EntryOptions）

# 5) 我方现状复核
wc -l next/kernel/carrierManifest.mjs next/kernel/pluginRegistry.mjs next/runtime/eventBus.mjs next/shell/useBoardData.mjs
cat next/host-descriptor.json
sed -n '26,120p' next/kernel/carrierManifest.mjs
grep -n "expectedRevision" next/fs/fileService.mjs | head
```
