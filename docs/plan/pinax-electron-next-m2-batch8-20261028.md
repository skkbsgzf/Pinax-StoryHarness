# Pinax-Electron-Next M2 批次8：偏好与模型面板（死菜单收口）＋ 模型面三态分开报（2026-10-28）

> 作者裁定「可以」后继续批次 8①（也是作者自己排的下一批第一位）：把 `设置 → 偏好与模型…` 从死菜单做活，
> 顺带收掉批次 8④（「模型面不可达」和「可达但没配模型」分开报错）。
> 上承[批次7](./pinax-electron-next-m2-batch7-20261028.md)；功能定位见[功能盘点](./pinax-electron-next-frontend-inventory-20261028.md) §2.8。

## 1. 交付了什么

**偏好存储（`next/runtime/appPreferences.mjs`，新）**
- 应用级 JSON（`<PINAX_APP_DATA|userData>/next-preferences.json`），原子写复用 `fs/atomicWrite`。
- 字段合同（写进单测）：`modelPlaneEndpoint`（null＝默认 8451，或 http(s)://…，尾部斜杠归一）、`uiZoom`（null＝默认 0.85，或 0.5–2.0）。
- 损坏/缺失文件按默认值继续——偏好坏了不拦作者进应用；非法值打回且不落盘。

**网关运行时端点（`server/services/kitModelGateway.js`，共享文件的最小改动）**
- `TASK_PLANE_ENDPOINT` const→let，新增 `setTaskPlaneEndpoint(null|url)`（null＝回默认来源，改完作废可用性缓存）与 `getTaskPlaneEndpoint()`。
- env `PINAX_ADAPTER_ENDPOINT` 的最高优先语义不变（门禁 j 的正则原文仍匹配）；这是该共享文件唯一的行为级改动。

**模型面三态探测（`next/runtime/modelPlaneProbe.mjs`，新）**
- 探任务面 `GET /model`（与 kitFunnelAvailable 同端点同 2.5s 口径）：`ready`／`no-model`（应答体明确声明没配模型：model 空、configured=false、models 空才判）／`unreachable`。
- 同时包住 `applyModelPlaneEndpoint`——**外壳 main.mjs 不得直接 import server/**（渲染侧依赖薄守卫，批次8 实测踩红后把端点所有权收进 runtime 层）。

**IPC 合同（`next/shell/ipcContract.mjs`）**
- 新通道 `prefs:get`／`prefs:set`／`prefs:probe-model-plane`（仍全在 `pinax:agent:` 命名空间，应用级、不要求项目已打开）。
- 分发器 deps 扩展：`prefs`（不注入如实报缺）、`onPrefsApplied`（落盘后生效钩子）、`probeModelPlane`。

**外壳接线（`next/shell/main.mjs`）**
- 启动即读偏好：已存端点→`applyModelPlaneEndpoint`，已存缩放→窗口 `zoomFactor`（优先级：env `PINAX_NEXT_ZOOM` > 偏好 > 0.85）。
- 保存即生效：`onPrefsApplied` 里端点改网关（无需重启）、缩放改当前窗口（`setZoomFactor`，无需重开）。

**偏好面板（`next/shell/AppNext.vue`）**
- 菜单 `设置 → 偏好与模型…` 第一次有了落点：`menuInvoked` 事件打开 col-center 内的偏好 section（与主载体向导同形态）。
- 字段：模型面端点（留空＝默认）＋「检测模型面」按钮＋三态结果条（ready 青绿／no-model 琥珀／unreachable 红，全 token）＋界面缩放（0.5–2.0）＋保存并生效/关闭。
- 样式全走共享词汇与刻度（`.wizard`/`.nx-field`/`.control-*`/`--nx-fs-md`/`--radius-control`），视觉合同零新增豁免。
- 密钥安全边界写进面板文案：凭据仍由任务面持有，Next 只管「端点指到哪」。

## 2. 门禁

`verify:next` 五段全绿：验收 16/16、内核单测 **129/129**（＋7：偏好存储 5、分发器偏好通道、主进程接线断言）、外壳界面测 **29/29**（＋2：菜单打开面板字段来自 prefsGet；检测/保存走合同通道且三态如实渲染）、eslint 0 警、打包门禁 a–k 全过（主 860.9 kB、渲染 297.3 kB、CSS 87.4 kB、preload 1.8 kB）。

排障账：①外壳源码「依赖薄」守卫拦下了 main.mjs 直引 server/ 网关——端点 setter 的所有权收进 runtime 层（modelPlaneProbe 与 probe 同址），守卫该红就得红；②`normalizePrefs` 对非对象输入按空补全返回默认（损坏偏好继续跑的既定语义），第一版单测断言写反已修；③Electron 42 的 Menu 没有 `clickMenuItem`，截图脚本改用 `getMenuItemById(...).click()`。

## 3. 截图证据

真窗口（Playwright `_electron.launch`，隔离演示项目 + 隔离 appdata）：
- `png/06-light-prefs.png` 浅色·偏好面板（真菜单路径 `getMenuItemById('settings.preferences').click()` 打开）
- `png/07-light-prefs-probe.png` 检测结果：红色「模型面不可达：http://127.0.0.1:8451（fetch failed）。请启动 pi-agent 任务面（serve:pinax）或修改端点。」——本沙箱无任务面，如实报不可达
- `png/08-dark-prefs.png` 深色·偏好面板
- 捕获脚本同前：`D:\Pinax-e2e\next-batch7-shots\capture.mjs`

## 4. 诚实边界

- 「可达但未配模型」（no-model）只在任务面 `/model` 应答体**明确声明**没配时给出——任务面应答契约未逐字段取证（内核在 pinned 仓库），读不出就如实给 ready，不猜。
- 检测是即时探测（2.5s 超时），不是常驻健康监视；右栏没有加状态 chip（避免把开发者向事实摆回面上——批次6 刚清过）。
- 模型凭据仍归任务面持有：作者要在任务面侧选模型，偏好面只管端点与观感。Next 自管密钥不在本批范围。
- 首屏「开哪块板」仍随主载体默认 pane（未做持久化选择）；`settings.preferences` 之外的设置项（语言/备份等）未进本面板。
- 未做真实模型调用（本沙箱无任务面）；三态里的 no-model 分支靠约定字段与单测，真任务面实测待作者环境。
