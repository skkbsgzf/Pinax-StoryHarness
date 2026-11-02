# Pinax-Electron-Next 规范 v2（骨架，2026-11-02）

> **本档的地位**：与代码同代的合同文档。规范 v1（`pinax-electron-next-spec-20261027.md`）保留为历史，不再作为合同来源；两者冲突时**本档赢，本档与代码冲突时代码赢**——本档的唯一权威实现源是 `next/kernel/carrierManifest.mjs` 及其四个拆出的校验模块，逐条规则都注了 `file:line`，读不确定就往那里核。
> **立项依据**：`docs/plan/electron-obsidian-framework-plan-20261102.md` §6 桩4 的①②④＋§11 第 0 批。断层编号 F4（文档落后代码、注释落后代码）与 F9（一物多名）就是本档要解的两件事。
> **本批性质**：纯文档，零代码改动。装载合同一节（§5）是**桩2／批次65 的占位**，写清「今天是什么」与「届时合同长什么样」，不冒充已实现。
> **完成判据（桩4）**：新读者照本档 §2 写的清单能通过 `validateCarrierManifest`。已用真清单反证：`next/carriers/*/manifest.mjs` 十一份全部按本档字段写法通过校验（`next/testing/acceptance.mjs:361` 的 11/11 断言在守）。

---

## 0. 版本坐标（先说清「三条版本线」，别把它们当一个）

| 线 | 真源常量／文件 | 现值 | 说明 |
|---|---|---|---|
| 载体清单协议 | `carrierManifest.mjs:46-51` | 写侧 `pinax-carrier@4`；读侧兼容 @1/@2/@3 | 一份插件包合同的版本 |
| 内核（外壳）合同 | `carrierManifest.contract.mjs:15` `KERNEL_CONTRACT_VERSION` | `'1'` | 清单用 `minKernel`／`maxKernel` 对它做区间兼容判定（§2.1） |
| 项目档案 | `.pinax/project.json` → `pinax-project@N` | 《大梦》工作副本为 `@3`（批次42） | **载体协议版本与项目清单版本是两条线**（批次53 结论，工单曾把两者混为一谈被执行方纠正） |

另有两个「描述符」不属于清单协议，但常被混写：宿主能力自述 `next/host-descriptor.json`（`descriptorVersion:1`，`supportsPopout:false`）、工作区存档 `next/shell/workspace.mjs:30`（`WORKSPACE_VERSION = 3`，落 `.pinax/workspace.json`）。

**兼容纪律（一句话）**：@4 是唯一写侧；老清单仍可读，但**老清单里写了任何新代字段一律整份拒装**，不静默丢弃——「声明了却不生效」在本项目是拒装理由，不是警告。三张拒装名单：

| 名单 | 内容 | 出处 |
|---|---|---|
| `V3_ONLY_FIELDS` | `entry`／`services`／`mcp`／`agentMd` | `carrierManifest.mjs:59` |
| `V4_ONLY_FIELDS`（pane 级七字段） | `multiplicity`／`scope`／`keyField`／`claims`／`priority`／`canOpen`／`takes` | `:64-72` |
| `V4_ONLY_TOP_FIELDS`／`V4_ONLY_SERVICE_FIELDS`／`V4_ONLY_SETTING_FIELDS`／`V4_ONLY_TOOL_FIELDS` | `maxKernel`·`license`·`preview` ／ `adopt` ／ `volatile`·`min`·`max`·`step` ／ `output` | `:74-80` |

扫描器是 `firstV4Field()`（`:312-351`），报错文案固定为「这是 pinax-carrier@4 的字段，请把 spec 与 manifestVersion 一并升级到 4」。

---

## 1. 这份合同怎么被读（校验器入口与形状）

- 唯一入口 `validateCarrierManifest(input, { kinds })`（`carrierManifest.mjs:164`）。**纯函数、零 IO**，主进程、渲染层、门禁脚本共用同一份，不存在第二套口径。
- 返回 `{ok, value}` 或 `{ok:false, error:{code, message, details}}`（`next/kernel/errors.mjs`）。错误码是本合同的一部分：`INVALID_MANIFEST`／`INVALID_ENTRY`／`INVALID_SERVICE`／`INVALID_MCP`／`INVALID_INPUT`／`TOOL_CONFLICT`／`KERNEL_INCOMPATIBLE`／`UNKNOWN_CAPABILITY`／`UNKNOWN_SUBSCRIPTION`／`RESERVED_SLOT`／`RESERVED_VIEW_TYPE`／`SCOPE_OUTSIDE_OWNER`。**注意上表写的是符号名，落到 `error.code` 时一律带 `PINAX_` 前缀**（`errors.mjs:5-31` 的映射表，如 `INVALID_MANIFEST` → `PINAX_INVALID_MANIFEST`）——写断言别比对错字符串。
- `kinds` 只影响 `primary.projectKind` 的合法性来源：传入则用它，缺省用 `projectSkeleton.mjs` 的已登记类型表（`:515`）。
- 归一结果（`:273-305`）**同时保留新旧两个名字**（`capabilities`↔`provides`、`scopes`↔`permissions`），所以下游依赖闭包、目录唯一主人、载体设置页都不必为改名二次改动；`tools` 恒为字符串数组，输出合同另放 `toolOutputs` 键（只有真声明了 `output` 才出这个键，老清单的归一结果不多死键）。

---

## 2. `pinax-carrier@4` 全字段合同表

权威＝现实现。列含义：**校验规则**是拒装条件（写错＝整份拒装，无豁免）；**宿主消费点**是谁读它，`file:line`，「未消费」是如实登记不是笔误。

### 2.1 顶层字段

