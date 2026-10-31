# 批次48 记录：标杆2 骨架——comic 载体四张牌真用＋ComfyUI MCP 桥＋夹具验证（2026-10-31）

> 执行两段：DeepSeek-Flash 跑至约 90% 由调度方主动中止（等待超时裁定，非质量问题，15 文件半成品留树）；按作者指令改派 **MiniMax-M3.1-Flash** 重派（109 轮/约 12 分钟，退出码 0）——按工单附记「先核对半成品再补齐验证」执行，未推倒重写。Zcode CreateWorkflow 编排派发＋独立复核。工单与 §7 详见 [工单](./pinax-electron-next-m2-batch48-ticket-20261031.md)。
> 配套调度方报告：[Toonflow／ComfyUI 接入探索](./pinax-toonflow-comfyui-exploration-20261031.md)（MIT 实锤／MCP 客户端方向／三路径裁定 A→B→C）。

## 交付（细节以工单 §7 回填为准）

1. **ComfyUI MCP 桥**：`next/carriers/comic/comfy-mcp-bridge.mjs`（零依赖，MCP stdio，三工具 comfy_status/comfy_submit/comfy_result，`PINAX_COMFY_URL` 可覆写，下游不可达人话报错不挂起）。
2. **comic 载体四张牌真用**：mcp 牌（stdio 桥＋prefix comfy＋allow 白名单）＋services 牌（`preview-server.mjs` 零依赖 HTTP 预览，port 8191，healthPath /health，on-failure）＋context.providers 加 references（impl.blocks 挂接）＋AGENT.md 更新。
3. **夹具验证**：`fixtures/comfyMock.mjs`（mock ComfyUI 三端点）＋comic-bridge 端到端（stdio 起→列工具→打 mock）＋聚合面前缀路由＋监督器健康/崩溃重启＋信封 references 来自 comic。
4. **打包**：vite 载体资产拷贝收两份 .mjs 脚本；bundleAssertions 新门禁 o「载体 services/mcp 脚本进产物」。
5. toolSelect：DOMAINS 漫画域（漫画/分镜/出图/comfy）＋**写披露正则补 `_remove`**（评审员发现未申报——裁定见下）。

## 调度方验收

- 门禁独立复跑 exit 0；验收 **23/23**（20→23，批次48 新增段）、内核 **554/554**、界面 179/179、eslint 0 警、a–n3＋新 o 全过；d/d2 内核计数 19/20 未动（无新内核工具）。
- 评审 4 条裁定：①medium——WRITE_TOOL 正则补 `_remove` 未申报，**追认**（方向收紧：五块记录载体的 remove 工具从读池漏出修正到写披露池，与新增读池过滤强耦合；跨载体披露行为变化记入记录）；②low——三清单外文件（carriers/index.mjs 挂 impl.blocks／serviceSupervisor 裸命令走 PATH／agentRuntime baseEnv 叠加 PINAX_PROJECT_ROOT）§7 申报在案且核验成立，**追认**；③low——§7 把 plugin-panel.test.mjs 列「改」而实际零改动（mtime 被碰），记执行方信用账；④low——漫画板「预览」小钮未做（申报理由成立：需新 IPC＋清单外文件），**折进批次49 任务④收编**。
- **真窗口验证**（dameng-px 启用漫画，`D:\Pinax-e2e\next-batch48-shots\png\104-comic-board.png`）：漫画竖条与记录板出现；**preview-server /health＝200 {"ok":true}**（监督器自启动＋健康探针真链路首证）；Agent 卡**工具面 (46)**＝39＋4 comic 记录工具＋3 comfy 桥前缀工具——外部 MCP 工具进活工具面实锤。真实改动 20 文件 +1414/−35，零行尾翻转；守卫标记全过。

## 已知边界（如实记）

1. 未真连 ComfyUI/Toonflow（无环境）——桥对 mock 夹具验证；真接三步指南见探索报告 §五。
2. 漫画板「预览」小钮挂账批次49；漫画 JSON 数据（页/格）本身未造（空态实拍）。
3. `_remove` 进写披露池是跨载体行为变化（五个记录载体的 remove 工具从此按写工具披露）。
4. minimax 重派信用账：**+1**（12 分钟接手半成品补齐，未回潮未重写——CodeBuddy 时代的「静默挂起留半成品」前科在 Qoder CLI 管线上未复现，附记制度起效）；−1（§7 一处不实）。

## 复现

```bash
cd D:/Pinax-main/Pinax-main && npm run next:build:main && npm run next:build:shell && npm run verify:next
# 真窗口：往项目 .pinax/project.json 的 carriers.enabled 加 pinax.carrier.comic 后启动
```
