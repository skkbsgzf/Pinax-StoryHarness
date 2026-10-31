# 批次57 记录：能力全表自动导出——descriptor 与注册表一致性（Cordis 线C·文档不再漂移）（2026-10-31）

> 执行：Qoder CLI（DeepSeek-Flash）。工单源：[执行工单](./pinax-electron-next-m2-batch57-ticket-20261031.md)。
> 不执行 git；不启动/不杀 electron；未改 `server/**`、`src/**`；未加 npm 依赖；未改 viewRegistry／词表本体；未动运行时行为（纯文档与门禁批）。

## 交付

1. **`next/testing/exportHostDescriptor.mjs`（新）——宿主描述符唯一生成器**
   - `buildHostDescriptor()` 从词表常量现算：`views ← VIEW_TYPES`（八宿主视图＋custom，九项）、`forms ← PANE_FORMS`（五态）、`slots ← OPEN_SLOTS`（三槽）、`reservedSlots ← Object.keys(RESERVED_SLOTS)`（right／top-menu）、`carrierSpecs ← SUPPORTED_CARRIER_SPECS`、`kernelContract ← KERNEL_CONTRACT_VERSION`。
   - 无现成词表的三项（`uiLayers`／`trustMode`／`supportsPopout`／`platforms`）是宿主结构事实，由生成器持有（本批不许改词表本体，见偏离 3）。
   - `diffHostDescriptor(actual)` 逐字段严格比较：数组按序比、对象按键集比，多出顶层键记 `unexpected`、缺字段记 `missing`；`checkHostDescriptor(file?)` 读盘解析，读不到／坏 JSON 也返回可渲染的失败载荷。
   - CLI 三态：默认核账（不一致 exit 1，逐条打印 field／reason／应为／实际并提示 `--write`）、`--print`、`--write`（按生成器重写 `next/host-descriptor.json`）。
   - 实测：盘上那份与生成器逐字段一致；**本批未重写 descriptor**（语义无漂移，仅数组排版不同，见偏离 1）。

2. **`next/testing/bundleAssertions.mjs` 扩两条门禁**
   - **n3b**：十二份 `next/carriers/*/AGENT.md` 逐一核 `/^## 已知边界\s*$/mu`；任何一份缺段即红，输出缺哪几块。（既有 n3 只核 AGENT.md 进产物与源码一致，不核内容段。）
   - **v**：`checkHostDescriptor()` 不一致即红——新增宿主视图忘改 descriptor 现在会被抓（doctor 只核字段在不在，核不出与注册表不一致）；失败信息按 `field:reason` 列全。

3. **十二份 `AGENT.md` 补「## 已知边界」段（12/12）**
   - 内容从既有批次记录／开发者指南汇编，按载体如实列未做项；新增 README 一律没有（须知就是 AGENT.md）。
   - 因 agentMd 信封总量闸（见偏离 2），各段压成一条密排要点，保留批次号：
     - novel：编辑面仍 textarea／无 diff／无跨保存撤销（批次15）
     - outline：只认 outline.json／大纲.md、散文稿需导入、断链／环平铺（批次18）
     - notes：只有 list／save、无上下文块、列表只列顶层
     - worldbook：类别一层、裸 md 不带 meta、双链只链首现（批次21）
     - script：只认 .md、不递归、无历史入口、需 Ctrl+S（批次26）
     - setting：只放约束、无历史入口、需 Ctrl+S（批次16）
     - reference：只认 .md／.txt、不递归、检索靠本机运行时（批次18）
     - material：图片只存 refs、面板只读、素材库为空（批次40）
     - comic：没接真 ComfyUI、`comfy_submit` 停用、不写图片、不 spawn 外部服务（批次48／58）
     - video：渲染管线未接、`rendering` 不代表出片、成片只存 refs（批次40）
     - experience：只记会话、不跑团／不算骰、依赖 `script.scenes`（批次40）
     - online：联机为外部服务、不申请 net、只记本地房间信息（批次40）
   - **comic 的段前置到开头**：该文件 3.2k 字，信封按 1200 字切片，段留在文末模型永远读不到。
   - 顺手把 experience／video／notes 的三处与段落重复的冗句收紧（同文件内去重，语义未变）。

4. **`docs/plan/pinax-plugin-author-guide-20261031.md` 接生成器（一行）**
   - v3 字段速查表后加引用块：「本表是手写速查；宿主能力全表以 `next/testing/exportHostDescriptor.mjs` 的输出与 `next/kernel/carrierManifest.mjs` 的词表为权威，手写表漂移以门禁为准。」

5. **`next/tests/host-descriptor-export.test.mjs`（新，4 条）**
   - 生成器取值全部追溯到词表常量（views=9、forms=5、supportsPopout=false、platforms=['electron']）。
   - 盘上 descriptor 与生成器逐字段一致、differences 为空。
   - **反向断言**：views 删一项／换序、forms 删 immersive、slots 加 right、reservedSlots、carrierSpecs、kernelContract、uiLayers、supportsPopout、platforms 共 10 种篡改逐一必须报 diff；多顶层键报 `unexpected`、缺字段报 `missing`。
   - 规范序列化末尾换行、回读与生成器相等、diff 为空。

