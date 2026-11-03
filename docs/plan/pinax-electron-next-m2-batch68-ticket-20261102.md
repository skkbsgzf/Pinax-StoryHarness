> ⚠️ 已被并行链吸收（2026-11-03）：本工单的范围由并行会话的批次69/70–76 执行覆盖（69=drain 根治已落，见 batch69-20261102.md；74=样式清账；72=键位闭环）。残留独有价值以并行链实况为准，本单保留作对照，不再派发。

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

---

## §9 开工前实测订正（2026-11-03，执行方补；不动上面正文，按此段裁口径施工）

出处：[前端待办账](./pinax-electron-next-frontend-backlog-20261102.md)。读数为本会话亲量，命令附在该账末尾。

1. **任务1 的「三套时长」是低估，且「竖条 0s」不是一条裁定**。Next 实际加载 6 份 CSS（`next/shell/styles/legacy.mjs` 引 `src/styles/` 的 main／themes/legacy／workbench-controls／workspace-navigation／workspace-surfaces 五份 ＋ 自己的 `next-shell.css`，合计 3893 行）。【实测】这 6 份里的 transition 时长共 **8 档不同值**：`0.15s`×10、`0.16s`×9、`120ms`×7、`140ms`×5、`0.01s`×3、`0.25s`×2、`0.2s`×1、`0.18s`×1（把 animation 等其它计时字面量也算上则 14 档，含 `6s`/`12s`/`1s`/`220ms`/`180ms`/`160ms`——那几档是脉冲／扫光类装饰动画，**不该并进交互时长刻度**，归一时要分开裁）。`next-shell.css` 自己只有 4 条 transition（`:203`／`:468`／`:1026`／`:1534`）**全是 120ms ease**。
2. **竖条那一条按工单写法会误裁**：`ActivityRail.vue` 内 `transition` **0 命中**，6 份 CSS 里也**没有任何 `.nx-ribbon-item` 的 transition 规则**——所谓「竖条 0s」是「根本没写过渡」的缺省继承，不是一条显式裁定。所以工单给的二选一（登记即时切换为设计意图／跟随统一时长）**前提不成立**，实际要裁的是「竖条要不要有过渡」这个新问题；本批按新裁定办并写理由，不要沿用「特例已登记」的说法。
3. **任务4 的清点范围**：【实测】`prefers-reduced-motion` 继承层 **9 块**（`src/styles/main.css` 4、`themes/legacy.css` 3、`workbench-controls.css` 1、`workspace-navigation.css` 1、`workspace-surfaces.css` 0），Next 自己 **1 块**且只护 `.nx-focus-mask` 一个类（`next-shell.css:1538-1540`）。工单说「reduced-motion 下全部归零生效」在继承层那 9 块里**已经是事实**，Next 侧真正缺的是把自己那 4 条 120ms 与装饰动画一起纳入同一媒体查询——**范围别铺到 `src/**`**（禁止面）。
4. **任务2／任务3 的两个基线数都是【沿用】，动手前必须本批复量**：CLS 0.1245 与「<12px 文本节点 444/633」都来自外部审计，本仓没有可复跑的读数。复量前不许写「显著改善」——否则没有对照基线。CLS 需要真窗口/真浏览器（仓外工装 `D:/Pinax-main/_tools/` 那套可复用，见批次73 工单头），这条与「不起 Electron」的边界冲突，要作者点头（同 67 §9 第 5 条）。
5. **字号刻度已有半张表**：67 §9 第 2 条实测过 `next-shell.css` 里已存在 `--nx-fs-2xs:11px`／`md:13px`／`lg:15px`／`xl:17px`／`2xl:19px`（缺 `xs`／`sm` 两档）。本批任务3「无意图的小字号归位到最近刻度」——**11px 这一档本身是已登记意图的角注档**（源码注释写着「角注：meta 行、警告、折叠标签」），别把它当违规值归位上去；444 个节点里有多少落在这五档之外，要靠复量分布说话。
