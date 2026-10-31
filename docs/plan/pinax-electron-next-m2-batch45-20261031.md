# 批次45 记录：v3 协议补全——沉浸态＋写族闸收口＋每插件配置命名空间＋解注册接线（2026-10-31）

> 作者蓝图三诉求的差距收口批，标杆插件计划（标杆1 小说套件＋标杆2 Toonflow/ComfyUI）的地基。
> 执行：Qoder CLI（DeepSeek-Flash，266 轮/约 21 分钟，退出码 0），Zcode CreateWorkflow 编排派发＋独立复核。工单与执行方 §7 详见 [工单](./pinax-electron-next-m2-batch45-ticket-20261031.md)。

## 交付（细节以工单 §7 回填为准）

1. **沉浸态**：`PLACEMENTS` 加第五值 `immersive`（`workspace.mjs:35`，与 fullscreen 共用整窗几何与 restore 记忆）；七块文档面载体 forms 声明加 immersive、五块记录型不加；打开菜单多「沉浸」项；进入后 ActivityRail 与右栏运行坞收起（运行坞 `v-show` 保会话状态），**三出口**＝顶栏钮/pane 头钮/Esc；Esc 优先级＝活动浮窗先收、无浮窗才退沉浸。
2. **写族闸收口**：`EXTERNAL_WRITE_HINT`（`kernelWriteGuard.mjs:48`，六后缀）；writePolicy 写族＝落点表∪外部启发式——review 档外部写工具转 `dir:null` tool-call 提案、auto 放行、blocked 拒；聚合面新增 50 条写调用审计环（`recentWriteCalls()`），只记账不改放行。
3. **每插件配置命名空间**：`next/settingsStore.mjs`（新，`.pinax/settings.json`，tmp+rename 原子写/坏档回空/内容不变不写/`set()` 只认清单声明并按类型校验）；IPC `settings:load|save`；`CarrierSettingsGeneric.vue`（新）按声明渲染 string/number/boolean/enum/section 五类控件；SettingsModal 保留 novel.writing 硬编码映射（应用级不迁移），其余声明走通用渲染器。
4. **解注册接线**：停用先 `disposeOwner` 释放视图＋`workspace.removePanes()`（新）清 `#1`/`#n` 实例与 placement/geometry/minimized/pinned，再交内核重建（服务/MCP/工具面随重建收掉）；`runtime.disableable === false` 断言保留并补理由。

## 门禁（执行方自报＝调度方独立复跑一致）

```
next:build:main 1,154.35 kB ／ next:build:shell 1,914.88 kB ／ preload 4.46 kB
verify:next：验收 20/20（toolCount 37/22 未变）·内核单测 518/518（+19）·界面测 157/157（+10）·eslint 0 警·打包 a–n3 全过
```

## 评审与验收（调度方裁定）

评审员 5 条发现的处置：
- **两条 high（server/ 三文件＋老线 ~95 文件越界改动）→ 判为已知基线漂移，非执行方所为**。mtime 归因：全部涉事文件 mtime＝10-20 04:42（集中发布快照日期），早于派发窗口（10-31 12:08–12:29）十一天；差异量 ~95 文件与记忆中「基线快照既有漂移」完全吻合。工单明令不改 server/**，执行方 §7 亦未申报——不采信越界指控。
- 夹具 `mcpEchoServer.mjs` 不在允许清单＝**工单清单疏漏**（任务②.4 明文要求改它），报备修正。
- 10 个未跟踪文件：三份后续批次工单（46a/46b/48）为调度方所有；tmp-* 实拍脚本为批次42 遗留工具，均不入本批提交。
- §7 把 doctor.mjs 列为已改而实际零改动＝**回填表述不实一处**（doctor 动态读描述符本就无需改，且 doctor.test 加了加严用例）——记入执行方信用账，不改判验收。

真窗口实拍（dameng-px，`D:\Pinax-e2e\next-batch45-shots\png\`）：89 正常布局／90 右键菜单含「沉浸」／91 沉浸态（活动栏＋Pi-Agent 收起，双退出钮，索引树保留——树非工具栏，符合作者「隐去工具栏和agent」口径）／92 Esc 还原。守卫标记清单全过；真实改动 30 文件 +725/−76，零行尾翻转。

## 已知边界（如实记）

1. `disposeOwner` 生产路径当前零命中（宿主视图全为 builtin、第三方尚不能注册视图）——接线已通，测试用临时 custom 视图证明真实生效。
2. 停用清理发生在内核确认前，内核拒停用时 pane 已关、工作区已清、载体仍启用——无失败回滚，重开 pane 即可。
3. 数字输入的 min/max/step 渲染为潜伏能力（manifest 校验器白名单未放开声明字段）。
4. 设置坏档告警只在 store 读回载荷里，弹窗未展示。
5. 外部 `comfy_submit` 类非写后缀工具 review 档直执行是有意的（出图非写盘），审计环记账。

## 复现

```bash
cd D:/Pinax-main/Pinax-main && npm run next:build:main && npm run next:build:shell && npm run verify:next
node D:/Pinax-e2e/capture-b45.mjs   # 沉浸态实拍
```
