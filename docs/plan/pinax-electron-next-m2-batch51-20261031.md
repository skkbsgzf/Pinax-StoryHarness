# 批次51 记录：可逆效应纪律——注册即 disposer，逆序回卷（Cordis 线A）（2026-10-31）

> 执行：Qoder CLI（DeepSeek-Flash，43 轮/约 6 分钟，退出码 0），Zcode CreateWorkflow 编排。工单源：[roadmap §3](./pinax-carrier-kernel-roadmap-tickets-20261031.md)→[执行工单](./pinax-electron-next-m2-batch51-ticket-20261031.md)。

## 交付

1. **`registerEffect(pluginId, setup, label?)`**（pluginRegistry）：setup 立即执行、必须交回 disposer 或数组；`undefined/null/空数组/含非函数` 一律 `INVALID_EFFECT` 拒收（setup 抛错也归一，不留半截栈）——「注册了但没法拆」的注册在接口层被拒。
2. **`disposeEffects(ownerId)`**：效应栈整体逆序（后注册先拆，数组内也逆序）；单个抛错记 serviceLogPool `level:'error'` 后继续，全部跑完才删栈；新增错误码 `EFFECT_ON_DISPOSED`（errors.mjs 码表家族）。
3. **主进程两处迁移真接线**：main.mjs 的 supervisor 服务事件推送（:475）与项目事件订阅改走 registerEffect；行为变化一处——渲染层服务事件推送改为**仅项目打开期间转发**（关项目不残留旧窗口推送，注释声明有意设计；状态点首屏由批次49 池快照恢复，不受影响）。
4. **渲染层两工厂交付**：`viewRegistry.registerViewEffect`（注册视图＋登记效应，内核拒绝时先撤已注册视图不留半截状态）与 `pluginBridge.attachPanelBridgeEffect`（加监听→返回移除函数的 setup）——**生产调用方为零**（见验收裁定）。
5. 测试：`plugin-registry-effect.test.mjs` 6/6（拒收/计数归零/抛错继续且逆序）。

## 调度方验收（含守卫裁定）

- 门禁独立复跑 exit 0；内核 **569+6=575/575**？——实数以门禁输出为准（定向 6/6 过、五段全绿）；真实改动 9 文件 +572/−30 零行尾翻转。
- 评审 high（四处迁移只有两处生产接线）**裁定为工单守卫超写而非执行方欠账**：渲染层（AppNext/PluginPanelHost）**拿不到内核注册表句柄**——registerEffect 在主进程，渲染层经 IPC 才能触达，强接＝新协议面；且内置视图本就无插件 owner（批次49 已证 disposeOwner 生产零命中）、PluginPanelHost 的监听由 Vue onBeforeUnmount 保证移除（无泄漏）。**守卫标记由「四处全部经它注册」修正为「main.mjs 两处经它注册＋渲染层两工厂就绪待插件自有注册路径（v3.1 外部插件）激活」**，理由=渲染层无内核句柄是结构事实，验收措辞更正记调度方账（工单是我写的）。
- 评审 medium（§7 空白＋批次记录未落盘＋未迁移清单缺）——连续第三批记录纪律问题，本记录由调度方代填，执行方信用账再记一笔。
- 评审 low（服务事件仅项目打开期转发）——接受，理由见交付3。

## 未迁移清单（记账，后续批消化）

| 注册点 | 位置 | 为什么暂不迁 |
|---|---|---|
| 渲染层视图注册（插件自有视图） | AppNext／hostViewRegistry | 内置视图无插件 owner；外部插件路径 v3.1 激活后走 registerViewEffect |
| PluginPanelHost 桥监听 | PluginPanelHost.vue:81-85 | 渲染层无内核句柄；Vue onBeforeUnmount 已保证移除（无泄漏）；迁移需 bridge 暴露 registerEffect（v3.1） |
| agentRuntime 项目事件订阅 | agentRuntime.mjs:168 | 运行时级生命周期与载体 owner 不同粒度，随 56① 工具契约批一并评估 |

## 已知边界

1. 渲染层两工厂目前只有测试调用——它们是 v3.1 外部插件路径的接口预置，不是死代码（本记录即消费承诺）。
2. 服务事件推送收窄到项目打开期间——若将来出现「无项目也要看服务状态」的需求，快照 IPC 已够，推送再议。

## 复现

```bash
cd D:/Pinax-main/Pinax-main && npm run next:build:main && npm run next:build:shell && npm run verify:next
```
