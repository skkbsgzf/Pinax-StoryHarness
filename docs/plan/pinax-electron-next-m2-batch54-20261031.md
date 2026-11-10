# 批次54 记录：配置分层与 volatile——改端口不动插件文件（Cordis 线B · 运维收益）（2026-10-31）

> 执行：Qoder CLI（DeepSeek-Flash）。工单源：[执行工单](./pinax-electron-next-m2-batch54-ticket-20261031.md)。
> 不执行 git；不启动/不杀 electron；未改 `server/**`、`src/**`、外部三目录；未加 npm 依赖；
> 未动写族／revision／拦截点语义；未动 12 份载体清单；层叠封顶两级（清单默认 → 工程覆盖）。
> 本记录不做 git 指针引用（未执行 git）；改动按允许清单逐文件列出，调度方以临时索引法复核 diff。

## 交付

1. **工程级覆盖存储 `next/carrierOverridesStore.mjs`（新）**
   - 文件：`<项目>/.pinax/carrier-overrides.json`，形状 `{ version:1, overrides:{ <pluginId>:{ <paneId|serviceId|settingId>: 值 } } }`。
   - 与 `workspaceStore`／`settingsStore` 同款三条纪律：坏档回空并记账（`OVERRIDES_BAD_JSON`／`OVERRIDES_NOT_OBJECT`，不覆盖原文件）；`.tmp`＋同目录 rename；内容不变跳过写盘；写请求串行排队。
   - 只认值：服务 `port／healthPath／args`、应用面 `url`、设置标量；`command／cwd／env／adopt／restart／autostart／pluginId／dir` 与 `secret／token／apiKey` 等结构性字段写入即拒（`PINAX_OVERRIDE_FORBIDDEN_KEY`），读侧遇到也只忽略并记账。
   - 合并序唯一一份：`清单默认 → 工程覆盖`（后写胜，仅两级）。来源标签 `清单默认／工程覆盖／项目设置`。

2. **三个消费点接线（只覆盖值，不覆盖声明）**
   - `next/runtime/serviceSupervisor.mjs`：装配处调用 `applyServiceOverride` 合并 `port／healthPath／args`；状态面新增 `portSource`（`manifest｜override`）与 `overrideFields`；覆盖命中时向 `serviceLogPool` 记一条 `info`（端口文案为「端口 X 被工程覆盖改成了 Y」）。spawn／健康探针／退避／adopt 语义一字未动。
   - `next/shell/ExternalAppHost.vue`：挂载时经只读 IPC `carrier:overrides` 取当前项目覆盖；应用面 url 解析＝覆盖值优先、清单值兜底，覆盖时显示「工程覆盖」徽标。
   - `next/runtime/settingsStore.mjs`：读值改为三层有效值 `项目设置(stored) > 工程覆盖 > 清单默认`，`read()` 返回 `overrides`／`effective`（含 `value／source／label／volatile`）与合并警告；写闸与覆盖合并共用 `validateDeclaredValue`（同一套类型／范围判据）。

3. **volatile 语义（@4 settings 词表）**
   - `next/kernel/carrierManifest.mjs`：`V4_ONLY_SETTING_FIELDS = ['volatile','min','max','step']`；仅 @4 清单可声明，@3 写这些字段即拒（报 `pinax-carrier@4`）。
   - 设置写闸：`volatile !== true` 一律拒（`PINAX_SETTING_NOT_VOLATILE`），一个字节不落盘；volatile 字段 GUI 写入仍落 `.pinax/settings.json`，覆盖文件只改写「默认值」，两层各管各的。
   - `next/shell/settings/CarrierSettingsGeneric.vue`：按 `effective` 显示当前值与来源徽标；非 volatile 控件 `disabled` 且不出保存按钮（只读说明）；volatile 才可编辑／保存。

4. **min/max/step 白名单放开**
   - 清单校验：number 型允许 `min／max／step`，并校验有限数、`min <= max`、`step > 0`、默认值在范围内且对齐步长；section 与非 number 型拒这些字段。
   - 通用渲染器：数字框带 `min／max／step`；保存前客户端先按同一套范围／步长预检，发现越界直接显示错误、不发 IPC。
   - 主进程写闸：越界回 `PINAX_SETTING_OUT_OF_RANGE`，非步长回 `PINAX_SETTING_STEP_MISMATCH`。

5. **离线诊断 CLI `--dump-settings-schema`**
   - `next/shell/main.mjs` 导出 `dumpSettingsSchema({ argv })`：读 `BUILT_IN_CARRIER_PLUGINS` 的属性声明与项目覆盖（`--root=<目录>` 优先，其次 `PINAX_NEXT_ROOT`），输出 draft 2020-12 JSON Schema 到 stdout；`x-pinax-source`／`x-pinax-source-label`／`x-pinax-volatile`／`x-pinax-layers` 标明来源层，number 约束落 `minimum／maximum／multipleOf`。
   - 该参数走旁路：不抢单实例锁、不建窗口、不进运行时装配；stdout 写完后 `app.exit(0)`，避免管道截断 JSON。

