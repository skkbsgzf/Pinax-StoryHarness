# 批次62-0 工单：规范 v2 骨架＋统一裁定台账（纯文档）（2026-11-02）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。工单源：`docs/plan/electron-obsidian-framework-plan-20261102.md` §6 桩4 的①②④＋§11 第0批。
> 性质：**纯文档批，零代码改动**。

## 任务

1. **规范 v2 骨架**：新文件 `docs/plan/pinax-electron-next-spec-v2-20261102.md`——
   - @4 全字段合同表（以 `next/kernel/carrierManifest.mjs` 现实现为唯一权威，逐字段：名/类型/校验规则/宿主消费点）；
   - @1→@4 改名对照表（capabilities→provides、scopes→permissions、panes→contributes.panes 等，来源：`carrierManifest.mjs:46-56` 与 spec v1 §3）；
   - 槽位/形态/视图三词表（OPEN_SLOTS 三值、形态词表现值与落点现状、HOST_VIEW_TYPES 八＋custom）；
   - 装载合同一节（现状：静态数组＋零装载路径，桩2 的合同占位）；
   - J1–J6 六判据（引自框架计划 §5，逐条注明当前达成态）。
2. **术语表**：同文件附一节——carrier/载体/plugin、pane/板/页/窗/标签、forms/form/layout template 等（F9 一物一名，中英对照，注明「禁止同义替换」）。
3. **统一裁定台账**：新文件 `docs/plan/pinax-ruling-ledger-20261102.md`——一张表收拢全部未裁/已裁项：R3/R4、spec v1 §7 待裁④⑤⑥、本计划 Q1–Q6（含今日调度方默认裁定，见下）、审计 A–P 中仍开放的项；每行＝编号/议题/裁定/日期/留名人。**今日已裁定的按此填**：Q1＝R4 追认（硬拒保留，写进 v2 留名）；Q2＝fullscreen/immersive 删词（批次66 落地）；Q3＝命令面板 Ctrl+P、提案审阅改 Ctrl+Shift+R（批次62 落地）；Q4＝第一档不开第三方 JS；Q5＝popout 推后；Q6＝DESIGN.md 与 v2 同批。
4. **三处陈旧注释登记**（不改代码，登记进台账待批次66）：`carrierManifest.mjs:149,465,476`「宿主六种视图」实为 8＋1；`paneForms.mjs:25` 缺省注释与 :26 常量不一致；`ipcContract.mjs:102`「反向通道只有三条」实为 4＋3。

## 允许文件

仅 `docs/plan/pinax-electron-next-spec-v2-20261102.md`（新）、`docs/plan/pinax-ruling-ledger-20261102.md`（新）。

## 禁止边界

不改任何代码/测试/样式；不改 spec v1 与既有文档（v2 是新文件，v1 保留为历史）；不在台账外新造裁定。

## 验收判据（完成定义）

两份文档落盘且内容覆盖上述四节；台账含 Q1–Q6 与历史未裁项全量；调度方按「新读者照 v2 写的清单能过校验器」抽查。

---

## §7 执行方回填 ／ §8 调度方验收

（§7 列交付结构与自查；§8 调度方补。）
