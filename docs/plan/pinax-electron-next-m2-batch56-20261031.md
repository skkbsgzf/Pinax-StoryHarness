# 批次56 记录：工具输出契约——合同定义＋元数据透出（Cordis 线C · 只做第一档）（2026-10-31）

> 执行：Qoder CLI（DeepSeek-Flash）。工单源：[执行工单](./pinax-electron-next-m2-batch56-ticket-20261031.md)。
> 不执行 git；不启动/不杀 electron；未改 `server/**`、`src/**`；未加 npm 依赖；未动 toolLoop/toolTurn 执行语义；未动存量工具返回体；未动错误码表；`render` 未采用。

## 交付

1. **`next/kernel/carrierManifest.toolOutputs.mjs`（新）只读合同校验器**
   - 工具条目可带 `output: { schema: <JSON Schema 对象>, presentationMeta?: 对象 }`，**可选**；出现即校验，缺省＝老清单照装。
   - 形状纪律：`output` 只认 `schema`／`presentationMeta` 两个键（写了 `render` 即拒——渲染归宿主，本批不做）；`schema` 必填且必须是纯对象；**根必须 `type: 'object'`**（工具返回体恒为对象信封，对齐 MCP `outputSchema`）。
   - 关键字白名单：JSON Schema 2020-12 子集（标识／注释、类型取值、数值、字符串、数组、对象、组合），白名单外一律拒装，避免「写进去却没人认」。
   - 逐键形状校验：`type` 只收 7 种类型字；`required` 是非空字符串数组；`enum` 非空；`pattern` 必须可编译；长度／条数类必须是非负整数；数值边界必须有限数；`$ref` 只收本文档内引用（`#/...`），远端引用本批无解析器，直接拒。
   - 预算沿用 `*_MAX` 家族：schema 深度 ≤ 16、节点数 ≤ 400、序列化长度 ≤ 20000 字；`presentationMeta` 必须是顶层纯对象、只收 JSON 值、序列化 ≤ 4000 字。
   - 归一结果 `{ schema, presentationMeta? }`：没声明 `presentationMeta` 就不出这个键，归一结果不多出死键。

2. **`next/kernel/carrierManifest.mjs` 接线（清单校验面）**
   - 新增 `V4_ONLY_TOOL_FIELDS = ['output']`：`output` 是 `pinax-carrier@4` 的可选附加字段，不另开 @4.1。
   - `validateTools` 改为对象／字符串两形态：@1–@3 仍只收字符串名；@4 允许 `{ name, output? }`，未知键拒装；工具名规则与重复检测（`TOOL_CONFLICT`）照旧；对象与字符串混写同名也算重复。
   - 老 spec 写对象条目或写 `output` → 拒装并提示「把清单 spec 与 manifestVersion 一并升级到 @4」；`firstV4Field` 也扫描 `tools` 的对象条目，老清单带 @4 专属字段时仍走统一的「@4 专属」错误口。
   - 归一结果 `tools` **仍是字符串数组**（存量消费方零改动），真声明了 output 的清单才多出 `toolOutputs` 键；12 份内置清单归一结果零新增键。

3. **`next/runtime/surfaceAggregate.mjs` 元数据透出（最小）**
   - 新增 `TOOL_OUTPUT_META_KEY = 'pinax/output'`；载体工具收集时把 `manifest.toolOutputs[name]` 一并带上。
   - `publicDescriptor` 把声明合并进 MCP 工具的 `_meta`：MCP SDK 的 Tool schema 只保留 `_meta`，未知顶层键会被剥离，所以出口只能走 `_meta`（与 `annotationsOf` 同路）；**没声明 output 的工具不出 `_meta`**，老工具描述逐字不变。
   - **零消费**：toolLoop／toolTurn 一行未动——声明了 output 的工具，其返回体本批不校验（消费归 roadmap ②档）。

4. **测试与门禁**
   - `next/tests/carrier-v4-tool-output.test.mjs`（新，16 条）：
     - 兼容 2 条：12 份内置清单 44 把工具全部照装、归一结果不出 `toolOutputs`；@1 夹具照装。
     - 合法 4 条：基础对象 schema；`presentationMeta` 原样保留；`$defs`／`$ref`／`enum`／`oneOf` 组合；@4 对象条目不带 output。
     - 非法 7 条：schema 缺失／非对象、根非 object、白名单外关键字、未知类型字、`properties`／`required`／`$ref`／`pattern` 形状、深度与长度上限、`presentationMeta` 非 JSON 对象、`render` 与未知条目字段、重名（`TOOL_CONFLICT`）。
     - 代际 1 条：@1／@3 清单写 output → 拒装并提示升级 @4。
     - 运行时 2 条：声明了的工具在聚合面带 `_meta['pinax/output']`、没声明的不带；**返回体不符合声明 schema（`text: 42` 穿过 `string`）仍照常成功**（零消费实证）。
   - `next/testing/acceptance.mjs` +2 条（33 → 35）：①12 份清单照装＋44 把工具零声明的兼容计数；②真链路运行时夹具（安装→开项目→起 agent→聚合面 `_meta` 透出→返回体不校验→非法 schema 安装期真拒）。
   - `next/testing/bundleAssertions.mjs` 新增守卫 `u`：主进程 bundle 里必须同时出现 `output.schema`、`presentationMeta`、`pinax/output` 三个标记（校验文案与透出键都在产物里，不是只活在源码）。

## 验收