| 字段 | 类型 | 必填 | 校验规则 | 宿主消费点 |
|---|---|---|---|---|
| `spec` | string | 是 | ∈ `SUPPORTED_CARRIER_SPECS`（@1/@2/@3/@4） | `:168`；描述符 `host-descriptor.json:5` |
| `manifestVersion` | number | @2+ 必填 | 必须等于 spec 对应版本（@4→4）；@1 可省略、给了只能是 1 | `:171-177` |
| `id` | string | 是 | `^[a-z][a-z0-9.-]{0,79}$` | 注册表主键 `pluginRegistry.mjs:155`；竖条/启停/主载体全部按它 |
| `title` | string | 是 | trim 后 1–120 字非空 | 界面显示名（索引窗/竖条/设置目录） |
| `version` | string | 是 | `x.y.z`（`SEMVER_PATTERN` `:144`） | 记账与展示，不做区间判定 |
| `tier` | string | 是 | 恒等 `'carrier'`（运行时与文件服务不走这份合同） | `:210-212` |
| `minKernel` | string | 实质必填 | 与宿主合同按 **major.minor** 比（批次52 从 major 收紧）；低于内核即 `KERNEL_INCOMPATIBLE` | `compatibleKernel()` `:507-509` → `:204` |
| `maxKernel` | string | 否（@4 专有） | `^\d+(\.\d+){0,2}$`；不得小于 `minKernel`；缺省＝不设上界 | `validateMaxKernel` `contract.mjs:45-58` → `:202` |
| `primary` | object | 是 | 见 §2.2；缺失即拒（D1：主载体显式，框架不做默认） | `project/createProject.mjs`、`project/openProject.mjs` |
| `dataDirs` | object | 是（≥1 项） | 见 §2.3 | `permissions`/`scopes` 的 `file:` 归属闸（C3）；`projectSkeleton` 目录认领 |
| `panes` 或 `contributes.panes` | array | 是（≥1 块） | **只能有一个来源**，两处都写即拒（`:221-223`）；项见 §2.4 | 竖条/页签/宿主视图解析 `viewRegistry.mjs`；形态菜单 `paneForms.mjs` |
| `contributes.commands` | array | 否 | 见 §2.5 | **未消费**：取口 `registry.commands()`／`commandOwner()` 已具备（`pluginRegistry.mjs:268-281`），11 份真清单 0 声明、渲染层 0 消费 → 批次62 接面板 |
| `contributes.settings` | array | 否 | 见 §2.6 | 统一二级页目录 `SettingsModal.vue`；`.pinax/settings.json` 白名单 `settingsStore.mjs`；工程覆盖 `carrierOverridesStore.mjs` |
| `contributes.renderers` | array | 否 | 见 §2.7 | `viewRegistry.mjs`（视图类型解析）；`doctor` 核 |
| `provides`（=v1 `capabilities`） | string[] | 是（可空数组） | 每项 ∈ `CAPABILITY_IDS`（`capabilities.vocab.mjs:9-28`，16 个词）；与 `capabilities` 同写必须等集 | 依赖闭包 `capabilityGraph.mjs:5,49,64,80`（D3/D4） |
| `requires` | array | 否 | 见 §2.8 | 闭包缺口判定；缺口即拒并给 `fix` 文案（D4） |
| `tools` | (string \| object)[] | 是（可空数组） | 见 §2.9 | 聚合工具面 `runtime/mcpSurface.mjs`；写族闸 `kernelWriteGuard`；MCP 面计数 `acceptance.mjs:148,290` |
| `context` | object | 否 | 见 §2.10 | 上下文信封 `runtime/context.mjs`、各载体 `context.mjs` |
| `permissions`（=v1 `scopes`） | (object \| string)[] | 是 | 未声明即拒；见 §2.11 | 文件服务作用域闸 `fs/fileService.mjs`；跨载体越权报 `SCOPE_OUTSIDE_OWNER` |
| `subscriptions` | string[] | 否 | 只认 `'project.changed'`，其它 `UNKNOWN_SUBSCRIPTION` | 事件总线投递 `runtime/eventBus.mjs` → `createRuntimeSurface` 的 `subscribedCarriers`（批次37） |
| `entry` | object \| null | 否（@3+） | 见 §2.12 | 自带面板：`pinax-plugin://` 协议＋沙箱 iframe（批次42）；与 `pinax.view.custom` 的 pane 必须成对（`:242-250`） |
| `services` | array | 否（@3+） | 见 §2.13 | 服务监督器 `runtime/serviceSupervisor.mjs`；状态灯与公共池 `serviceLogPool`→竖条状态点＋「服务与通知」节 |
| `mcp` | array | 否（@3+） | 见 §2.14 | 外部 MCP 客户端 `runtime/mcpSurface.mjs`；prefix 是命名空间仲裁单位 |
| `agentMd` | string | 否（@3+） | 插件目录内相对 `.md`，≤200 字 | 运行时组上下文时并入（打包门禁 o 断言 11/11 进包） |
| `preview` | object | 否（@4 顶层） | 只认 `register`；见 §2.15 | `doctor.mjs:141-146` 透出注册表；渲染层 `CarrierPaneHost.vue:158` 读 **pane 级 passthrough**（非本字段，见 §2.4 末注）→ 批次65/66 收敛为一条路 |
| `license` | object \| null | 否（@4 顶层） | 见 §2.16 | 设置面展示（批次54 声明归一已通，鉴权/展示消费按批次推进） |

### 2.2 `primary`

`{ projectKind, defaultPane, contextProfile }`，校验在 `:511-530`。

- `projectKind`：∈ 已登记项目类型（`kinds` 覆写或 `isKnownKind`）。缺失**不回落**——D2 禁静默回落，打开报 `PRIMARY_CARRIER_MISSING`（`project/openProject.mjs:48`）。
- `defaultPane`：非空串，须是该载体自己的一块 pane id；决定打开项目落在哪一板。
- `contextProfile`：`^[a-z][a-z0-9._-]{0,63}$`，交给上下文档案表。**注意**：档案必须有只读任务，否则提问报 `PINAX_DEPENDENCY_UNMET`（批次18 踩过的坑，见 `docs/STATUS.md` 批次18 条）。

### 2.3 `dataDirs`

`{ 逻辑名: 物理目录 }`，校验在 `:532-549`。逻辑名 `^[a-z][a-zA-Z0-9]{0,31}$`；物理目录过 `validatePhysicalDir`（禁越出项目根、禁 `..`／绝对路径）；两个逻辑名不得指向同一物理目录。物理目录**中文真源**（R1 已裁）。C1 条款仍成立：内核只认逻辑名。

