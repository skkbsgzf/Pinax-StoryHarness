# 批次52 工单：载体清单 @4 的 schema 与校验（协议一次收口）（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 前置：批次50/51/58 已收口（tip `24de507`）。工单源：roadmap §4（Cordis 线B），**加三个调度方增项**（license 牌／services adopt 模式／两项登记）。
> **协议口径（作者 v3 轮既定）**：本批只收口协议、不动 12 份载体清单（批次53 迁移）；@1/@2/@3 读侧兼容是硬要求；《大梦》工作副本不能读不动。
> 实拍依据：批次58 证明「一块载体两个中栏 pane 无切换入口」——槽语义四态（multiplicity/scope）就是回答它。

## 四组 Cordis 借鉴字段（roadmap §4.1 原样，含校验要点）

1. **槽语义**：`pane.multiplicity = single|list|keyed`（`chain` 登记未采用）＋`pane.scope = project|entry|session`；`keyed` 必须给 `pane.keyField`；`single` 却在工作区有 >1 实例 → doctor 报错不静默。
2. **资源认领与接管**：`pane.claims = ['世界书/**/*.md', …]`（glob，只许项目内相对路径，禁绝对与 `..`）＋`pane.priority = 0..100`＋`pane.canOpen = { field, equals|in }`（**声明式谓词，禁 JS**）；接管档 `pane.takes = 'extension'|'fallback'`（`builtin` 宿主保留）。校验器 `validateClaims` 照 `validateAppPane` 的「长度/字符集/协议白名单」三件套纪律。
3. **渲染器注册**：`preview.register = [{ id, extensions: ['.md','.txt'], priority, loading: 'text-pages'|'bytes-complete', maxBytes }]`——`loading` 档位是批次55 直接消费的合同；extensions 小写带点、maxBytes 上限沿用 `*_MAX` 常量家族。
4. **合同上界**：`maxKernel`（与 minKernel 成对才有效，缺省＝不设上界保持现状）＋比对粒度 major→`major.minor`；豁免机制不做（登记未采用）。**硬要求：12 份现有清单（minKernel:'1'）必须全部仍能装上，误拒即回归。**

## 调度方增项（同批收口，避免 52 之后重开协议波次）

