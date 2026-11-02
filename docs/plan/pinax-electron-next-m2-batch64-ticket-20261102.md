# 批次64 工单：装载原型打桩——pluginLoader fixture（Obsidian 框架轮·桩2 前置）（2026-11-02）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。工单源：框架计划 §6 桩2 的打桩前置（§10 自曝「pluginLoader 可行性未做原型验证」）。
> **本批性质＝可行性判定，不是产品功能**：30 行量级的 `pluginLoader` fixture，只在 node --test 里跑（不起 Electron）。**桩不过＝停在原地回报，不硬推批次65。**

## 任务

1. **`next/kernel/pluginLoader.mjs`（新，≤60 行）**：`loadCarriersFromDir(dir, { registry })`——`readdir` 扫 `<dir>/<载体id>/manifest.json` → `JSON.parse` → 走**同一个** `normalizeCarrierManifest(@4)` 校验 → 通过的调 `registry.install`（或返回装载结果数组，registry 注入可选）；任一清单坏＝该载体跳过并记账，不拖垮整批。
2. **fixture**：`next/testing/fixtures/loader-fixture/` 下放两份迷你清单（一份合法 @4、一份非法）＋各一个最小 impl（tools 可空数组）。
3. **测试**（`next/tests/plugin-loader.test.mjs`，新，≥4 条）：合法清单装入→registry 可见；非法清单跳过且记账；空目录→空结果不炸；**卸载→dispose 链跑完**（复用批次51 registerEffect 语义）。
4. **记账进 acceptance**：一条 `record()`——「装载原型：fixture 装入→registry 可见→卸载干净」（按作者裁决只记账不打回）。

## 允许文件

`next/kernel/pluginLoader.mjs`（新）、`next/testing/fixtures/loader-fixture/**`（新）、`next/tests/plugin-loader.test.mjs`（新）、`next/testing/acceptance.mjs`（记账一条）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

**不改内置 11 块的装载方式**（那是批次65）；不动 registry 本体（只消费既有 install/dispose）；不动外壳/渲染层；不改协议；不加 npm 依赖；不动 `server/**`、`src/**`；不起 Electron、不执行 git。

## 守卫标记

批次45–63 全清单继承；本批新守卫：pluginLoader 存在且 acceptance 记账条在。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿（含新记账条）；四条测试过。**若 fixture 桩暴露 registry.install 对外部清单有硬障碍（如 impl 必须函数工厂而 JSON 清单给不了）→ 如实回报障碍形状，批次65 设计随之调整——这正是本批的目的。**

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch64-20261102.md`；§8 调度方补。）