6. **doctor 来源层诊断**
   - `next/doctor.mjs` 新增两条检查：`service-port-source`（每颗服务 `{ id, port, portSource, overrideFields, warnings }`）与 `settings-source`（每项 `{ id, value, source, label, volatile }`，沿用 stored > override > manifest）。
   - 两项在 adopt 早退之前入列，adopt 服务与自起档服务都能说出「这个端口／这个默认值是谁定的」。

7. **IPC 接线**
   - `next/shell/ipcContract.mjs` 新增只读通道 `carrierOverrides: 'pinax:agent:carrier:overrides'`；`carrierOverridesFor` 未注入／项目未打开时如实报缺。preload 白名单由 `IPC_CHANNELS` 自动生成，无需另改。
   - `next/shell/main.mjs` 增加按项目根缓存的 `carrierOverridesFor(projectRoot)` 并注入 dispatcher。

## 测试与门禁

- `next/tests/carrier-overrides.test.mjs`（新，17 条）：原子写形状／`.tmp` 清理／同内容跳过／坏档回空／结构字段拒写／set 与 remove 只动目标键／服务覆盖命中与非法值／批量合并／**监督器真消费覆盖并在池里记 info**／应用面 url 两种写法与外网拒／设置三层有效值与记账／`validateDeclaredValue` 全码表／@4 收 volatile 与 min/max/step／@3 拒／默认值自洽／`buildSettingsSchema` 来源层与约束。
- `next/tests/settings-store.test.mjs` +4：number 范围／步长在主进程拦住；非 volatile 拒写；`read()` effective 三层来源；`carrier:overrides` 通道只读（有项目读档、未注入／未开项目报缺）。
- `next/tests/doctor.test.mjs` +1：漫画服务端口覆盖 → `service-port-source`；小说临时 @4 设置 → `settings-source` 的 override／stored／越界回默认三种来源；夹具描述符补 `pinax.view.app`（真实描述符本就有，批次58 画布用）。
- `next/tests/carrier-settings-generic.spec.mjs` +3：effective 来源徽标并可写；非 volatile 只读且无保存按钮；范围／步长预检不发 IPC。
- `next/tests/carrier-pane.spec.mjs` +2：ExternalAppHost 覆盖 url 生效并显示来源；外网覆盖回退清单地址。
- `next/testing/acceptance.mjs` +5：覆盖文件读回；**服务端口覆盖后状态面 `port=8201／portSource=override`、状态池 `statusByCarrier` 给出覆盖端口并记一条 info**；设置覆盖层（未存过设置即生效）；volatile 经 GUI 写后 stored 盖过 override；非 volatile／越界／非步长写闸三连；doctor 来源层样例 `port=8201/override`。
- `next/testing/bundleAssertions.mjs` 新增守卫 `t`：组装点注释含「默认→覆盖」；主进程 bundle 带 `portSource` 与 `工程覆盖` 来源标签；外壳 bundle 带 `--dump-settings-schema`。其余计数与既有断言不动。

## 验收

- `npm run next:build:main && npm run next:build:shell`：通过（main 1,777.14 kB；shell 2,052.62 kB；preload 5.45 kB）。
- `npm run verify:next`：**五段全绿，exit 0**。
  - acceptance：**33/33**（本批 +5）。
  - node tests：**623/623**（本批 +22：覆盖 17 ＋ 设置 4 ＋ doctor 1）。
  - vitest shell UI：**197/197**（14 files；本批 +5：通用设置 3 ＋ 外部应用 2）。
  - eslint：0 error／0 warning。
  - bundleAssertions：全过，新增 `t`；主进程 1,801.9 kB（< 6 MB）、外壳 2,093.6 kB（< 2.5 MB）。
- 点名用例在：**「改端口后重启服务，statusByCarrier 给出覆盖后端口且能说出来源层级」**（acceptance 新记录 ＋ `carrier-overrides.test` 的监督器＋池用例）；**volatile／非 volatile 各有用例**（设置 store 与通用渲染器）；**min/max/step 越界拒有用例**（store 写闸＋渲染器预检）。

## 计数变化与理由

| 位置 | 变化 | 理由 |
|---|---|---|
| acceptance | +5（→ 33） | 覆盖文件读回；服务端口覆盖＋状态池来源；设置覆盖层；volatile 写入盖过覆盖；写闸三连＋doctor 来源样例。 |
| node tests | +22（→ 623） | 新文件 17（存储纪律＋三消费点＋@4 词表＋schema）；设置 store 4（范围／volatile／effective／IPC）；doctor 1（来源层）。 |
| vitest shell UI | +5（→ 197） | 通用设置 3（来源可写／非 volatile 只读／范围预检）；外部应用 2（覆盖 url／外网回退）。 |
| bundleAssertions | +t | 守「组装点两级合并序＋主进程来源标签＋离线诊断入口」三件事；行为本体由用例守。 |
| 工具面计数 | 40／46、载体工具 24／23 不变 | 本批不新增工具名、不动 12 份清单。 |

