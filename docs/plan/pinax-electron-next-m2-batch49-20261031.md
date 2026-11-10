# 批次49 记录：端口状态指示灯＋服务通信公共池（2026-10-31）

> 作者补需：「竖条图标右上角小点展示端口服务状态（绿=运行中/橙=待确认/红=错误/灰=端口已关闭）＋每个端口的通信信息有日志、通知等公共池，可供 agent 访问、可供底座发现并通知」。
> 执行两段：首派 DeepSeek-Flash 被 provider 错误 140 打断（22 分钟零交付，评审员 hash 级核验抓出——管线诚实层首立功）；全新重派 DeepSeek-Flash 成功（146 轮/约 14 分钟，退出码 0）。Zcode CreateWorkflow 编排。工单与评审详见 [工单](./pinax-electron-next-m2-batch49-ticket-20261031.md)。

## 交付（细节以工单 §7 自述与评审为准；§7 文件回填空白——执行方把回填写进了结果自述未写工单文件，连续第二批 §7 纪律问题，记信用账）

1. **公共池 `next/runtime/serviceLogPool.mjs`**：环形（每来源 200/总 1000）；`append/list/statusByCarrier/snapshot/acknowledge`；四色语义与「未声明不出点」写在头注释；supervisor 服务事件与 mcpClient 连接/调用事件改道进池（池是唯一权威视图）；confirm 通知 ack 存应用级偏好 `serviceNoticesAckedAt`。
2. **原生只读工具 `pinax_service_log_list`**（`serviceLogTools.mjs`，`pinax_skill_read` 同款 nativeMap 注册路，归 kernel.runtime.services；不动 server/mcp 19 工具合规面）——agent 可读服务/MCP 运行日志、告警与待确认通知。
3. **竖条四色状态点**：`ActivityRail.vue` 状态点＋`nx-rail-status-dot` 四色修饰（css token）；首拉快照＋池 onChange 事件驱动（无轮询）。
4. **设置「服务与通知」节**：`ServicesSection.vue`（状态表＋日志尾＋「知道了」ack＋服务重启钮）。
5. **批次48 挂账收编**：漫画板头部「预览」小钮（宿主 openExternal，地址从 services 声明现取，服务未运行禁用态）。
6. 门禁：acceptance 20→21 等三处精确同步＋d2 20→21；bundleAssertions **新增 l/l2/l3/l4 四条守卫检查**（加强非放松）。

## 调度方验收

- 门禁独立复跑 exit 0；acceptance **23/23**（含 M4/M5 预览服务读真数据、收尸后端口不监听等批次48 断言续绿）、内核 **562/562**、界面测全绿、eslint 0 警、a–n3＋l 系全过；真实改动 33 文件 +1546/−52 零行尾翻转。
- 评审 4 条裁定：①medium 四文件（agentRuntime/mcpSurface/appPreferences/ActivityRail）清单外——全部是任务①②③④的必然接线点且全在 next/**，**追认**（ActivityRail 独立成组件是工单没料到的落点，工单疏漏）；②medium §7 空白——计数理由实际写在断言标签里（全部 === 精确断言，非放宽），实质合规形式欠账，记信用账；③low 前批 tmp 脚本残留——commit-worktree 只加 next/docs/根白名单，不会入库；④low 陈旧索引警示——评审员全程用临时索引法（第三次咬人，工单 diff 指引已改临时索引版）。
- **真窗口实拍**（dameng-px，`D:\Pinax-e2e\next-batch49-shots\png\105-rail-status-dots.png`）：漫画图标**绿点亮起**（preview-server /health 200 真运行驱动）；其余载体无点（噪点纪律）；Agent 卡**工具面 47**＝46+1 原生日志工具进活面。橙/红/灰三色路径由 jsdom spec＋池测试钉住（真注入需制造崩溃，不在实拍范围）。

## 已知边界（如实记）

1. 橙/红路径未在真窗口注入验证（需真崩服务；spec 覆盖映射逻辑）。
2. ack 水位按时间戳一刀切（无逐条已读）；确认状态在应用级偏好，不随项目走。
3. 首派失败与重派各计一次信用账：DeepSeek −0（provider 错误非执行方责任）＋1（重派 14 分钟干净交付）。

## 复现

```bash
cd D:/Pinax-main/Pinax-main && npm run next:build:main && npm run next:build:shell && npm run verify:next
# 真窗口：启用漫画载体的项目里看竖条漫画图标右上角绿点；设置 → 应用 → 服务与通知
```