## 验收

- `npm run next:build:main && npm run next:build:shell`：通过（main 1794.02 kB、shell 2069.71 kB、preload 5.45 kB）。
- `npm run verify:next`：**五段全绿，exit 0**。
  - acceptance：**35/35**（本批不加验收条目；一致性归打包门禁）。
  - node tests：**643/643**（本批 +4，`host-descriptor-export.test.mjs`）。
  - vitest shell UI：**197/197**（14 files；本批无渲染层改动）。
  - eslint：0 error／0 warning。
  - bundleAssertions：全过；新增 **n3b**（12/12 有「## 已知边界」）与 **v**（12 个字段、views 9／forms 5，逐字段等于生成器）。
- 判据逐条对账：
  - **一致性 gate 在**：门禁 v 复算并逐字段比对；doctor 的口径不被替代，只是多一道真值核对。
  - **反向断言会红**：node 侧 10 种字段篡改全报 diff；门禁 v 直接消费同一 `checkHostDescriptor`，改错任一字段即红。
  - **AGENT.md 已知边界 12/12**：门禁 n3b 逐一核；`carrier-v3-rollout` 的「须知进信封零警告」同轮通过（总量 7923/8000）。
  - **文档一行在**：指南表后引用块（第 36 行）。

## 计数变化与理由

| 位置 | 变化 | 理由 |
|---|---|---|
| node tests | 639 → 643 | +4：`host-descriptor-export.test.mjs`（溯源／对账／反向篡改／序列化）。 |
| bundleAssertions | +n3b、+v | n3b 守 12 份须知都有已知边界段；v 守 descriptor 与注册表现算值逐字段一致。 |
| acceptance | 35/35 不变 | 本批无新验收链路；一致性由 bundle gate 与 node 测试双守。 |
| vitest shell UI | 197／197（14 files）不变 | 无渲染层改动。 |
| 工具面／清单 | 44 把、12 份 @4 不变 | 未动清单与工具。 |

## 偏离（已记录，非静默）

1. **未重写 `next/host-descriptor.json`**：生成器核对语义完全一致，盘上那份只是数组写成紧凑行（723 字 vs `--write` 后 819 字）。门禁按解析后的值比，不按字节比；无内容漂移就没有要写理由的逐处修正。将来真改词表，跑 `node next/testing/exportHostDescriptor.mjs --write` 即可。
2. **已知边界段压成单条密排**：agentMd 信封总量闸 8000 字（`contextProfiles.mjs`），十二份多要点版本会把总量顶到 10155，既有的 `carrier-v3-rollout`「零警告」断言直接红。最终总量 7923/8000（余量 77），信息保留（未做项＋批次号），细节仍在批次记录与开发者指南。若要恢复逐条展开，先抬信封预算另立小批。
3. **`uiLayers`／`trustMode`／`supportsPopout`／`platforms` 由生成器持有**：仓库里没有对应词表常量，本批工单又明确不许改 viewRegistry／词表本体，故不新造第二处常量；生成器即这三项／四项的唯一权威，门禁 v 保证盘上与它一致。
4. **n3b 固定期望 12 份**：沿用既有 n3／r1／r2 的「12 份逐一核」口径；新增载体时计数与名字枚举同步（与 acceptance 的硬编码计数同一纪律）。
5. **experience／video／notes 的冗句收紧**：为压信封预算，同文件内把与「已知边界」重复的句子合并（如「这一栏只记会话、要真跑由运行层驱动」），不改规矩语义。

## limitations

1. 未起 Electron：本批是纯文档与门禁批，无 UI；一致性由 node 测试＋打包门禁覆盖。
2. 已知边界段因总量闸只保留一条密排要点，未逐项展开；细节需查批次记录／开发者指南。
3. 门禁 v 只核 descriptor 与「现有词表常量」一致；词表常量为空或写错（例如 VIEW_TYPES 少一项且 descriptor 同步少一项）不会被发现——本批不做「词表是否覆盖真实注册」的二次审计。
4. `uiLayers` 等四项无独立词表常量，改动只在本生成器一处；若将来另有消费方需要独立常量，需另立小批补真源。
5. 环境备注：本机默认并发跑 node tests 时曾两次出现 `spawn UNKNOWN`（errno -4094，Windows 子进程创建瞬时失败，与代码无关：失败后单文件复跑全绿）；低并发 4 复跑 643/643，随后默认并发与 `npm run verify:next` 均 exit 0。
6. 调度方用临时索引法核 diff（§8），执行方未自行核；本记录未包含 git 操作。

（§8 由调度方补。）

## §8 调度方验收（Zcode）

- 门禁独立复跑 exit 0（五段全绿）；零行尾翻转；执行方记录自落盘。
- 评审 0 条发现（连续第二批）。
- 抽查：exportHostDescriptor 从词表常量现算并逐字段对账（不一致 exit 1）、n3b 12/12 已知边界段、v gate 反向断言（改错字段即红）在；AGENT.md 已知边界段内容与各批次记录挂账对得上。
