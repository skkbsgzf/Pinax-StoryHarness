# 批次58 工单 v2：三独立体接入底座——画布承载＋提交闸收口（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（模型派发时定）。
> **架构裁定（作者 2026-10-31 纠正）**：toonflow、ComfyUI、资产管理（素材）载体是**三个独立运行体，各自接入 Pinax 底座**——底座负责端口管理（监督/健康/日志/状态灯）与承载（app 档）。**CF2TF 不是目标产品形态，只是过渡层参考**：其 SPEC（`D:\CF2TF\SPEC.md`）十条红线是将来**底座自建出图管线**的设计输入，不是要内置的中间件。本批不预声明 CF2TF MCP。
> 外部事实：`D:\ComfyUI-0.39\run-8188.bat`（作者单实例启动器，:8188 常在跑）；`D:\toonflow`（Bun workspace，dev=web+server watch，画布 :3010；当前未运行）。

## 任务

1. **app 档承载画布**（独立体① toonflow 的接入面）：comic manifest panes 加 `{ slot:'center', id:'comic.canvas', title:'Toonflow 画布', icon:'comics', view:'pinax.view.app', kind:'external-app', app:{ url:'http://127.0.0.1:3010' }, forms:['dock','split','fullscreen','immersive'] }`——ExternalAppHost 承载（批次44 iframe＋人话失败文案现成）；toonflow 没起＝「先确认那个端口的服务起没起」，另给「复制地址单开」。不 spawn toonflow（它由作者自己的 dev 流程管）。
2. **提交闸收口**（独立体② ComfyUI 的纪律面）：comic manifest `mcp[comfy].allow` 摘除 `'comfy_submit'`——allow 白名单外＝不进聚合面。理由措辞按新架构写：**提交通路纪律归底座**（CF2TF 红线1 的教训——多提交方抢串行队列＝雪崩），底座自己的提交闸（单提交点 gate，吸收 CF2TF SPEC §1.1 设计）未建之前，Pinax 侧不开第二个直连 ComfyUI 的提交口；桥代码与 `comfy_status/comfy_result` 保留（探活与收结果只读）。
3. **AGENT.md 架构说明**：三独立体各是什么、接入面各在哪（画布＝app 档 :3010；引擎＝mcp 桥只读探活 :8188；资产＝素材/漫画载体自带工具）；CF2TF 的过渡定位一句话；「提交闸归底座，未建前 comfy_submit 停用，恢复条件＝底座提交闸落地」。
4. **测试**：allow 摘除后披露面断言（comfy_submit 不在 ListTools、comfy_status/result 在）；app 档 pane 校验（回环过/外网拒，validateAppPane 既有）；`comfy_submit` 全仓工具面零命中 grep 进测试。
5. **acceptance/bundleAssertions 计数同步**（工具面 −1＋新 pane），写理由。

## 登记归位（本批不做，写进 AGENT.md 与批次记录）

- **services 牌 adopt 模式**（「只探活/状态灯/池记账，不 spawn」——外部独立运行体的端口管理正身）→ **批次52 @4 收口**时随 services 词表扩展落地；落地后 comic/资产载体以 adopt 声明 comfyui(8188, healthPath /system_stats)＋toonflow(3010)，四色状态点对三个独立体全亮。
- **底座出图管线设计批**（吸收 CF2TF SPEC 全部十条红线：单提交点 queue gate、超时必 interrupt、h264 收割、上传器唯一实现）→ 另立项待作者点头；立项前 CF2TF 维持作者现状使用，与 Pinax 互不干扰。

## 允许文件清单

`next/carriers/comic/manifest.mjs`、`next/carriers/comic/AGENT.md`、`next/shell/CarrierPaneHost.vue`（如画布 pane 需要标题行动作，最小改动）、`next/shell/styles/next-shell.css`（如需）、`next/tests/`、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（计数，写理由）、本工单 §7。

## 禁止边界

1. 不改 `server/**`、`src/**`、`D:\CF2TF`、`D:\toonflow`、`D:\ComfyUI-0.39` 任何文件；不加 npm 依赖。
2. 不新开任何直连 ComfyUI 的提交通路；comfy_submit 不许以任何形式回工具面；**不预声明 CF2TF MCP**（过渡参考不进协议）。
3. 不动清单 schema（@4 与 adopt 模式归批次52）；不起/不杀 toonflow、ComfyUI、electron 进程；不执行 git 命令。

## 守卫标记

批次45–50 全清单继承（含 EXTERNAL_WRITE_HINT 单引用点）；本批新守卫：comic manifest `mcp[comfy].allow` 恰为 `['comfy_status','comfy_result']`、comic.canvas app 档 pane 存在、`comfy_submit` 工具面零命中。

## 验收判据（完成定义）