### 2.4 `panes[]`（@4 完整形状）

校验在 `:584-699` ＋ `paneSemantics.mjs` ＋ `claims.mjs`。

| 字段 | 必填 | 规则 | 消费点 |
|---|---|---|---|
| `id` | 是 | 非空串；同载体内不得重复 | 实例 id `<paneId>#<n>`（批次M2.5-C／61）；localStorage 键 `overlay.<paneId>` |
| `slot` | 是 | ∈ `OPEN_SLOTS = ['left-dock','center','overlay']`；命中 `RESERVED_SLOTS=['right','top-menu']` 报 `RESERVED_SLOT` | `shell/slots.mjs`＋`ActivityRail.vue`（left-dock）；`.col-center` 页底座（center）；`FloatingWidget.vue`（overlay） |
| `title` | 否 | 缺省取 id | 显示名 |
| `icon` | 否 | 非串则回落 `'plugin'` | `ActivityRail` 图标名（`orderActivityItems`） |
| `view` | @3+ 必填 | `^pinax\.view\.[a-z][a-z0-9.-]{0,63}$`；第三方只许 `pinax.view.custom` | `viewRegistry.mjs:21-35` 解析渲染器 |
| `kind` | @3+ 必填 | ∈ `PANE_KIND_WORDS`（§4.3 的 13 词） | 内容面选择（同上 `hostViewFactory`） |
| `app` | `kind='external-app'` 时必填 | `{ url }`：http/https、**只接本机回环**（127.0.0.1／localhost／::1）、≤300 字 | `ExternalAppHost.vue` 的 iframe（批次44）；CSP 只放开回环端口 |
| `forms` | 否 | 非空数组，值 ∈ `PANE_FORM_WORDS`（五词）；缺省＝宿主打开位置全开 | 右键形态菜单＝`sanitizePaneForms` ∩ `FORM_ACTIONS`（`paneForms.mjs:73-77`） |
| `width` | 仅 `slot='overlay'` | 整数 200–600，缺省 300；非 overlay 槽不认（静默丢弃会被读成「声明了不生效」，故只在 overlay 上校验） | `FloatingWidget.vue` |
| `multiplicity` | 否（@4） | `single\|list\|keyed`，缺省 `single`；`chain` **登记未采用**、写了即拒 | **真消费**（批次61）：`openTarget.mjs` 五档落点判定，`single`＝该 pane 永不出现第二页 |
| `scope` | 否（@4） | `project\|entry\|session`，缺省 `project` | 上下文绑定档（声明面，宿主按档取数） |
| `keyField` | `multiplicity='keyed'` 时必填 | `^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$`；非 keyed 写了即拒 | 页身份 `pageIdOf(paneId, resource, pages)` 的去重键；现值仅 `worldbook.entries` 的 `path` |
| `claims` | 否（@4） | glob 数组 ≤64 条、单条 ≤200 字；只许项目内相对路径：拒绝对／盘符／反斜杠／`.`／`..`／隐藏段／`.pinax`；`**` 必须独占一段 | `viewRegistry.mjs:336 resolveResourceClaim` → `useBoardData.mjs:2139`（批次53 裁决链已通） |
| `priority` | 否（@4） | 整数 0–100；**没有 claims 却声明即拒** | 同资源争用时高者先 |
| `canOpen` | 否（@4） | `{field, equals|in}` 二选一；标量只收串/数/布尔，`in` 1–32 项；**不许夹 JS**（JSON 清单塞函数＝RCE 口）；无 claims 即拒 | 认领资源的开板谓词 |
| `takes` | 否（@4） | `extension \| fallback`；`builtin` 是宿主保留档、写了即拒；无 claims 即拒 | 接管档裁决 |

> **合同外 passthrough 字段（如实登记，别当合同读）**：`board.layout`（`layoutTemplates.mjs:52` 读 pane 上的 `layout`/`template`，词表 `folder|web|gallery`）与 `pane.preview.loading`（`CarrierPaneHost.vue:158`）都不经 `validateCarrierManifest`，属宿主渲染层私有词汇，@4 schema 未收。批次65/66 要么把它们收进合同，要么把 passthrough 读路拆掉——现状是「清单能写、校验器不看、宿主偷读」，这条要留名。

### 2.5 `contributes.commands[]`

`:435-463`。`{ id, title, run }`，三字段之外即拒。`id` 匹配 `^[a-z][a-z0-9.-]{0,63}$`、载体内唯一；`title` 1–60 字；`run` 必须是函数（进程内载体）或 ≤120 字的非空实现名（外部按名查）。归一后提升到清单顶层（`:296`）。**当前消费端为零**，这就是 F2「插座埋好、电器为空」；批次62 的接法是 `ipcContract` 的 menu id 集从 `flattenMenuIds(MENU_TEMPLATE)` 扩成「∪ `registry.commands()`」，并加 `command:list` 通道。

### 2.6 `contributes.settings[]`

`:1057-1178`。允许键：`id / title / type / default / options` ＋ @4 的 `volatile / min / max / step`。

- `id` `^[a-z][a-z0-9._-]{0,63}$`，载体命名空间内唯一；`title` 1–40 字。
- `type` ∈ `['section','string','number','boolean','enum']`，缺省 `section`。v1 的 `{id,title}` 写法读成 `section`（只出目录项、不带控件）。
- `section` 不许带 `default`/`options`/`volatile`/`min`/`max`/`step`（带了＝声明了不生效，拒）。
- `enum` 必须给非空 `options`（串/数/布尔、去重），`default` 必须是其中一项，缺省取第一项。
- `string/number/boolean` 的 `default` 必须同型（缺省分别 `''`/`0`/`false`），数字还须有限。
- `min`/`max`/`step` **只对 number 生效**：`step>0`、`min≤max`、`default` 落在 `[min,max]` 且相对 `min`（无 min 时基点 0）对齐 `step`。
- `volatile:true` 才允许设置页可写；未标即只读展示（工程覆盖与清单默认仍可改值）——批次54 裁定。
- 分组由设置页固定归「载体」，多写 `group` 之类字段直接拒。

