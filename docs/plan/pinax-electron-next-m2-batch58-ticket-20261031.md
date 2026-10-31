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

（同前几张工单格式；门禁计数变化必须写理由；§8 由调度方填。）
