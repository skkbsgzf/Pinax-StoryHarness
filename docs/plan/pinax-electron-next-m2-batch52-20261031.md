# 批次52 记录：载体清单 @4 的 schema 与校验（协议一次收口）（2026-10-31）

> 执行：Qoder CLI（DeepSeek-Flash）。工单源：[roadmap §4](./pinax-carrier-kernel-roadmap-tickets-20261031.md)→[执行工单](./pinax-electron-next-m2-batch52-ticket-20261031.md)。
> 不执行 git；不启动/不杀 electron；不改 12 份载体清单、`server/**`、`src/**`、外壳渲染层、写族/revision 语义。

## 交付

1. **`pinax-carrier@4` 进合同**：`SUPPORTED_CARRIER_SPECS` = @1/@2/@3/@4，`CARRIER_SPEC` 指向 @4，`manifestVersion` 与 spec 强制配对；@1/@2/@3 读侧归一形状不多出新字段（pane 不出现 multiplicity／claims 默认键；service 不带 `adopt:false`）。
2. **四组 Cordis 借鉴字段**（主校验器 `carrierManifest.mjs` 1114 行，未超 1400，按工单纪律拆出四个模块）：
   - 槽语义 `carrierManifest.paneSemantics.mjs`（50 行）：`multiplicity = single|list|keyed`、`scope = project|entry|session`；`chain` 登记未采用、写入即拒；`keyed` 必填 `keyField`，非 keyed 写 `keyField` 也拒；@4 缺省归一 single／project。
   - 资源认领 `carrierManifest.claims.mjs`（147 行）：`claims` 项目内相对 glob（禁绝对／盘符／反斜杠／`.`／`..`／隐藏段／`.pinax`；长度、字符集、`**` 独占段），上限 64 条 / 200 字；`priority` 0–100；`canOpen = { field, equals|in }` 声明式谓词（未知键、函数、二选一越界都拒）；`takes = extension|fallback`，`builtin` 宿主保留；priority／canOpen／takes 离开 claims 即死声明。
   - 渲染器注册 `carrierManifest.previews.mjs`（91 行）：`preview.register` 最多 16 条，扩展名小写带点且清单内不得重复认领，`loading = text-pages|bytes-complete`（批次55 直接消费），`maxBytes` 1 字节–64 MiB（`PREVIEW_MAX_BYTES_MAX` 常量家族）。
   - 合同上界与 license `carrierManifest.contract.mjs`（101 行）：`maxKernel` 与 minKernel 成对，缺省＝不设上界；粒度 major.minor（patch 不参与）；`license = { mode: free|subscription|buyout, agreement?, version? }`，agreement 走插件相对路径且只认 .md/.txt，version 须 x.y.z；豁免机制不做（登记未采用）。
   - 公共小件 `carrierManifest.shared.mjs`（50 行）：`isPlainObject`、`validatePluginRelativePath`、`isPredicateScalar`（claims 与 license 共用同一份路径纪律）。
3. **`services.adopt`**（`carrierManifest.mjs` 校验 + `serviceSupervisor.mjs` 439 行）：`adopt:true` 时 command／args／env／cwd 全禁、`port+healthPath` 必填、`restart` 只能 never／缺省；监督器只探活与状态灯（`publicStatus.adopt`，pid 恒为 null），不 spawn、不重启；端口不通如实 `unhealthy`，缺 port 直接 `failed`。
4. **doctor 六态**：新增 `adopted-external`（合法清单、外部服务自管，不是故障，CLI 退出码 0）；内核诊断改区间（min/max，major.minor），上界低于宿主时文案点名 `maxKernel`；新增四个宿主读取点：`pane-multiplicity`（含 multiplicity／scope／keyField 摊开）、`claims`（claims／priority／canOpen／takes）、`preview`（loading／maxBytes）、`license`、`adopt`；`single` pane 在工作区 >1 实例 → `incompatible-form`，不静默复用。
5. **@4 全字段夹具** `next/testing/fixtures/carrierV4.mjs`（99 行）：三块 pane 分别 single／keyed／list，keyed 认领两类资源，preview 两档 loading，maxKernel＋license＋adopt 各一处。
6. **测试**：`carrier-v4-manifest.test.mjs`（14 条：spec／12 清单零误拒／夹具归一／四组非法输入／license／adopt／V4_ONLY_*／反向读取点／single 多实例／描述符）＋`carrier-v4-adopt-supervisor.test.mjs`（4 条：真 http 探活、端口不通、缺 port、清单校验）。
7. **门禁同步**：acceptance +2 条记录（@4 零误拒、adopt 不 spawn）；bundleAssertions 新增守卫 q（@4／maxKernel／预览两档／adopt 失败文案共 6 个产物标记）。

## 验收