### 2.7 `contributes.renderers[]`

`:466-486`。项可以是字符串或 `{ type }`（其它键即拒）。类型必须匹配 `pinax.view.<name>` 家族，且**只能是 `pinax.view.custom`**，否则 `RESERVED_VIEW_TYPE`——宿主视图归宿主，载体不得顶替。

### 2.8 `requires[]`

`:970-989`。`{ capability, min?, fix }`。`capability` 必须在能力词表里；`fix` 必填非空（D3/D4 纪律：不许只丢一个错误码给作者）；`min` 缺省 1、须 ≥1 整数。

### 2.9 `tools[]`

`:998-1031`。两种写法：

- 字符串（老写法，照装）：`^[a-z][a-z0-9_.]{1,63}$`，同载体不重复，违规报 `TOOL_CONFLICT`。
- 对象（@4 写法，@3 及以下整份拒装）：`{ name, output? }`，多余键即拒。
- `output`（`toolOutputs.mjs`）：`{ schema, presentationMeta? }`。`schema` 必填、根必须 `type:'object'`（工具返回体恒为对象信封）、关键字只认 JSON Schema 2020-12 子集白名单（54 个，`toolOutputs.mjs:31-48`，白名单外即拒）；预算：序列化 ≤20 000 字、深度 ≤16、节点 ≤400；`$ref` 只收本文档内 `#/...`；`presentationMeta` 必须是纯 JSON 顶层对象、≤4 000 字。**`render` 明确不做**——渲染归宿主，写了即拒。
- **本批不校验返回体**：宿主只把它原样透出到聚合面 `_meta['pinax/output']`（批次56 ①档：只定义合同）。

### 2.10 `context`

`:1033-1042`。`{ providers: string[], budgetChars }`。providers 去重去空；`budgetChars` 缺省 20 000，值域 0–400 000。providers 是上下文块种类名（`references`/`rules`/`selection`/`chapter`…），**必须用复数形状**（批次18 的 `reference` vs `references` 教训）。

### 2.11 `permissions`（v1 叫 `scopes`）

归一在 `normalizePermissions`（`:374-401`），校验在 `validateScopes`（`:1180-1222`）。两代写法都收，最终内部形状是作用域串：

- 对象形状只许 `{ type:'file', dir, mode }`，`type` 目前只能是 `file`，`mode ∈ {r, rw}`（缺省 `r`）→ 归一成 `file:<dir>:<mode>`。
- `agent:ask`（只能这一个二级名）／`state:read|state:write`／`net:<host>` 或 `net:*`／`file:<物理目录>:r|rw`。未知前缀即拒。
- **C3 硬闸**：`file:` 的目录必须落在自己的 `dataDirs` 里，越界报 `SCOPE_OUTSIDE_OWNER`，跨载体必须走对方声明的 `tools`。
- `permissions` 与 `scopes` 两处都写时取 `permissions`（`m.permissions ?? m.scopes`）。
- 实际清单常见形态是混写：`[{type:'file',dir:'正文',mode:'rw'}, 'agent:ask']`（`carriers/novel/manifest.mjs:73`）——合同允许。

### 2.12 `entry`

`:702-717`。`{ kind, path }`，`kind` 缺省 `'iframe'` 且目前**只认 iframe**；`path` 是插件目录内相对 `.html`，≤200 字（八条路径纪律在 `carrierManifest.shared.mjs:19-41`：非空、非超长、正斜杠、非绝对、非盘符、无空段/`.`/`..`、不以点开头、扩展名对得上）。与 `pinax.view.custom` 的 pane 必须成对，两种半声明都报 `INVALID_ENTRY`（`:242-250`）。

### 2.13 `services[]`

`:768-872`。允许键 `id / command / args / env / cwd / port / healthPath / restart / autostart / adopt`。

- `id` `^[a-z][a-z0-9-]{0,31}$`，不重复。
- 普通服务：`command` 必填 ≤400 字；`args` ≤32 项、每项 ≤400 字；`env` 是字面量表（≤64 项，键守 POSIX 变量名 `^[A-Za-z_][A-Za-z0-9_]{0,63}$`，值必须是 ≤2000 字的串，**不做变量展开**）；`cwd` 插件目录内相对路径；`port` 1–65535；`healthPath` 必须以 `/` 开头、不含 `..`、≤200 字，**给了 healthPath 就必须给 port**；`restart ∈ {on-failure, never}` 缺省 `on-failure`；`autostart` 缺省 `true`。
- `adopt:true`（@4，三独立体的端口管理正身）：语义是「外部进程自管，宿主只探活」——给了 `command/args/env/cwd` 任一项即拒；必须同时给 `port` 与 `healthPath`；`restart` 只能是 `never`（或省略）。归一结果只在 adopt 时带 `adopt` 键，老清单归一形状不变。

### 2.14 `mcp[]`

`:878-956`。允许键 `id / transport / prefix / command / args / env / url / allow`。`transport ∈ {stdio, sse}`；`prefix` 匹配 `^[a-z][a-z0-9_]{0,31}$`，同清单不得共用命名空间（跨载体撞名由注册表在安装期仲裁）。stdio：必填 `command`，声明 `url` 即拒；sse：只收 `url`/`allow`，`command/args/env` 出现即拒，`url` ≤2000 字且只 http/https。`allow` ≤256 项，工具名 `^[A-Za-z0-9_.:-]{1,128}$`，去重。

### 2.15 `preview.register[]`

`previews.mjs:28-91`。`preview` 只认一个键 `register`，非空数组、≤16 条。项字段 `id / extensions / priority / loading / maxBytes`：`id` `^[a-z][a-z0-9.-]{0,63}$` 唯一；`extensions` 1–16 项、必须小写带点 `^\.[a-z0-9]{1,10}$`、**同一清单内一个扩展名只能有一个渲染器**；`priority` 0–100 缺省 0；`loading ∈ {text-pages, bytes-complete}`（必填，批次55 的按页读就直接吃这一档）；`maxBytes` 必填、1–64 MiB。