5. **license 牌**（作者诉求3 收尾）：`license = { mode: 'free'|'subscription'|'buyout', agreement?: 相对 .md/.txt 路径, version?: semver }`——可选字段；mode 枚举校验；agreement 走插件相对路径纪律（复用 agentMd 的 validatePluginRelativePath）；本批只做声明与校验，**设置面展示与鉴权归批次54**（登记）。
6. **services adopt 模式**（三独立体端口管理正身，批次58 登记）：service 条目加 `adopt: true` 语义——**只探活/状态灯/池记账，不 spawn**；adopt:true 时 `command/args/env/cwd` 全可省、`port+healthPath` 必填；doctor 对 adopt 声明给独立诊断态（如 `adopted-external`）。测试：adopt 无 command 合法、无 port 拒、监督器不 spawn adopt 条目。
7. **两项登记（写进批次记录与本工单，不动代码）**：①server/mcp 的 `PROJECT_SPEC='pinax-project@1'` 与 Next @3/@4 的互不认账——修法（@3+ 读侧兼容）涉及 server/**，**待作者单独授权**另立小批；②外部插件目录发现（pluginDirs 扫描）——依赖 v3.1 跨板授权与 trustMode 讨论，登记不排期。

## 验收判据（完成定义）

- `npm run verify:next` 五段全绿；`@4` 进 `SUPPORTED_CARRIER_SPECS`，`CARRIER_SPEC` 指向 @4，**@1/@2/@3 仍可读**；12 份现有清单零误拒（专门用例）。
- 夹具出 `@4` 全字段样例；四组字段＋license＋adopt 各自非法输入 ≥3 条；「@3 清单写新字段必须被拒」（`V4_ONLY_FIELDS` 纪律，沿用 V3_ONLY_FIELDS 实现）。
- **反向断言**：本批声明的每个新字段都要有宿主侧读取点（读不到的字段先别进协议——防死字段）。
- acceptance/bundleAssertions 计数同步逐处写理由。
- `carrierManifest.mjs` 预计 +300~400 行：**超 1400 行先拆文件再收口**（词表与主入口留主文件，四组字段各进 `carrierManifest.claims.mjs` 等；禁止测试读私有函数）。

## 允许文件

`next/kernel/carrierManifest.mjs`（及拆出的 `carrierManifest.*.mjs`）、`next/kernel/capabilities.vocab.mjs`、`next/kernel/errors.mjs`（如需新码）、`next/doctor.mjs`、`next/host-descriptor.json`、`next/runtime/serviceSupervisor.mjs`（仅 adopt 分支：不 spawn）、`next/tests/carrier-v4-*.test.mjs`（新）＋受影响测试、`next/testing/fixtures/**`、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`、本工单 §7。

## 禁止边界

**不改 12 份载体清单**（批次53）；不改 `PANE_KIND_WORDS` 既有 14 值语义（只加）；不动外壳渲染层；不改写族/revision 语义；不改 `server/**`、`src/**`；不加 npm 依赖；不起 Electron、不执行 git。

## 守卫标记

批次45–51/58 全清单继承；本批新守卫：`V4_ONLY_FIELDS` 存在且含七字段（multiplicity/scope/keyField/claims/priority/canOpen/takes 按 pane 与顶层归属细分）、`preview.register` 词表、license 枚举、adopt 分支（监督器对 adopt 不 spawn 的断言）。

---

## §7 执行方回填

### 交付（详见 [批次记录](./pinax-electron-next-m2-batch52-20261031.md)）

- `carrierManifest.mjs` 1114 行（< 1400，未触发强制拆分红线），新增四模块：`carrierManifest.shared.mjs`／`paneSemantics.mjs`／`claims.mjs`／`previews.mjs`／`contract.mjs`。
- @4 合同：`SUPPORTED_CARRIER_SPECS` 含 @4、`CARRIER_SPEC=@4`、@1/@2/@3 读侧兼容；四组字段＋license＋adopt 全量校验；`V4_ONLY_FIELDS`（七 pane 字段）＋`V4_ONLY_TOP_FIELDS`（3）＋`V4_ONLY_SERVICE_FIELDS`（1）对老清单逐处拒装。
- doctor 六态（+`adopted-external`），读取点：pane-multiplicity（multiplicity/scope/keyField）、claims（claims/priority/canOpen/takes）、preview（loading/maxBytes）、license、adopt；single pane 多实例 → `incompatible-form`。
- `serviceSupervisor` adopt 分支：只探活、不 spawn、不重启；`publicStatus.adopt`、pid 恒 null；缺 port 直接 failed。
- 夹具 `next/testing/fixtures/carrierV4.mjs`；测试 `next/tests/carrier-v4-manifest.test.mjs`（14 条）＋`next/tests/carrier-v4-adopt-supervisor.test.mjs`（4 条）。
- 门禁：acceptance +2 条（@4 零误拒／adopt 不 spawn）；bundleAssertions +守卫 q（6 个产物标记）。

### 验收

- `npm run verify:next` **五段全绿，exit 0**。
- acceptance **26/26**；node tests **594/594**（+18）；vitest **186/186**；eslint 0；bundleAssertions 全过（q 6/6）。
- 12 份现有清单（@3 / minKernel:'1'）校验＋注册表双通道零误拒（专项用例与 acceptance 各一条）。

### 计数变化与理由

| 位置 | 变化 | 理由 |
|---|---|---|
| acceptance | 24 → 26 | @4 零误拒回归闸；adopt 不 spawn 验收锁。工具面 40/46/23 不变（本批不动载体工具）。 |
| node tests | 576 → 594 | 两个新 v4 测试文件 +18；既有用例仅 doctor 同步六态/描述符。 |
| bundleAssertions | +q | 证 @4 词表、maxKernel、预览两档 loading、adopt 失败文案进产物。 |

### 守卫标记对照

- `V4_ONLY_FIELDS` 七字段齐（multiplicity/scope/keyField/claims/priority/canOpen/takes），顶层与 service 另两组；老版本写新字段错误文案指向 @4。
- `preview.register`：`text-pages`／`bytes-complete`、扩展名小写带点、`PREVIEW_MAX_BYTES_MAX=64 MiB`。
- license：`free|subscription|buyout`，agreement .md/.txt。
- adopt 不 spawn：监督器测试断言 `spawnImpl` 调用数恒 0；acceptance 同口径。

### limitations

1. `pluginRegistry.mjs` 不在允许文件内：claims 争用／scope 实例的**真正裁决**归批次53；本批的读取点是校验器归一、doctor 诊断、supervisor 状态面与测试。
2. `preview.loading` 消费归批次55、license 展示/鉴权归批次54；本批只校验并让 doctor 读出。
3. doctor 的 `workspace` 入参已支持三种快照形状，但外壳尚未传真实工作区（外壳文件越界），接线待后续批。
4. 12 份清单仍 @3（批次53 迁移）；`maxKernel/preview/license` 在 @1–@3 归一结果中显式 null；adopt:false 不写入归一（避免既有 deep-equal 变化）。
5. maxKernel 不做豁免机制（按工单登记未采用）。
6. 两项登记：①server/mcp `pinax-project@1` 与 Next @3/@4 互不认账（待 server/** 单独授权）；②外部插件目录发现（依赖 v3.1 跨板授权/trustMode）。
7. 未执行 git、未起/杀 electron；未改 `server/**`、`src/**`、外壳渲染层、写族/revision。

## §8 调度方验收

（待调度方补。）
