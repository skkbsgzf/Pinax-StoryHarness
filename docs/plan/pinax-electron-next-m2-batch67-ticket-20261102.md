> ⚠️ 已被并行链吸收（2026-11-03）：本工单的范围由并行会话的批次69/70–76 执行覆盖（69=drain 根治已落，见 batch69-20261102.md；74=样式清账；72=键位闭环）。残留独有价值以并行链实况为准，本单保留作对照，不再派发。

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

---

## §9 开工前实测订正（2026-11-03，执行方补；不动上面正文，按此段裁口径施工）

出处：[前端待办账](./pinax-electron-next-frontend-backlog-20261102.md)。所有读数为本会话在磁盘上亲量，命令附在该账末尾。

1. **任务2 的「`--text-muted` 现四值」在全仓成立，在 Next 只生效两值**。四个定义全在继承层：`src/styles/main.css:102`（`:root` `#8d7f70`）、`:171`（`.theme-dark` `#7d7165`）、`src/styles/themes/legacy.css:14`（`:root.theme-legacy` `#6b7078`）、`:714`（`:root.theme-legacy.theme-dark` `#969ba3`）；`next/shell/styles/next-shell.css` **自己一条 `--text-muted` 都没定义**。而 Next 的 `<html>` 恒带 `theme-legacy`（`next/shell/index.html:2` 写死，明暗切换只换 light/dark：`next/shell/theme.mjs:38`），按层叠特异性 `:root.theme-legacy`(0,2,0) 压过 `:root`(0,1,0) 与 `.theme-dark`(0,1,0)——**今天 Next 屏幕上的 muted 只有 `#6b7078`／`#969ba3` 两个值，审计点名的低对比度那两档（3.37/3.93）在 Next 里根本不可见**。推论两条：①拆三 token 时「哪个语义用哪个对比度」要按这两个真值判，别拿不可见值当现状；②tokens.css 若要覆盖继承层，**选择器特异性必须 ≥ (0,2,0)**（写成 `:root.theme-legacy`／`:root.theme-legacy.theme-dark` 同构块），写成裸 `:root` 就是「定义了但不生效」的假收口。
2. **任务4 的量级订正**：`--accent-primary` 定义点【实测】全仓 **0**（`next`＋`src`＋`server`，排除 `.build`）；引用 `next/shell/**` **2 处**（`AssistantDialog.vue:552/554`，两处都带 `var(--accent)` fallback）、`src/**` **120 处**（非 var 写法另有 1 处，共 121；审计的「144 处/40 文件」口径更宽，未复量）。本批禁止面含 `src/**`，所以**任务4 的可动工面＝Next 那 2 处**，`src/**` 的 120 处只出判定台账不动值。真正的收敛面量级：`next/shell/**` 的 `var()` 引用 **882 处**，而 `next-shell.css` **1867 行**里只有 **9 条** `--*` 定义——这是 tokens.css 要接的盘子。【实测】那 9 条已经是一张**半张刻度**：`.next-shell` 块里有 `--nx-fs-2xs:11px`／`--nx-fs-md:13px`／`--nx-fs-lg:15px`／`--nx-fs-xl:17px`／`--nx-fs-2xl:19px`＋`--nx-section-gap:18px`＋`--nx-radius-xs:6px`，`.nx-titlebar` 里有 `--nx-titlebar-height:36px`（`:59`，注释要求与 `next/shell/main.mjs` 的 `TITLEBAR_OVERLAY.height` 同步）。**字号刻度缺 `xs`／`sm` 两档、圆角只有 `xs` 一档**——tokens.css 是把这张表补全并搬家，不是从零立表；已存在的名字**不许改值**（67 的红线＝视觉零变化，11/13/15/17/19 这五档现在正被引用着）。
3. **任务5 的两工具，一台能跑一台跑不了**：impeccable 可 headless 跑，入口是原生二进制 `.qoder/skills/impeccable/scripts/bin/windows-x64/impeccable.exe`（`--help` 实测可用，子命令 `detect [file-or-dir-or-url...]`＋`ignores`）；工单写的「`.qoder/skills/` 里两工具」对 OD **不成立**——OD 在仓外 `D:/Pinax-main/_tools/od`，其 CLI 包装 `apps/daemon/bin/od.mjs` 存在但 **dist 未构建**，直接跑抛 `OpenDesign daemon dist entry not found ... Run "pnpm bootstrap"`。后果与裁法：本批禁止「加 npm 依赖」，建 daemon 要 pnpm 装包构建——**要么作者放行 OD 的本地构建，要么 od lint 那半边如实记为「工具不可用」，verify:next 只接 impeccable 一段**。不许留一个调不通却永远绿的记账段（那正是审计 §2.2 说的假绿）。
4. **一条会撞的既有闸**：`next/testing/bundleAssertions.mjs:584-595` 的 h 项把 7 个老前端词汇 marker 钉在**渲染层 CSS 产物**里，其中含字符串 `theme-legacy.theme-dark`（另六个是 `--control-accent-bg`／`.control-primary`／`--radius-control`／`--workbench-action`／`--archive-ink`／`--font-writing`）。token 收敛如果把 `:root.theme-legacy.theme-dark` 块改写／合并到别的选择器，**第五段会直接红**——本批要么保住这个串，要么同批把 h 项的 marker 表更新并在记录里写明是「串还在、只是搬家」。
5. **验收件冲突仍未解（等作者点头，见该账「待裁定」5／9）**：红线要求「关键界面截图对照零差异」，禁止边界又写「不起 Electron（截图对照由调度方执行）」。不解决就是这条红线无法自证；另外 git HEAD 仍停在批次41，工作树是唯一现状，「改前/改后」没有可信基线。
6. **`--text-muted` 的引用面读数订正**：【实测】**123 处 / 18 文件**（`next-shell.css` 52、`AssistantDialog.vue` 22、`CarrierPaneHost.vue` 13、settings 四文件 13，余零散），审计的「116 行」是旧口径。