### 2.16 `license`

`contract.mjs:69-101`。`{ mode, agreement?, version? }`。`mode ∈ {free, subscription, buyout}` 必填；`agreement` 是插件目录内相对路径且必须 `.md`/`.txt`；`version` 须 `x.y.z`。

---

## 3. `@1 → @4` 改名对照表

写侧只认 @4 那一列。读侧仍兼容，但**老清单写新字段即整份拒装**。语义列一并说明这次改名到底改了什么——不只是换个名。

| @1（v1 规范原文） | @2 | @3 | @4 | 语义变化 | 出处 |
|---|---|---|---|---|---|
| `capabilities` | `provides` | 同 | 同 | 仅改名；两处都写必须等集，写侧只认 `provides`；归一结果两个键都给 | `carrierManifest.mjs:251-255`、`:285-286` |
| `scopes` | `permissions` | 同 | 同 | 改名＋**结构化**：`{type:'file',dir,mode}` 归一为 `file:<dir>:<mode>`；作用域语义与 C3 归属闸不变 | `:363-401`、`:1180-1222` |
| 顶层 `panes` | `contributes.panes` | 同 | 同 | 挪进 contributes；两处都写即拒（单一来源） | `:220-227` |
| `settings` | `contributes.settings` | 同 | 同＋`volatile/min/max/step` | 挪位置；@2 起可声明控件类型；@4 起值域与可写性入合同 | `:403-429`、`:1057-1178` |
| —（无） | `contributes.commands` | 同 | 同 | @2 新声明面（至今零声明零消费） | `:435-463` |
| —（无） | `contributes.renderers` | 同 | 同 | @2 只登记类型名，唯一口 `pinax.view.custom` | `:466-486` |
| —（无，宿主按 pane id 前缀猜视图） | `pane.view` | 必填 | 必填 | 「不声明就猜」→「显式声明」；v1 前缀表只作迁移对照（`LEGACY_VIEW_BINDINGS`） | `:611-620`、`viewRegistry.mjs:42-56` |
| —（内容面靠 id 前缀推断） | — | `pane.kind` | 必填 | @3 起前缀猜测彻底退场；`kind↔view` 必须显式配对 | `:621-638` |
| — | — | `entry` | 同 | 自带面板（沙箱 iframe） | `:59`、`:702-717` |
| — | — | `services` | 同＋`adopt` | 载体自带本地服务；@4 补「只探活不 spawn」档 | `:768-872` |
| — | — | `mcp` | 同 | 外部 MCP 服务端（stdio/sse）＋命名空间 | `:878-956` |
| — | — | `agentMd` | 同 | 插件自带作者须知，运行时并入上下文 | `:720-725` |
| `minKernel`（只比 major） | 同 | 同 | 同＋`maxKernel`，比对收紧到 **major.minor** | 上界入合同；豁免机制登记为未采用 | `contract.mjs:1-13`、`:507-509` |
| — | — | — | `pane.multiplicity`/`scope`/`keyField` | 槽语义三态；`chain` 登记未采用 | `paneSemantics.mjs:17-49` |
| — | — | — | `pane.claims`/`priority`/`canOpen`/`takes` | 资源认领与接管；`builtin` 为宿主保留 | `claims.mjs:15-146` |
| — | — | — | `preview.register` | 渲染器注册＋`loading` 读取档 | `previews.mjs:17-91` |
| `tools: string[]` | 同 | 同 | 同＋对象条目 `{name, output}` | @4 起可带输出体合同 | `:998-1031` |
| — | — | — | `license` | 授权声明面 | `contract.mjs:69-101` |
| — | `subscriptions` | 同 | 同 | @2 新增；至今词表只有 `project.changed` 一个词（F7） | `:131`、`:489-500` |

---

## 4. 三词表：槽位／形态／视图

三张表是三件不同的事，**不许互相顶替叫法**（F9）。

### 4.1 槽位（`OPEN_SLOTS`）——「这块板住在外壳哪一格」

出处 `carrierManifest.mjs:156-157`；`host-descriptor.json:7-8` 同步。

| 值 | 宿主落点 | 备注 |
|---|---|---|
| `left-dock` | `ActivityRail.vue` 竖条格 | 主载体置顶，顺序 `orderActivityItems` |
| `center` | `.col-center` 页底座（页组×页列表×形态） | 批次61 v3 |
| `overlay` | `FloatingWidget.vue` 悬浮窗 | 宽度 200–600（缺省 300）；**每载体至多一枚**，多声明即拒（`:680-695`） |

保留字（声明即 `RESERVED_SLOT`）：`right`（右栏归一级公民运行时，作者 2026-10-27 裁定 R2）、`top-menu`（插件不得注入顶层菜单）。

### 4.2 形态（清单词表 vs v3 状态轴）——「同一块板能摆成几种样子」

**协议词表五值**（`carrierManifest.mjs:134` `PANE_FORM_WORDS`；`paneForms.mjs:16` `PANE_FORMS`；对外 `host-descriptor.json:9`）：`dock / split / overlay / fullscreen / immersive`。
**v3 状态轴三值**（`workspace.mjs:38` `PAGE_FORMS`）：`page / floating / tab`。

| 协议词 | 菜单文案（`PANE_FORM_LABELS`，`paneForms.mjs:37-43`） | v3 落点（`FORM_ACTIONS` `:19-23` → `MENU_TARGET_FORM` `:34`） | 落点现状 |
|---|---|---|---|
| `dock` | 停靠栏 | `action:'dock'` → `form:'page'`，留当前页组 | 有 |
| `split` | 分屏 | `action:'side'` → `form:'page'` ＋ `group:'side'` | 有（分屏是**页组**不是形态） |
| `overlay` | 浮窗 | `action:'float'` → `form:'floating'` | 有（唯一持几何的形态） |
| `fullscreen` | 全屏 | **无落点** | 不进右键菜单（避免骗人入口）；v2 期曾被收成浮窗子态 `maximized` |
| `immersive` | 沉浸 | **无落点** | 同上；批次45 的「沉浸态」实为 `placement:'immersive'`（另一条轴，不是 forms） |