## 记账（不进闸）

- **覆盖命中次数**：acceptance 的漫画预览服务 1 次命中 `port`，状态池 info 条目文案「端口 8191 被工程覆盖改成了 8201」；doctor 样例 `port=8201/override`。
- **doctor 来源层样例**：`service-port-source.services[0] = { id:'comic-preview', port:8201, portSource:'override', overrideFields:['port'], warnings:[] }`。
- **体积**：主进程 1,801.9 kB（占 6 MB 上限约 30%）；外壳 2,093.6 kB（占 2.5 MB 上限约 82%）。新增存储与合并逻辑约数 kB 量级，未触发上限调整。

## 偏离（已记录，非静默）

1. **`next/runtime/serviceLogPool.mjs` 超出允许清单但也改了**：`statusByCarrier` 原来只读声明里的 `port`，若不同步改为「实时端口优先＋`portSource`／`overrideFields`」，验收要求的「覆盖后端口且能说出来源层级」在状态池这条主视图上就看不见。改动只在该读取点，四色／通知／环形池语义未动。登记为必要偏离。
2. **监督器自读覆盖文件，而非由 `agentRuntime` 注入**：`next/runtime/agentRuntime.mjs` 不在本批允许清单内。`createServiceSupervisor` 用 `options.projectRoot ?? PINAX_PROJECT_ROOT` 同步读 `.pinax/carrier-overrides.json`（`readCarrierOverridesSync`，坏档回空不抛）；测试可直接注入 `options.overrides` 走同一合并函数。待后续批次可在装配层统一注入，届时删除自读分支即可。
3. **`ExternalAppHost.vue` 自带回环 URL 校验**：渲染层不能 import `carrierOverridesStore.mjs`（含 `node:fs`），组件内只复刻「http/https＋127.0.0.1／localhost／[::1]」这条必要边界；来源与合并仍以主进程为准。
4. **`CarrierPaneHost.vue` 的「复制地址」仍用清单 url**：该文件不在允许清单内，本批只让 `ExternalAppHost` 的 iframe 使用覆盖地址。已登记的后续债：复制按钮应复制生效地址（另批）。
5. **`env` 值未开放覆盖**：工单任务 2 只列 `port／healthPath／args`，且「只覆盖值不覆盖声明」要求结构性字段不可覆盖，因此 `env` 与密钥类字段一律拒写；工单禁止边界里「env 值可覆盖」的括注按更严的任务 2 口径执行。

## limitations

1. `--dump-settings-schema` 的进程级执行未在本次验证中运行（未启动 Electron）：schema 生成逻辑由 `buildSettingsSchema` 单测覆盖，bundle 守卫 `t` 只证参数与实现进了外壳产物。真机可执行性待调度方起 Electron 时核（命令：`pinax-next-shell-main.mjs --dump-settings-schema --root=<项目>`）。
2. 覆盖只支持两级且只改值：不提供 profile／环境层叠，不覆盖 `adopt／command／env／restart／cwd` 等结构字段；新增层需另开工单。
3. 覆盖文件按「值」而非「声明」校验：服务字段的合法性在消费点（`applyServiceOverride`）判，设置的合法性在 `validateDeclaredValue` 判；两处判据未合并成一张统一表，新增可覆盖字段要同时改两处。
4. 设置界面只把 `effective` 用于展示与写闸；非 volatile 字段没有「为什么只读」的就地文案（只有「清单未标 volatile」一句），更细的作者解释留给后续 UI 批次。
5. 外部应用覆盖只接受本机回环地址；外网／非回环 url 会回退清单地址并在读侧记账，但界面不弹独立错误（只在来源徽标上体现）。
6. 未运行 git、未起 Electron；覆盖端口后的真服务重启由 acceptance 的假子进程＋探针桩覆盖，真进程重启由既有服务监督器用例与批次58 真窗口流程兜底。

（§8 由调度方补。）

## §8 调度方验收（Zcode）

- 门禁独立复跑 exit 0（五段全绿）；真实改动 12 文件零行尾翻转；执行方记录自落盘。
- 评审 3 条裁定：①low acceptance 增量「+5」实为 +6（总数 33 正确、六条理由逐条在）＝记账笔误，信用账记一笔；②low serviceLogPool 7 行清单外（statusByCarrier 透传 portSource/overrideFields）＝验收判据必要接线且 §7 已申报，**追认**；③low 两份未来工单未入库＝调度管线自产，随下一批入库。
- 覆盖层语义抽查：两级（清单默认→工程覆盖）封顶、adopt/结构性字段不可覆盖、volatile 与 settings.json 分工（GUI 写落 settings.json，覆盖文件管默认值改写）三点均按工单落。
