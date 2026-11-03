# 批次68 工单：视觉手感收口——时长归一＋CLS＋字号（2026-11-02）

> 调度方工单（独立可执行）。来源：`external-tool-audit-rea-impeccable-opendesign-20261102.md` 的 B（CLS 0.1245）/D（时长三套）/E（<12px 字号 444/633 节点）项；前置：批次67 的 tokens.css 已立（字号/时长 token 有处可收）。
> 基线：批次67 收口提交号（开工时以 git log 现查为准）。
> **红线**：按审计判据改「手感」，不改「设计」——色板/布局/信息架构不动；每处改动前后截图对照。

## 任务（四条）

1. **时长归一（审计 D）**：三套时长（竖条 `transition: 0s`／外壳 120ms／继承层 150ms）归一到 tokens.css 的时长刻度——竖条 0s 是特例裁定项：要么显式登记「竖条即时切换」为设计意图进 DESIGN.md，要么跟随统一时长（二选一写理由）；`reduced-motion` 语义下全部归零生效。
2. **CLS 0.1245 消源（审计 B）**：先量化定位位移源（col-center 的具体跳动时刻与元素——审计已测总值，本批先定位源），再修（字体加载 swap 策略/占位尺寸/懒加载占位——按源定方案）；修后 CLS 记账值显著低于 0.1245（**只记账，不设自动打回**）。
3. **字号收编（审计 E）**：444/633 个 <12px 文本节点收进批次67 的字号 token——**有设计意图的小字号（徽章/角标/状态灯标注）登记豁免表**，无意图的归位到最近刻度；逐批提交豁免表（数量+代表样本）。
4. **reduced-motion 全量生效**：三套时长归一后，`prefers-reduced-motion` 下所有过渡/动画归零（全仓动画清点）。

## 允许文件

`next/shell/styles/next-shell.css`、`next/shell/styles/tokens.css`（批次67 产物上扩展）、`next/shell/ActivityRail.vue`（transition 特例）、`next/shell/AppNext.vue`（col-center 位移源如在此）、`next/shell/IndexWindow.vue`（如需）、字体加载策略所在文件（如 main/index html）、`next/tests/`＋受影响 spec、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不改色板/布局/信息架构；不动窗口系统/命令面/协议/写族语义；不改 `server/**`、`src/**`、外部三目录；不加 npm 依赖（字体加载策略用既有机制）；不起 Electron（截图对照由调度方或有窗口环境者执行）、不执行 git。

## 守卫标记

批次45–67 全清单继承；本批新守卫：时长 token 三值收敛断言、reduced-motion 全量断言、字号豁免表在 DESIGN.md。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿；CLS 记账值显著改善（数字如实）；reduced-motion 断言在；豁免表落 DESIGN.md；截图对照（改动前/后各一组）。

## 记账指标（不进闸）

CLS 前后值；<12px 收编数量与豁免数量；时长归一对照表。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch68-20261102.md`；§8 调度方补；**截图基线对照**同 67。）