**现状量化（2026-11-02 工作树实测）**：11 份清单共 25 处 `slot:` 声明，其中 23 处含 `fullscreen`、13 处含 `immersive`（口径 `grep -rho "slot: '" next/carriers/*/manifest.mjs | wc -l`；逐词 grep 同框架计划 §9）。右键菜单只列「声明 ∩ 可落点」，所以这 23/13 处声明今天点不出来——**F6**。
**裁定**：Q2＝删词（`fullscreen`/`immersive` 从协议词表、25 处声明与对外描述符三处同删），落批次66，见 `docs/plan/pinax-ruling-ledger-20261102.md`。删前本表的留名即为过渡期口径；J4 判据（`forms ⊆ 可实现集合`）在删词落地后才能转「达成」。

### 4.3 视图（`view`）＋内容面（`kind`）——「用什么方式渲染 / 渲的是哪一类面」

| 档 | 值 | 出处 |
|---|---|---|
| 宿主视图类型（8） | `pinax.view.tree / list / editor / reader / diff / graph / board / app` | `viewRegistry.mjs:21-30` |
| 第三方唯一口（1） | `pinax.view.custom` | `:33`、`carrierManifest.mjs:140` |
| 内容面词表（13） | `chapter-editor / outline-editor / notes-editor / entry-detail / script-editor / rule-editor / document-detail / records-editor / proposal-review / entries-workspace / entries-categories / external-app / custom-panel`（＋词表顺序见 `:84-102`） | `PANE_KIND_WORDS` `:84-102` |

`board`（看板面）与 `app`（应用面）由批次44 加入，宿主视图从 6 变 8——**`carrierManifest.mjs:149,465,476` 三处注释仍写「宿主六种视图」，属陈旧注释，登记在台账待批次66 修**（本合同表以常量为准，注释不权威）。
配对纪律（@3+）：`pinax.view.custom` ⟺ `kind:'custom-panel'`；`pinax.view.app` ⟺ `kind:'external-app'`（⟹ 必须给 `app.url`，只本机回环）。写一半即拒。

---

## 5. 装载合同（现状 ＋ 桩2／批次65 的目标合同）

### 5.1 今天的事实：静态数组，零装载路径

- 11 块内置载体＝静态 import 的冻结数组：`next/carriers/index.mjs:2-31` 逐块 import、`:201` `BUILT_IN_CARRIER_PLUGINS = Object.freeze([...])`、`:214` `BUILT_IN_CARRIER_IDS`。
- **全仓没有一处 `readdir` ＋ 动态 `import()` 的装载路径**（`next/kernel`／`next/carriers`／`next/runtime`／`next/index.mjs` grep 零命中）。这就是 F1。
- 门禁把数量写成了断言：`next/testing/acceptance.mjs:361` `BUILT_IN_CARRIER_PLUGINS.length === 11 && v4Regressions.length === 0`。新增能力必须先改门禁（F10）。
- 两个「像装载但不是」的现成机制，别混：
  - `.pinax/carrier-overrides.json`（`next/carrierOverridesStore.mjs`）＝对**已有载体**的面板/服务/设置值做两级覆盖，是覆盖不是装载。
  - `collectPluginDirs({ registry, overrides })`（`next/runtime/pluginDirs.mjs`）＝插件目录→路径映射，消费方是 `agentRuntime.mjs:60`／`mcpSurface.mjs:72`／`serviceSupervisor.mjs:85`，形参 `overrides` 至今**没有任何外部调用方喂目录**（`pluginDirs.mjs:9`）。
- 后果（加一块载体的真实改动面，9 处）：新目录四件套（manifest/tools/context/AGENT.md）＋ `carriers/index.mjs` 的 import／信任常量／工厂／数组／认领表／再导出 ＋ `kernel/capabilities.vocab.mjs` ＋ `shell/viewRegistry.mjs` 绑定 ＋ `shell/layoutTemplates.mjs` 推断 ＋ `kernel/projectSkeleton.mjs` 目录 ＋ 打包拷贝 ＋ 门禁计数。

### 5.2 目标合同（批次64 先打桩、批次65 正式；本节即届时的合同占位）

1. **装载路径**：扫 `.pinax/plugins/*/manifest.json` ＋（可选）宿主 `overrides` 目录 → 走**同一个** `validateCarrierManifest(@4)`（合同 §2）→ 出 scope 摘要给作者看 → `registry.install`。内置与外部共用同一条路径，**内置＝随包已安装，不再是能力特权**；`BUILT_IN_CARRIER_PLUGINS` 退化为「随包安装清单」（只列 id，不 import 实现）。
2. **门禁随之改**：`acceptance.mjs:361` 的数量断言删除（J2 判据的一部分）。
3. **第一档只接受声明型外部插件**：`panes/commands/settings/tools` 全部复用既有内核面，**不执行第三方 JS**；`trustMode` 仍为 `same-process`（`host-descriptor.json:6`），声明型只读数据。要开 JS 执行必须先单独裁沙箱形态（worker/iframe ＋ scope 审批 UI），不得沿用 `same-process`——**Q4 已裁：第一档不开**（2026-11-02）。
4. **卸载与隔离**：`pluginRegistry` 的 `dispose`／`onDispose`／`onUninstalled`／`disposeOwner` 链（`:255-260` 一带）是「停用后干净退场」的既有底座，装载面接上后不许新增旁路。
5. **体检**：`next/doctor.mjs` 五态（ok／needs-host-upgrade／permission-denied／incompatible-form／missing-capability）增加「外部插件装载态」用例，复用现框架。
6. **风险登记（不做隐形闸）**：Windows 中文路径与打包路径是既往坑；装载原型（批次64，30 行 fixture，只在 `node --test` 里跑，不起 Electron）若不过，**停在原地回报**，不许硬推批次65。

