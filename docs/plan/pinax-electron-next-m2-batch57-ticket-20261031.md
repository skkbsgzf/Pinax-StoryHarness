# 批次57 工单：能力全表自动导出——descriptor 与注册表一致性（Cordis 线C·文档不再漂移）（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 前置：批次56① 已收口。工单源：roadmap §9。痛点：`host-descriptor.json` 手填——加了宿主视图忘改 descriptor 现在抓不到（doctor 只核字段存在与否，不核与真实注册表一致）。

## 任务（三条）

1. **descriptor 自动导出**：新增 `next/testing/exportHostDescriptor.mjs`（或同位脚本）——从 viewRegistry/词表常量**生成** descriptor 内容（views 九项/forms 五态/slots/uiLayers），与手写 `host-descriptor.json` 逐字段对比；不一致即门禁红（新增宿主视图忘改 descriptor 会被抓）。导出脚本进 `next/testing/`（scripts/ 不在提交轨）。
2. **每载体 AGENT.md 增 Known Limitations 段**：十二份 AGENT.md 统一补「## 已知边界」段（各载体现挂账如实列——内容以批次记录与开发者指南为准，执行方从既有记录汇编）；bundleAssertions n3 门禁扩一条「AGENT.md 含该段」（12 份逐一核）。**不新增 README 文件**（AGENT.md 已是作者须知载体，六段式里最有价值的是 Known Limitations，其余段落并入现有结构即可）。
3. **开发者指南接生成器**：`docs/plan/pinax-plugin-author-guide-*.md` 的 v3/v4 字段速查表后加一行生成说明（「以 `next/testing/exportHostDescriptor.mjs` 输出与 carrierManifest 词表为权威，手写表漂移以门禁为准」）——文档一行，防止指南本身成为第二真相源。

## 允许文件

`next/testing/exportHostDescriptor.mjs`（新）或等价脚本、`next/testing/bundleAssertions.mjs`（一致性 gate）、12 份 `next/carriers/*/AGENT.md`（补已知边界段）、`docs/plan/pinax-plugin-author-guide-20261031.md`（一行）、`next/host-descriptor.json`（如对账后发现手写内容确实过时，按注册表现实修正——逐处写理由）、`next/tests/`、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不改 `server/**`、`src/**`；不加 npm 依赖；**不改 viewRegistry/词表本体**（本批只读它们做导出）；不动运行时行为（纯文档与门禁批）；不起 Electron、不执行 git。

## 守卫标记

批次45–56① 全清单继承；本批新守卫：descriptor 一致性 gate 存在、AGENT.md 已知边界段 12/12。

## 验收判据（完成定义）

`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段全绿；一致性 gate 断言在（人为改错 descriptor 一字段测试要红——反向断言）；AGENT.md 已知边界 12/12。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch57-20261031.md`；§8 调度方补；diff 指引用临时索引法。）
