# Pinax-Electron-Next M2 批次16：导入向导＋约束编辑＋历史余账＋验收期两项热修（2026-10-28）

> 执行：workflow coder（DeepSeek `deepseek-flash`）三单全绿；调度方验收（独立门禁 179/179＋55/55→含热修后 180/180）。
> 同期作者反馈真窗口两个问题（打开项目行不通/无项目时竖条消失），根因与本批一起收口（§3）。

## 1. 三张工单交付（工单侧门禁一次全绿、调度方独立复跑全绿）

**E1 导入既有稿向导**：coder spike 推翻工单原路线（内核 pinax_project_import 经 resolveProject 只认 @1 项目、拒 sourcePath===根、写族闸整组拒——取证到 file:line），调度方裁定改 shell 级结构动作（dwfq-561fee5f-1）：新增 `next/runtime/projectImportAdapter.mjs` 薄导入器（复用内核类别表与 parseChapterNumber/parseWorldbookEntryFile；上限沿用内核 400 文件/2MB/32MB/12 层；不合契约 v2 的世界书跳过并提示走 MCP 轨），经 `project:import-run` 通道由主进程直调。向导 = 选稿子目录（只读源）＋选空目录建 @2 根 → dryRun 计划 → 执行 → 打开新项目。deferred：@1/@2 合流。
**E2 约束编辑最小面**：setting `约束:r→rw`（manifest 0.4.0）＋`pinax_rule_list`（随手带全文照 notes 先例）/`pinax_rule_save`；设定板「约束」树区＋中栏编辑；新建约束照「新构思标题」形态。
**E3 历史余账**：提案目录进 git 历史（`.pinax/proposals/` 加白名单，force add 同 project.json 先例）；`projectClose` 停历史定时器（ipcContract 新可选 `onProjectClosed` 回调，main 注入）；调度器仓内单测 `history-scheduler.test.mjs`（8 例：定时/关停/串行/probe 三态/beforeQuit）；SettingsModal 过时头注同步。

**两处执行方清单外断言同步（调度方核可）**：E2 顺带改 carrier-novel.test 与 carrier-pane-real.spec（约束树断言）——常备授权同构，已验证。

## 2. 门禁

调度方独立复跑（含热修后）：验收 16/16、内核单测 **180/180**、外壳界面测 **55/55**、eslint 0 警、打包 a–k 全过。

## 3. 验收期调度方热修（作者真窗口反馈驱动）

作者打开前台（大梦项目）报两问题，取证：
1. **「打开项目」菜单是死的**（menuInvoke 从未接线 project.open）＋ **无项目时竖条整个消失**（boards 依赖已打开项目的 view）＋ **标题栏与 logo 不平齐、无项目信息**（原生菜单栏在标题栏之下）。
2. **大梦打不开**：大梦是 MCP 时代 @1 文档、无 carriers → D2 闸 `PINAX_PRIMARY_CARRIER_MISSING`（headless 诊断复现）。

热修（本批）：
- **legacy @1 打开兼容**：openProject 对「无 carriers 且 kind 明确」的旧文档，按 kind 确定性推导主载体（安装载体里唯一 projectKind===kind），写回 @2（迁移即打开）；kind 无匹配仍停在主载体闸（不猜口径不变）。回归测试入 project-contract.test.mjs（推导升级落盘＋无匹配停闸两段）。**大梦实测：打开成功、spec 升 @2、novel 板激活。**
- **userData 隔离**：`PINAX_APP_DATA` 只改了偏好位置，Electron 的 userData（Cache/锁）仍共享 `%APPDATA%/Electron`——强杀实例后残留锁会把下一实例卡死在 renderer 出生之前（主进程活、无 renderer、无窗口，实测复现两次）。修复 main.mjs `app.setPath('userData', PINAX_APP_DATA)`（whenReady 前）。
- **提案标脏**：writeProposal 成功后 notifyWrite（E3 发现的遗留：只写提案不写别的时快照永不收编）。
- **启动器自愈**：node 裸 spawn electron 约半数概率丢 renderer（整晚实测），launch-next-dameng.mjs 改为「spawn→CIM 轮询 renderer 子进程→没出就杀掉重试×4」＋main.mjs ready-to-show 打标＋位置参数直开项目（argv 绝对路径，UTF-16 传递不吃编码——cmd 批次的中文路径编码问题由此绕开）。

**遗留到批次17（与 E1 同文件冲突面，等本批落地后做）**：①统一标题栏（作者裁定：菜单行与 logo 平齐＋展示项目信息——Electron titleBarStyle hidden/overlay＋页内菜单行渲染 MENU_TEMPLATE＋项目名/状态 chip）；②project.open 菜单接线（选目录→session.open）；③无项目时竖条常驻（显示载体格＋打开/新建动作，不再是空 rail）。

## 4. 诚实边界

- E1 薄导入器覆盖面是内核的子集（worldbookMode wrap、include/exclude、覆盖开关不做）；@1/@2 合流 deferred（导入完成的 @2 项目对内核 MCP 工具仍不可作 projectPath，日常读写走载体工具不受影响）。
- kernelWriteGuard 拒绝提示的 ownedTools 列表不够精确（批次16 记账，改判定逻辑须升级）。
- 约束行无「历史…」入口（AppNext historyTarget 只认四类文档，AppNext 冲突面延后）。
- 导入向导对《大梦》级真实目录的端到端未测（工单内隔离目录测试）；真窗口观感截图服从作者使用时机。
- 执行方上报一次误执行只读 git status（无副作用，已自律不再犯）。