### 5.3 三张公共表（J1 的清单口径）

| 表 | 声明面 | 校验器 | 取口 | 消费端现状 |
|---|---|---|---|---|
| 命令表 | `contributes.commands` | `carrierManifest.mjs:435-463`（齐） | `registry.commands()`／`commandOwner()`（`pluginRegistry.mjs:268-281`，齐） | **零消费**（真清单 0 声明，仅 `tests/manifest-v2.test.mjs:184,198` 假清单验过） |
| 视图表 | `contributes.renderers` ＋ `pane.view`/`kind` | `:466-486`、`:611-638` | `viewRegistry.mjs:21-35` | **有**：`doctor` 核、宿主按表解析；批次42 起 n3b/v 两条门禁防「加视图忘改 descriptor」 |
| 设置表 | `contributes.settings` | `:1057-1178` | `SettingsModal.vue` 目录 ＋ `settingsStore.mjs` 白名单 | **有**：统一二级页、`.pinax/settings.json`、工程覆盖三级都吃这一份 |

---

## 6. J1–J6 六判据（引自框架计划 §5，逐条注当前达成态）

六条判据本身**必须接进 `verify:next`**（作者既有裁决：门禁接在提交链路上）。本节只登记达成态与接法，不在本批改任何门禁。

| # | 判据（原文口径） | 当前达成态（2026-11-02 工作树） | 缺口与接法 |
|---|---|---|---|
| **J1** | 三张公共表可枚举，且每张必有消费端 | **部分**。合同与取口三面齐（§5.3）；视图表、设置表有真消费端；**命令表零声明零消费** | 批次62：`command:list` ＋ menu id 集扩成「MENU_TEMPLATE ∪ `registry.commands()`」 ＋ `CommandPalette.vue`；门禁补「命令表非空＋每条可解析 owner」（先记账不打回） |
| **J2** | 一切从磁盘装载，内置只是「随包已安装」；门禁里不再出现载体数量断言 | **未达成**。静态数组＋零装载路径（§5.1），数量断言仍在 `acceptance.mjs:361` | 批次64 打桩、批次65 正式（§5.2）；fixture 装入→竖条出现→命令进面板→停用后视图/订阅/工具全释放 |
| **J3** | 两个常驻入口永远可达（`Ctrl+P` 面板＋快速打开；停用全部载体后仍可用） | **未达成**。`CommandPalette`／`命令面板`／`QuickSwitcher` 在 `next/` 字面命中 0；键盘处理是 `next/shell` 里 39 处各自 `keydown`，无注册表。故障隔离的一半成立（运行时不可停用、`right` 槽保留） | 批次62（面板＋hotkeys.json）＋批次63（「全部载体停用后面板与快速打开仍可用」回归测，规范 §9.3 从未实现那条） |
| **J4** | 状态轴与词表同构：清单能声明的每个形态，状态机必须有落点；落不了的词不得出现在对外描述符里 | **未达成**。词表 5 值、v3 落点 3 值；25 处声明里 23 处含 `fullscreen`、13 处含 `immersive`，且这五词仍在对外 `host-descriptor.json:9` | 批次66 按 **Q2（已裁＝删词）** 三处同删；门禁加「逐 pane 断言 `forms ⊆ 可实现集合`」 |
| **J5** | 布局可序列化、可恢复，且包含「最近打开」与逐视图状态 | **部分**。`.pinax/workspace.json` v3 四轴已落（group/order/active/focus/form/resource/geometry/z），v1/v2 读侧一次性迁移；`maximized` 退役为浮窗子态。**缺 `lastOpenFiles`、缺逐视图 `getState`（树展开/滚动/选中）、无递归 split（两组页组，有意为之）** | 批次66：workspace v4 补两格＋读侧一次性迁移；写盘 debounce 记账（对照 Obsidian 1000ms） |
| **J6** | 设计语言是数据：`DESIGN.md`＋`tokens.css`＋`manifest.json`，门禁与工具读同一份；一名一值可检查 | **未达成**。三文件全仓不存在；语义 token 8 个、OD token-map 覆盖 3.0%；`--text-muted` 一名四值、`--accent-primary` 144 次引用零定义 | 批次67（**Q6 已裁＝与 v2 同批**，本档即前半）；`--text-muted` 收敛为一名一值＋主题覆盖表（审计 P） |

---

## 7. 术语表（F9：一物一名，中英对照，禁止同义替换）

写文档、写代码、写工单、写提交信息都按本表用词。**「禁止同义替换」的含义**：一个概念只有一个规范名；下表「禁用」列出的词在文档与界面里不许再拿来顶替规范名（历史文档与代码里的旧写法不追溯改动，但新写法不得沿用别名）。

