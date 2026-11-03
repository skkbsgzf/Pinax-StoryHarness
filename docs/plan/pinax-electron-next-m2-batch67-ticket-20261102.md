# 批次67 工单：设计语言成数据——DESIGN.md＋tokens.css＋manifest.json（2026-11-02）

> 调度方工单（独立可执行——可由任意执行方按本单施工，不依赖调度方 workflow）。来源：`electron-obsidian-framework-plan-20261102.md` §6 桩4③④＋§11 批次67；证据与量级详见配套审计 `external-tool-audit-rea-impeccable-opendesign-20261102.md`（A/P 项与 §5.1–5.2）。
> 基线：批次66 收口提交号（开工时以 git log 现查为准）。
> **红线：视觉零变化**。本批是「收敛与命名」，不是「改设计」——任何一处渲染差异都算失败。关键界面截图对照（开工前先拍基线）。

## 任务（五条）

1. **`next/shell/styles/DESIGN.md`（新）**：设计语言权威文档——设计原则、色板语义层（明暗两套）、字号刻度、间距/圆角/时长/缓动刻度、一物一名术语引用（指向规范 v2 术语表）。它是人读的总纲；tokens.css 是机器读的真源。
2. **`next/shell/styles/tokens.css`（新）**：约 **60 个一等 token**——从 `next-shell.css`（1763 行）收敛：色板语义层（含明暗覆盖块）、字号刻度（含 <12px 现状清单与豁免标记）、间距/圆角、时长/缓动（三套时长 0s/120ms/150ms 归一一档的输入）。**`--text-muted` 一名一值＋主题覆盖表**：现四值（对比度 3.37/3.93/4.49/6.10）按语义拆三 token（muted/faint/disabled——哪个语义用哪个对比度，逐处判定归位）。
3. **`next/shell/styles/manifest.json`（新）**：OD 形态清单（token-map 工具读的元数据）。
4. **`--accent-primary` 处置（144 处引用/40 文件/全仓零定义，审计 A）**：逐处判定其 fallback 或实际渲染意图，把值落进 tokens.css（**落的值必须等于该处现状实际渲染效果**——多数是 fallback 值或继承值）；无法判定的引用逐处登记进台账。红线同上。
5. **od lint＋impeccable detect 接 `verify:next` 记账段**：两工具在 `.qoder/skills/`（headless 可 `--fail-on`）；**先解 `.mjs`/`.vue` 扫描盲区**（审计 §2.2——不解决就是假绿）；只记账不设打回；覆盖率从 3.0% 起跳记账。

## 允许文件

`next/shell/styles/DESIGN.md`（新）、`next/shell/styles/tokens.css`（新）、`next/shell/styles/manifest.json`（新）、`next/shell/styles/next-shell.css`（引用归一——**值不变的改写**）、`next/testing/bundleAssertions.mjs` 或独立记账脚本（od lint/detect 记账段）、`package.json`（如需 script）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

**不改任何组件的视觉行为**（值不变的归一除外——以截图对照为零差异验收）；不动窗口系统/命令面/协议/写族；不加 npm 依赖（.qoder 工具已在本机）；不改 `server/**`、`src/**`、外部三目录；不动 12 份清单；不起 Electron（截图对照用调度方已有流程）、不执行 git。

## 守卫标记

批次45–66 全清单继承；本批新守卫：tokens.css 存在且被 next-shell.css 引用、`--text-muted` 单值断言、od lint 记账段在 verify:next 输出可辨。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿＋记账段出账；关键界面（正文/世界书/设定与资料/命令面板）截图对照零差异；`--text-muted` 全仓唯一真源；DESIGN.md/tokens.css/manifest.json 三件齐且互相引用一致。

## 记账指标（不进闸）

token-map 覆盖率；`--accent-primary` 逐处判定表（144 处的处置清单）；豁免登记表。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch67-20261102.md`；§8 调度方补；**截图基线对照**是本批特有验收件——开工前先拍，收口对照。）
