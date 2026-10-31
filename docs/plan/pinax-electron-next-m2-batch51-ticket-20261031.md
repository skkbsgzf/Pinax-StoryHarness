# 批次51 工单：可逆效应纪律——注册即 disposer，逆序回卷（Cordis 线A）（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 前置：批次50 已收口（tip `b2b12b9`）。工单源：roadmap §3，实质任务一字不改。
> 背景：卸载残留是这个仓反复复发的 bug 类别（批次37「假桥旧函数引用不退订」、批次45–48「disposeOwner 零调用方」）——本批把「注册一个东西就要负责拆掉它」从手工默契升级为接口合同＋门禁断言。

## 任务（五条）

1. **`registerEffect(pluginId, setup, label?)`** 加进 `next/kernel/pluginRegistry.mjs` 的 `createRegistry`（与 disposePlugin 同文件）：`setup(ctx)` 必须返回 disposer 或 disposer 数组；返回 `undefined` 即 `fail('INVALID_EFFECT', ...)`——**拒收「注册了但没法拆」的注册**（与 v3「声明了不生效就拒装」同一哲学，不是新规矩）。
2. **逆序回卷＋失败不中断**：`disposePlugin` 改为按注册逆序跑 disposer；单个抛错只记 `serviceLogPool` 的 `level:'error'` 条目并继续拆（**必须留痕，不许静默**）；全部拆完才从注册表移除。
3. **向已卸载插件注册即抛**：新增错误码 `EFFECT_ON_DISPOSED`（走 `next/kernel/errors.mjs` 既有码表家族，不新造格式）。
4. **存量迁移只做四处**（不撒网）：事件总线订阅（`next/runtime/eventBus.mjs`）、视图注册表 owner 卸载（`next/shell/viewRegistry.mjs` 的 disposeOwner）、面板桥监听（`next/shell/pluginBridge.mjs`）、运行时服务事件订阅（`next/shell/main.mjs` 对 supervisor 的 push 订阅）——改走 `registerEffect`；其余保持现状并在批次记录里列未迁移清单。
5. **门禁接线**：`next/tests/plugin-registry-effect.test.mjs`（新）三条硬断言——① 不返回 disposer 的注册被拒；② 卸载后事件总线上该插件的监听器数量为 0（用 eventBus 的可观测计数接口，**不许靠「没报错」间接判**——eventBus 需暴露只读计数）；③ 一个 disposer 抛错时其余仍被执行且逆序顺序正确。

## 允许文件

`next/kernel/pluginRegistry.mjs`、`next/kernel/errors.mjs`、`next/runtime/eventBus.mjs`（暴露计数只读接口）、`next/shell/viewRegistry.mjs`、`next/shell/pluginBridge.mjs`、`next/shell/main.mjs`、`next/tests/plugin-registry-effect.test.mjs`（新）＋受影响测试、`next/testing/acceptance.mjs`（计数同步写理由）。

## 禁止边界

不改插件加载为进程外（`trustMode` 仍 same-process）；**不引入 `AsyncDisposable`/`Symbol.dispose` 等需要新 Node 特性的写法**（本机 dev 线 Node `>=22.13 <23`，别赌）；不动清单 schema；不加 npm 依赖；不改 supervisor 的 spawn/退避语义；不起 Electron、不执行 git。

## 守卫标记

批次45–50 全清单继承（含 50 新守卫：EXTERNAL_WRITE_HINT 收敛＋toolInterceptors 五导出）；本批新守卫：`registerEffect` 存在且四处迁移点全部经它注册（grep 可验）、`EFFECT_ON_DISPOSED` 进码表。

## 验收判据（完成定义）

`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段全绿；三条硬断言存在；批次45–50 守卫清单全部继承（disposeOwner 那条由「手工接线」升级为「接口强制」）。

## 记账指标（不进闸）

未迁移的注册点数量与清单（写进批次记录，后续批消化）。

---

## §7 执行方回填 ／ §8 调度方验收

（同批次50 工单格式；diff 指引用临时索引法；§8 由调度方填，记录落 `docs/plan/pinax-electron-next-m2-batch51-20261031.md`。）
