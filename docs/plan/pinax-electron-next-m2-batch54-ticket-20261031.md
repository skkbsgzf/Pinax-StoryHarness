# 批次54 工单：配置分层与 volatile——改端口不动插件文件（Cordis 线B·运维收益）（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 前置：批次55 已收口（tip `59bcbdc`）。工单源：roadmap §7，实质任务不改；**两级层叠**（清单默认 → 工程覆盖），不引入 Cordis 四级层叠（我们没有 profile 概念，层叠越深 doctor 越说不清一个端口是谁定的）。

## 任务（四条）

1. **工程级覆盖文件 `.pinax/carrier-overrides.json`**（照 workspaceStore/settingsStore 模式新写 `next/carrierOverridesStore.mjs`）：形状 `{ version:1, overrides:{ <pluginId>:{ <paneId|serviceId|settingId>: 值 } } }`；tmp＋原子 rename；内容不变不写盘；坏文件回空记账。**合并序＝清单默认 → 工程覆盖**（后写胜，仅两级）；覆盖命中时 `serviceLogPool` 记一条 `info`（「端口 X 被工程覆盖改成了 Y」）便于溯源。
2. **消费点接线**：服务的 port/healthPath/args、pane 的 app.url、settings 的默认值——运行时读取处合并覆盖（supervisor 的服务清单装配处、ExternalAppHost 的 url 解析处、settingsStore 读值处）；**只覆盖值，不覆盖声明**（清单还是能力的唯一权威，adopt 模式等结构性字段不可覆盖）。
3. **volatile 语义**：@4 settings 声明支持 `volatile: true`（可 GUI 写）——**仅 volatile 字段在设置面可写**，非 volatile 的只读展示；与批次45 的 `.pinax/settings.json` 命名空间合流（GUI 写的仍落 settings.json，覆盖文件管的是「默认值改写」，两层各管各的并在 doctor 里说得清来源）。
4. **min/max/step 白名单放开**（批次49 潜伏能力收编）：`carrierManifest.validateSettings` 放行 number 型的 min/max/step 字段；通用渲染器（批次45 CarrierSettingsGeneric）按声明渲染约束；越界值写入口拒绝。
5. **`--dump-settings-schema`**（主进程 CLI 参数，离线诊断用不进运行时路径）：组合默认＋覆盖后输出 JSON Schema 到 stdout。

## 允许文件

`next/carrierOverridesStore.mjs`（新）、`next/kernel/carrierManifest.mjs`（volatile/min/max/step 校验扩展）、`next/runtime/serviceSupervisor.mjs`（装配处合并覆盖，spawn/退避语义不动）、`next/shell/ExternalAppHost.vue`（url 合并）、`next/runtime/settingsStore.mjs` 或所在文件（读值合并）、`next/shell/settings/CarrierSettingsGeneric.vue`（min/max/step 控件约束）、`next/shell/main.mjs`（CLI 参数＋接线）、`next/shell/ipcContract.mjs`（如需）、`next/doctor.mjs`（来源层级诊断）、`next/tests/`＋受影响测试、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（计数写理由）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不改 `server/**`、`src/**`、外部三目录；不加 npm 依赖；**adopt 模式与清单结构性字段不可被覆盖**；不动写族/revision/拦截点语义；覆盖文件不含密钥类字段（env 值可覆盖但 AGENT.md 提醒敏感信息自担）；两级层封顶不做三四级；不起 Electron、不执行 git。

## 守卫标记

批次45–55 全清单继承；本批新守卫：`carrier-overrides.json` 字样只在 carrierOverridesStore 与其测试、合并序注释「默认→覆盖」在装配处、volatile 进 @4 settings 词表。

## 验收判据（完成定义）

`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段全绿；「改端口后重启服务，statusByCarrier 给出覆盖后端口且能说出来源层级」有用例；volatile 非 volatile 各有用例；min/max/step 越界拒有用例。

## 记账指标（不进闸）

覆盖命中次数（池 info 条数）；doctor 来源层级诊断样例。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch54-20261031.md`；§8 调度方补；diff 指引用临时索引法。）