- `npm run next:build:main && npm run next:build:shell`：通过（main 1794.02 kB、shell 2069.93 kB、preload 5.45 kB）。
- `npm run verify:next`：**五段全绿，exit 0**。
  - acceptance：**35/35**（本批 +2；工具面 40／46、载体工具 24／23 不变）。
  - node tests：**639/639**（本批 +16 条 `carrier-v4-tool-output.test.mjs`）。
  - vitest shell UI：**197/197**（14 files，本批无渲染层改动）。
  - eslint：0 error／0 warning。
  - bundleAssertions：全过；新增守卫 u；主进程 1819.8 kB（< 6 MB）、外壳 2108.9 kB（< 2.5 MB）。
- 判据逐条对账：
  - **output 合法／非法各有 ≥3 用例**：合法 4 条、非法 7 条（另兼容 2、代际 1、运行时 2）。
  - **无 output 的既有全部清单与夹具照装**：12 份内置清单 44 把工具＋@1 夹具，兼容断言在 node tests 与 acceptance 两处。
  - **非法 schema 真拒装**：`fixture.badoutput`（根 `type:'string'`）在 acceptance 真链路上被 `PINAX_INVALID_MANIFEST` 拒；node 级非法 7 条覆盖同样边界。
  - **聚合面透出点存在**：守卫 u ＋ 运行时夹具断言 `_meta['pinax/output']`。
  - **存量缺声明条数记账**：见下节。

## 计数变化与理由

| 位置 | 变化 | 理由 |
|---|---|---|
| acceptance | 33 → 35 | +2：兼容计数（12 份清单／44 把工具／零声明）＋运行时两半（透出／不校验／非法拒装）。 |
| node tests | 623 → 639 | +16：新文件 `carrier-v4-tool-output.test.mjs`（合同合法／非法、代际、兼容、运行时零消费）。 |
| vitest shell UI | 197／197（14 files）不变 | 本批只动清单校验与聚合元数据，无渲染层代码。 |
| bundleAssertions | +u | 守「output 校验文案与 `pinax/output` 透出键真进产物」；工具计数不变（44 把仍零声明）。 |
| 工具面 | 40／46（总）、24／23（载体）不变 | 无新工具、无存量工具声明 output；12 份清单未动。 |

## 《存量缺声明》记账（不进闸）

口径：`surfaceInfo().carrierToolNames` 现数 + 清单归一结果实际条数（本批实测）。

| 范围 | 工具条数 | 声明 output | 缺声明 |
|---|---|---|---|
| 12 份内置载体清单（全集） | 44 | 0 | **44** |
| acceptance 主项目（实际启用子集） | 24 | 0 | 24 |
| 记录项目（实际启用子集） | 23 | 0 | 23 |

- 本批**只记账不迁移**：44 把工具全部还没声明 output，迁移归 roadmap ②档。
- **声明了 output 的工具，其返回体本批不校验**：toolLoop／toolTurn 零改动，schema 只在安装期核形状；实际返回不符合声明不会报错（运行时夹具用 `text: 42` 穿过 `string` 实证）。
- 新工具若声明非法 schema 则安装期真拒（`INVALID_MANIFEST`），不存在「声明在、没人认」的中间态。

## 偏离（已记录，非静默）

1. **根类型收窄为 `type: 'object'`**：比 JSON Schema 本身更严——非对象根的合法 schema（如 `type:'string'`）会被拒装。理由：框架内工具返回体恒为对象信封，MCP `outputSchema` 也要求根是 object，声明了也用不上。要放开另立小批。
2. **元数据口走 `_meta['pinax/output']` 而非顶层字段**：MCP SDK 的 Tool zod schema 会剥离未知顶层键，只有 `_meta` 能原样到达渲染侧；与 `annotationsOf` 同路。聚合面的 `tools` 列表因此不是「每个工具多个顶层 output 字段」。
3. **`render` 明确不做**：工单裁定渲染归宿主；`render` 出现在 output 或工具条目里都拒装，不留「收下但不生效」的口子。
4. **`$ref` 只验本地前缀，不解析目标存在性**：本批不做解析器；语义正确性留给 ②档消费方。
5. **校验器拆独立文件**：`carrierManifest.toolOutputs.mjs`（工单允许的 contract 拆分文件），主文件只做接线，避免 `carrierManifest.mjs` 再膨胀。

## limitations

1. 未起 Electron，真窗口／装机包未目视；本批是纯清单与元数据面，无 UI，行为由 node 级夹具＋acceptance 真链路覆盖。
2. 返回体不校验（本批零消费的应有之义）：schema 只在安装期核形状，不核实际返回；「声明与返回一致」要等 ②档。
3. 本批未迁移任何存量工具：截至本批 44 把内置载体工具全部缺 output 声明。
4. `$ref` 不解析目标；白名单外关键字（如 `$dynamicRef`、`$anchor` 等）直接拒装；`format` 只收字符串、不校验取值。要扩子集需先扩白名单与测试。
5. 守卫 u 只证明标记在产物里，不证明运行时行为；行为本体由 node tests 与 acceptance 守。
6. 调度方用临时索引法核 diff（§8），执行方未自行核；本记录未包含 git 操作。

（§8 由调度方补。）

## §8 调度方验收（Zcode）

- 门禁独立复跑 exit 0（五段全绿）；真实改动 8 文件零行尾翻转；执行方记录自落盘。
- 评审 0 条发现——本轮唯一零发现批。
- 抽查：toolOutputs 校验器（JSON Schema 2020-12 子集白名单＋深度16/节点400/序列化2万字上限）、V4_ONLY_TOOL_FIELDS、老 spec 带 output 拒装并提示升 @4、tools 归一仍字符串数组（零行为变化达成——toolLoop 未动）。
- 存量缺 output 记账在批次记录；②档迁移/③取消/④错误码表未裁不动。