`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段全绿；真窗口（调度方）：画布 pane 人话态（toonflow 未起）／起 toonflow 后 iframe 承载；Agent 卡工具面计数与 §7 一致。

---

## §7 执行方回填 ／ §8 调度方验收

### §7 执行方回填（Qoder CLI · 2026-10-31）

**架构落点**：三独立体各自接入底座，本批只做「承载」与「纪律收口」，不 spawn、不内置中间件。

#### 改动清单

1. `next/carriers/comic/manifest.mjs`
   - panes 增 `comic.canvas`：`slot:'center'`、`view:'pinax.view.app'`、`kind:'external-app'`、
     `app.url:'http://127.0.0.1:3010'`、`forms:['dock','split','fullscreen','immersive']`，
     标题「Toonflow 画布」。
   - `mcp[comfy].allow` 摘除 `comfy_submit`，恰为 `['comfy_status','comfy_result']`；
     桥脚本与 `comfy_submit` 实现保留（只读探活／收结果仍走桥）。
   - 版本 `1.2.0 → 1.3.0`；头注释与 mcp 注释改写为「提交闸归底座」的纪律口径。
2. `next/carriers/comic/AGENT.md`
   - 新增「三个独立体，三个接入面」表：画布（toonflow :3010，app 档）／引擎（ComfyUI :8188，mcp 只读）／
     资产（素材＋漫画记录族工具）；画布、引擎的人话失败文案与「复制地址单开」写清。
   - 明写 **comfy_submit 停用**、理由（多提交方抢串行队列＝雪崩，CF2TF SPEC §1.1 教训）与
     **恢复条件＝底座提交闸落地**；CF2TF 过渡定位一句话；adopt 模式（批次52 @4）与底座出图管线设计批的登记项。
3. `next/shell/CarrierPaneHost.vue`（允许清单内的最小改动）
   - 外部应用分支包一层 `.nx-app-pane`，底部 quiet 行给「复制地址单开」（`data-test="app-copy-url"`），
     剪贴板不可用时如实提示「复制失败，请手动选中地址」；未改 ExternalAppHost（不在允许清单）。
4. 测试
   - `next/tests/comic-carrier-wiring.test.mjs`：聚合面只认 `comfy_status`／`comfy_result`，
     `comfy.comfy_submit` 断言不在面；新增清单守卫（allow 恰为只读两把、`comic.canvas` 四形态与回环地址、
     全十二块载体 `tools`／`mcp.allow` 零 `comfy_submit`）。
   - `next/tests/carrier-records.test.mjs`：comic 期望 pane 增 `comic.canvas`；工具面 47→46（理由见下）。
   - `next/tests/carrier-v3-rollout.test.mjs`：`external-app` 与 `custom-panel` 同理不受「kind 不许变」约束，
     单独登记并断言全仓应用面恰为 `pinax.carrier.comic/comic.canvas`、view／kind／回环地址正确。
   - `next/tests/doctor.test.mjs`：记录型载体「不许沉浸」的断言给 app 档 pane 放行（仅 `comic.canvas`），
     其余记录面照旧不许沉浸。
   - `next/tests/carrier-pane.spec.mjs`：应用面须有「复制地址单开」；新增点击复制用例（剪贴板拿到 :3010）。
5. `next/testing/acceptance.mjs`：聚合工具面 47→46、comfy 名字三把→两把；新增「画布接入面」一条验收
   （app 档／回环 :3010／allow 只读两把／面上无 submit）。验收条数 23→24。
6. `next/testing/bundleAssertions.mjs`：新增门禁 p1（allow 恰为只读两把＋全载体工具面零 submit）、
   p2（`comic.canvas` app 档 pane 与地址），理由写在门禁注释里。
7. 本工单 §7。

#### 门禁计数变化（必须写理由）

| 计数 | 变化 | 理由 |
| --- | --- | --- |
| 聚合工具面（M4/M5 项目） | 47 → 46 | `mcp[comfy].allow` 摘除 `comfy_submit`：底座提交闸未建，不开第二个直连提交口。外部 MCP 3 把 → 2 把；桥实现与协议测试不变。 |
| 载体 pane 数（comic） | 2 → 3 | 新增 `comic.canvas`（独立体①画布的 app 档承载面）。全仓应用面仍只有这一块、自带面板仍只有素材一块。 |
| acceptance 条数 | 23 → 24 | 新增画布接入面验收一条。 |
| 原生面（d2／M1） | 21 不变 | 本批不动内核原生工具。 |

#### 验证结果（本机，2026-10-31）

- `npm run next:build:main` ✅（`next/.build/pinax-next-main.mjs` 1,736.12 kB）
- `npm run next:build:shell` ✅（外壳 1,997.64 kB；preload 5.30 kB）
- `npm run verify:next` ✅ 五段全绿：
  1. acceptance：24/24 通过（含新增画布接入面）
  2. `node --test next/tests/*.test.mjs`：576 tests / 576 pass / 0 fail
  3. vitest shell：13 files / 186 tests 全过
  4. `lint:next`：0 警告
  5. bundleAssertions：全过，含 p1 `allow=comfy_status,comfy_result submitOnSurface=false`、
     p2 `pinax.view.app/external-app http://127.0.0.1:3010`

#### 边界与限制（如实登记）

1. **画布当前从「打开方式 → 沉浸」进入**：宿主 `AppNext.vue` 的 `formTargetsForBoard` 每个形态取该板第一块
   center pane，`comic.editor` 先认领 dock／split／fullscreen，`comic.canvas` 只拿到 immersive（其声明四形态齐备）。
   `AppNext.vue` 不在本工单允许文件清单内，故不改宿主菜单的 pane 分配。真窗口验收可用沉浸形态；
   后续若要让画布直接停靠，需宿主支持多 center pane 选择器（另立小批）。
2. **toonflow 未起时的人话态沿用批次44**：ExternalAppHost 的失败文案由 iframe 的 `error` 事件触发；
   Electron 对跨源失败不一定派发该事件，可能出现「空白 iframe 而无提示」。本批未改 ExternalAppHost（不在允许清单），
   只补了「复制地址单开」这条兜底路径。调度方真窗口若见空白，请按此边界登记，不视为本批回归。
3. 未 spawn／kill toonflow、ComfyUI、electron；未执行 git；未改 `server/**`、`src/**`、`D:\CF2TF`、
   `D:\toonflow`、`D:\ComfyUI-0.39`；未新增 npm 依赖；未动清单 schema @4 与 adopt 模式（批次52）。

---

§8 调度方验收（待填）