| 规范名（中） | 规范名（英／代码） | 定义 | 禁用（同义替换） | 权威出处 |
|---|---|---|---|---|
| 载体 | `carrier`（清单 `spec: 'pinax-carrier@4'`；类型名 `tier:'carrier'`） | 一块可插拔的二等公民功能单元（一份清单＋自己的目录与工具） | 插件、边栏、板块、模块 | `carrierManifest.mjs:210` |
| 插件（**受限用法**） | `plugin` | 只用于装载/注册机制语境：注册表、装载器、插件目录（`pluginRegistry`／`pluginLoader`／`pluginDirs`／`pinax-plugin://`） | 用「插件」当「载体」的别名 | `pluginRegistry.mjs` |
| 板 | `pane` | 载体贡献的一个面板单元（清单 `contributes.panes[]` 的项） | 窗、标签（作名词时） | `carrierManifest.mjs:584` |
| 页 | `page` | 中心区页底座里的一份**实例**（`form:'page'`，住在某页组，有 identity 与 resource） | 用「页」指代 pane 定义本身 | `workspace.mjs:38` |
| 窗 | `floating`（浮窗） | `form:'floating'` 的页实例，唯一持有几何；与协议槽位 `overlay` 是两回事（overlay 是**声明要悬浮**，floating 是**页的形态**） | 悬浮窗/弹窗混用 | `workspace.mjs:11-16` |
| 侧缘标签 | `tab` | 页的收成态 | 签、标签页 | `workspace.mjs:38`、`PAGE_ACTIONS` |
| 页组 | `group`（`main`/`side`） | 中心区的两组页；**分屏是页组的存在，不是形态** | 「分屏形态」「tile」 | `workspace.mjs:34` |
| 形态 | `forms`（清单）／`form`（v3 状态轴） | 一块板能被摆成哪些样子 | 「布局」「排布」 | `carrierManifest.mjs:134`、`paneForms.mjs:16` |
| 布局模板 | `layoutTemplate`（`folder`/`web`/`gallery`） | 宿主渲染层的排布模板，**与「形态」不是一个词**，不进 @4 schema | 「形态」「视图」 | `layoutTemplates.mjs:17-24` |
| 槽位 | `slot`（`left-dock`/`center`/`overlay`） | 板住在壳的哪一格 | 「位置」「区域」 | `carrierManifest.mjs:156` |
| 视图类型 | `view`（`pinax.view.*`） | 用什么渲染器画这块板 | 「形态」「内容面」 | `viewRegistry.mjs:21-35` |
| 内容面 | `kind`（`PANE_KIND_WORDS`） | 渲的是哪一类面（正文/条目/记录…） | 「视图」「模板」 | `carrierManifest.mjs:84-102` |
| 能力 | `capability` | 可被依赖闭包引用的供给单位（16 词表） | 「功能」「服务」 | `capabilities.vocab.mjs:9-28` |
| 作用域／权限 | `permissions`（内部形状为作用域串） | 对目录/运行时/状态的访问申请 | 「scope」与新名混写（写侧只认 `permissions`） | `carrierManifest.mjs:374-401` |
| 主载体 | `primary` | 每项目有且只有一个；决定 kind、默认落点、上下文档案 | 「主插件」「一级载体」 | `carrierManifest.mjs:511-530` |
| 一级公民 | 运行时（Pi-Agent） | 唯一常驻、不可停用、独占右栏 | 「插件」「载体」 | 规范 v1 §2／§5（R2 已裁） |
| 载体清单 | `manifest`（`next/carriers/*/manifest.mjs`） | 一份载体合同的正文 | 「配置」「设置」（那是 `settings`） | 本档 §2 |
| 项目档案 | `pinax-project@N`（`.pinax/project.json`） | 项目侧状态（`carriers{primary,enabled,revision}`） | 「载体清单」——两条版本线，见 §0 | 规范 v1 §3 |
| 提案 | `proposal`（`.pinax/proposals/`） | 改稿的唯一写回形状 | 「草稿」「自动改」 | 批次15 链 |
| 写族闸 | `writePolicy` | 外部写工具按档转提案/直写/拒绝 | 「权限」「拦截器」（`toolInterceptors` 是其实现件） | 批次45／50 |
| 元数据目录 | `.pinax/` | 内核元数据 turf，载体 `claims` 不得伸入 | 「缓存」「state」 | `claims.mjs:52-54` |
| 归档视图 | `archive` | 不再被任何启用载体声明的目录的只读展示 | 「回收站」「备份」 | 规范 v1 C4／D5 |

**「1＋N 的 N」的口径**（F9 最后一句要求）：N = **启用的载体数**（今日 `enabled` 计数，非形态数、非页组数）。作者目标里的「多形态切换」指的是同一块板的 `forms`，两者不许混写成一个数字。

---

## 8. 与 v1 的关系、本档未覆盖项

- **v1 保留为历史**，不删不改。v1 §1（命名与边界）、§2（公民层级）、§4（D1–D5 主载体与依赖闭环）、§5（运行时优先级五件硬事）、§6（外壳五约束）、§7（T0/T1/T2 信任级）的**裁定仍然有效**；本档只把 §3（清单合同）与槽位词表升到与代码同代。
- v1 §3 的 JSON 样例是 `@1` 字段名，今天照它写会被 `spec` 闸拒——照本档 §2＋§3 改名表写。
- 本档**不含**：视觉与界面规范（走审计报告与 `docs/plan/pinax-electron-next-ui-consistency-plan-20261028.md`）、DESIGN.md/tokens（批次67）、任何未裁项的裁定（一律看 `docs/plan/pinax-ruling-ledger-20261102.md`）。
- 已知「合同外 passthrough」两处（`board.layout`、`pane.preview.loading`）已在 §2.4 末注登记，属批次65/66 待收口，不在本档新造裁定。

---

## 9. 本档的自证（DoD「跑一次即证」）

新读者按本档写清单能否过校验器，本批已实跑一次（脚本在**仓外** `D:/Pinax-main/_tools/spec-v2-selfcheck.mjs`，
不进仓库、不进门禁；纯内存调用 `validateCarrierManifest`，无 IO）：

- **正例 PASS**：一份只用 §2 合同表＋§4 三词表＋§7 术语表拼出来的 `@4` 清单被收下并归一——
  `spec/manifestVersion → pinax-carrier@4 / 4`；`panes → selfcheck.editor:keyed/entry/path , selfcheck.list:single/project`；
  `claims ["正文/**/*.md"] priority 30 takes extension`；`provides` 与 `capabilities` 归一后一致；
  `scopes → ["file:正文:rw","file:自检资料:r"]`（C3：只为自己 `dataDirs` 申请）；`toolOutputs` 出键；
  `preview`／`license` 照声明归一；`settings 3 条 / commands 1 条`。
- **反例 A PASS**：同一份清单把 `spec` 降到 `@3` 并**去净**全部 `@4` 字段后仍然装得上——老合同没被本档写坏。
- **反例 B PASS**：`@3` 清单偷留一个 `license` → 拒装 `PINAX_INVALID_MANIFEST`，文案「这是 pinax-carrier@4 的字段，请把 spec 与 manifestVersion 一并升级到 4」，
  `details.where = "top"`。§0 的三张拒装名单是真闸，不是文档承诺。

复现：`node D:/Pinax-main/_tools/spec-v2-selfcheck.mjs`。