- `npm run verify:next` **五段全绿，exit 0**（本机 D:\Pinax-main\Pinax-main）。
- acceptance：**26/26**（原 24，+2，均为批次52）。
- node tests：**594/594**（原 576，+18：schema 14 ＋ adopt 监督器 4）。
- vitest shell UI：**186/186**（13 files，未变）。
- eslint：0 error／0 warning。
- bundleAssertions：全过；新增 q 6/6 标记齐；主进程 bundle 1779.7 kB（< 6 MB），外壳 2054.5 kB（< 2.5 MB，未变）。

## 计数变化与理由

| 位置 | 变化 | 理由 |
|---|---|---|
| acceptance 记录数 | 24 → 26 | +@4 零误拒回归闸（12 份现有清单必须原样通过新校验器）；+adopt 不 spawn（验收链锁住外部服务正身）。既有工具面计数 40／46／23 不变——本批不动载体工具。 |
| node tests | 576 → 594 | 新增两个 v4 测试文件共 18 条；无既有用例删改（doctor 用例只同步六态与描述符白名单）。 |
| bundleAssertions | +q | 证明 @4 词表、maxKernel、预览 loading 两档与 adopt 失败文案真的进产物——字段不是死声明。 |
| doctor 态 | 5 → 6 | +`adopted-external`；这是事实态不是错误态，CLI 退出码 0。 |

## 守卫标记对照

- `V4_ONLY_FIELDS` 含七字段：multiplicity／scope／keyField／claims／priority／canOpen／takes；另分 `V4_ONLY_TOP_FIELDS`（maxKernel／license／preview）与 `V4_ONLY_SERVICE_FIELDS`（adopt）。@1/@2/@3 任一位置写新字段均拒装，错误文案指向 @4。
- `preview.register` 词表：`PREVIEW_LOADING_MODES = text-pages|bytes-complete`、`PREVIEW_MAX_BYTES_MAX = 64 MiB`。
- license 枚举：`LICENSE_MODES = free|subscription|buyout`；agreement 只认 .md/.txt。
- adopt 不 spawn 断言：`carrier-v4-adopt-supervisor.test.mjs` 全程 `spawnImpl` 计数为 0；acceptance 第 26 条同口径。

## 两项登记（不动代码）

1. **server/mcp 的 `PROJECT_SPEC='pinax-project@1'` 与 Next @3/@4 互不认账**：修法涉及 `server/**`，待作者单独授权后另立小批（本批禁止改 server）。
2. **外部插件目录发现（pluginDirs 扫描）**：依赖 v3.1 跨板授权与 trustMode 讨论，登记不排期。

## 已知边界 / limitations

1. **`pluginRegistry.mjs` 不在本批允许文件内**，因此新字段的宿主读取点落在「校验器归一 + doctor 诊断 + supervisor 状态面 + 测试断言」，注册表 `activate()` 仍按原样把 pane 字段展开（展开是浅拷贝，@4 pane 字段会随之出去）。claims 争用／scope 实例语义的**真正裁决**归批次53——本批只收口协议与读取点。
2. **批次53 之前 12 份清单仍是 @3**：`preview.loading` 的消费（批次55）与 license 的展示／鉴权（批次54）本批不实现，只保证声明被校验且被诊断读出。
3. **doctor 的 workspace 参数**接受实例 id 数组／实例记录数组／`{ entries }` 快照，但外壳运行时尚未把真实工作区快照传进 doctor（外壳文件不在允许范围）；主机侧读取点已就绪，接线待后续批。
4. **@4 老服务归一**：`adopt:false` 不写入归一结果（避免既有 deep-equal 变化）；`maxKernel/preview/license` 在 @1–@3 归一结果里显式为 null（内部读侧，不影响磁盘清单）。
5. **豁免机制未做**：maxKernel 没有 `except` 一类口子，按工单登记未采用；如果将来内核合同升到 2，老 @4 清单需显式写 maxKernel≥2 才能装。
6. 未运行 git 命令、未启动/杀 electron；不触碰 `server/**`、`src/**`、老 web 轨。

## §8 调度方验收（Zcode）

- 门禁独立复跑 exit 0（五段全绿）；抽查证实：V4_ONLY_FIELDS/V4_ONLY_TOP_FIELDS 双组拒装、adopt「外部进程宿主不启动」进监督器与用户可见文案、license 校验进 contract、**12 清单零误拒专项用例在**（major.minor 收紧不咬老清单）、carrierManifest 超 1400 行触发拆分（contract.mjs）。
- 评审 1 条＝信息项（漂移归属再证，mtime 分桶 80 文件同一秒批量落盘 vs 本批窗口 7 文件恰为允许清单）。
- 真实改动 17 文件 +1563/−101 零行尾翻转；执行方记录自落盘（新规）本批起生效。
- 两项登记在案：server/mcp PROJECT_SPEC 与 @3/@4 互不认账（待作者授权单独小批）；外部插件目录发现（登记不排期）。

## 复现

```bash
cd D:/Pinax-main/Pinax-main
node --test next/tests/carrier-v4-manifest.test.mjs next/tests/carrier-v4-adopt-supervisor.test.mjs
npm run verify:next
```
