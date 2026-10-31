# 批次56① 工单：工具输出契约——合同定义（Cordis 线C·只做第一档）（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 前置：批次54 已收口。工单源：roadmap §8——**作者裁定的第一档**：只做①合同定义，②存量迁移只记账不做，③取消/④错误码表不在本批。
> 裁定说明：output 声明作为 **@4 的可选附加字段**（出现即校验，缺省＝老清单照装）——@4 刚收口，非破坏性附加不必另开 @4.1。

## 任务（三条）

1. **`validateTools` 扩 `output` 字段**（`next/kernel/carrierManifest.mjs`）：工具条目可带 `output: { schema: <JSON Schema 对象>, presentationMeta?: 对象 }`——可选；出现即校验（schema 必须是合法 JSON Schema 形状的对象、深度/大小上限沿用 `*_MAX` 家族、presentationMeta 顶层对象）；不出现＝兼容（存量 42+ 工具照装）。**`render` 不做**（渲染归属宿主，登记未采用）。
2. **运行时零消费如实登记**：本批校验器收下 output 并在聚合面工具元数据透出（`annotationsOf` 同路的元数据口），但 toolLoop **不按 output 校验返回体**（消费归后续批——-roadmap ②档）；批次记录写明「声明了 output 的工具，其返回体本批不校验」。
3. **记账**：派单前以 `surfaceInfo().carrierToolNames` 现数为准，统计缺 output 声明的存量工具条数进批次记录（只记账不迁移）；新工具若声明 output 则校验器真拦（非法 schema 拒装）。

## 允许文件

`next/kernel/carrierManifest.mjs`（或其 contract 拆分文件）、`next/runtime/surfaceAggregate.mjs`（元数据透出，最小）、`next/tests/carrier-v4-*.test.mjs` 或新测试文件＋受影响测试、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（计数写理由）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不改 `server/**`、`src/**`；不加 npm 依赖；**不动 toolLoop/toolTurn 执行语义**（本批零行为变化——只有清单校验与元数据透出）；不动存量工具返回体；不做取消/AbortSignal（③档未裁）；错误码表不动（④档未裁）；不起 Electron、不执行 git。

## 守卫标记

批次45–55 全清单继承；本批新守卫：output 词表进 manifest 校验（含「非法 schema 拒装」断言）、聚合面透出点存在。

## 验收判据（完成定义）

`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段全绿；output 合法/非法各有 ≥3 用例；无 output 的既有全部清单与夹具照装（兼容断言）；存量缺声明条数记账在批次记录。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch56-20261031.md`；§8 调度方补；diff 指引用临时索引法。）
