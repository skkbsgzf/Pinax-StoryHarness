# 批次68-R4 执行记录：设置信息架构与文案收敛（UX 全扫·设置侧）（2026-11-07）

> 工单：[pinax-electron-next-m2-batch68r4-ticket-20261107.md](./pinax-electron-next-m2-batch68r4-ticket-20261107.md)
> 执行方：Qoder CLI（实现工程师）。基线：工单下达时的 master 工作树（不执行 git 命令，未启停 electron）。

## §7 执行方回填

### 7.1 任务1 导航分组重构（发现 1）

落点全部在 `next/shell/SettingsModal.vue`（没有越界改 `AppNext.vue` 的注册表）：

- **新增 `declaredGroupSize`**（SettingsModal.vue:163-172，`groupedSections` 的 `labeled` 见 :184）：组头去留的判据取**声明结构**里这一组的节数，
  不取搜索过滤后的可见数。理由：搜「备份」时「应用」组只剩一格可见，那是查询滤出来的临时形状，
  组头跟着消失会让作者以为应用类设置真的只剩备份这一项——`shell-ui.spec.mjs` 把「搜『备份』仍出『应用』」钉成规格，
  这一条不能为了拍平而放宽。
- **单节组拍平**：`groupedSections` 给每组带 `labeled = 声明节数 >= 2`；模板里组头改成
  `<p v-if="group.labeled" class="settings-group-label" aria-hidden="true">`。
  实况：`next/carriers/*/manifest.mjs` 里只有 novel 声明了一节（`novel.writing` 写作偏好），技能组内置一节（技能库），
  所以**「技能」「载体」两个组头不再出现**，「技能库」「写作偏好」直接是一级页面项。
- **「应用」组头保留**（工单任务1 那句「同义才删」）：它底下是三节（偏好与模型／备份与恢复／服务与通知），
  与任何单节都不同义，不是排版赘物。「项目」4 节、「文档」4 节同理保留。
- **组头是纯视觉层**：本体一直是 `<p aria-hidden="true">`（不是 tab、不进 tab 序列、无 click、不参与 roving tabindex）；
  本轮把视觉区分做硬：`--nx-fs-2xs` 保持、色 `--text-muted`、字距 `0.06em → 0.12em`、`font-weight: 600`、
  外加 `cursor: default` 与 `user-select: none`（SettingsModal.vue:354-365）。
- **拍平项的分隔**：单节组没有组头指路，直接排在「文档」组尾巴后面会被读成那一组的续行；
  给 `.settings-tab.is-standalone` 一段 12px 上空隙（组内 gap 是 4px，12 是本文件已在用的档），
  把「这是一级项」画出来而不加新的形状；窄屏（≤640px）目录是一行横条、组头本就 `display: none`，
  这一档空隙在那里归零——分组在那一屏不可见，单独给两项加线是半调子的假信号。
- **ui-style-check 四问**（本轮改的是设置弹窗左栏这一条）：`narrative role`＝二级配置面的目录（transition/settings）；
  `viewing distance`＝笔电距离、184px 窄栏，小字组头＋40px 行本来就为这一距离设的；`visual temperature`＝quiet/operational，
  所以区分手段只用字距、muted 色与空隙，不引入新色与新形状；`capacity`＝16 行仍在 720 高里滚得下，`overflow-y: auto` 原样。
  色值只用 token（`--text-muted`），不新增断点，`--nx-fs-2xs` 沿用。
  **视觉实况未验**：不许启停 electron，本轮没有截图，判据只有 DOM 与源码级；请调度方复拍。
- 键盘：方向键/Home/End 仍只走 `visibleIds`（组头不是项），未改语义。

**导航项数前后**（同一实盘状态：打开 novel 项目、11 块载体在册）

| 口径 | 改造前 | 改造后 |
|---|---|---|
| 组头行 | 5（应用／项目／文档／技能／载体） | 3（应用／项目／文档） |
| 页面项（可点） | 13（静态 11 ＋ 技能库 ＋ 写作偏好） | 13 |
| 左栏总行数 | 18 | 16 |
| 组头可点落点 | 0（本就是 `<p>`；工单 dump 的 15 项口径＝5 组头＋10 页面项，本轮以源码注册表实况清点，差异记在此） | 0 |
| 未打开项目时 | 4 组头＋12 项 | 3 组头＋12 项 |

### 7.2 任务2 逐节文案收敛（发现 2–6）＋ ⑲ 判据扩展

逐文件（每处都是「机制细节退到 title／折叠，正文留一句白话」；控件主位与确认钮动词未动）：

| 文件 | 改了什么（前 → 后） |
|---|---|
| `settings/PrefsSection.vue` | 「检测模型面」→「检测模型服务」；探测三态改口为「模型服务就绪／可达但还没有可选的模型／不可达」，**`serve:pinax`×2、`pi-agent`×1、「任务面」×2 全部退出常驻句**，机制进结果行的 title；行标签「模型面端点」→「模型服务端点」；hint「与老前端共用同一份偏好，改了那边也跟着变」→ title，正文换作者视角「选完立刻换肤，不用保存」；hint「0.5–2.0，保存即生效」→ 数字框 title；端点框补 title「留空回到默认端点；模型凭据仍由模型服务自己持有」。 |
| `settings/ServicesSection.vue` | 节首句去掉「确认只记在这台机器上」（存储口径）→ title；正文改「这里看服务和外部连接当前通不通、最近日志，以及有没有等你确认的通知。」；「状态变化会从池里推过来」→「状态一变，这一行会跟着更新」；「这条时间之前的通知都不再计为未读」→「这之前的通知不再算待确认」；无桥兜底「IPC 桥未接入」→「这一格没连上本地服务。」 |
| `settings/OutlineImportSection.vue` | 「正在扫描 大纲/ …」→「正在扫描大纲目录…」（路径词退场）；「现有节点已覆盖这些章节稿（重跑幂等，不会重复追加）」→ 正文只留前句，「重跑幂等」进 title；无桥兜底与「通道 x 调用失败」→ 白话兜底。 |
| `settings/SkillsSection.vue` | 「这一格还没接上系统的选目录对话框，先手工粘一个绝对路径」→「还没接上系统的选目录对话框：粘一个技能包目录的绝对路径，再点上面的『导入到本项目』」（指路同时给动作）；空态括注「工具面还没装配，装载校验做不了」→「技能服务还没就绪，暂时校验不了」；「技能通道没有回结果」→「技能服务没有回结果。」；「IPC 桥未接入」→白话。 |
| `settings/WritingPrefsSection.vue` | 四条数值 hint（14–22 整数／1.6–2.4 步进 0.05／0–2em 步进 0.1／0–2em 步进 0.5 及各档默认）从正文移到对应输入框的 title——与发现 2 对「0.5–2.0，保存即生效」的判法同一把尺；两个开关的效果句（「光标始终停在视口偏上…」「只突出光标所在段落…」）是作者语言，留在正文。 |
| `settings/BackupSection.vue` | 复核 R3 落地：节首一句 27 字 ＋ `<details class="nx-note-details">` 折叠，`.pinax/history.git`／`backup-manifest.json` 只在 title 与折叠里——口径在，未重做；只把无桥兜底与「通道 x 调用失败」两句行话换白话。 |
| `settings/ExportSection.vue`／`HistorySection.vue`／`ImportSection.vue` | 无桥兜底「渲染层未接主进程桥（preload 的 pinaxNext 通道）」→「这一步没连上本地服务，暂时办不了。请重启应用后再试。」；History「这一面还没接上写回文档的通道」→「这一格还没接上把旧版本写回文档的能力」；Import 正文「执行会按计划落盘」→「执行会按计划写进项目」。 |
| `SettingsModal.vue` | 目录本体常驻话复核：空态「该载体的设置项还没有内容」是诚实空态（B9 口径，白名单在册），搜索无命中两句是白话，未加说明性空话。 |
| 未动 | `CarriersSection.vue` 行内「权限：…／工具 N／数据目录」是**读数层**（`shell-ui.spec.mjs:2562-2570` 钉着），不是解释性文案；发现 6 的确认钮动词与弹窗右上「关闭」一律保留。 |

**机制 token 常驻命中前后**（机判口径＝⑲ 的 token 表，扫 `settings/*.vue` ＋ `SettingsModal.vue` 的模板与脚本字面量）

| 面 | 前 | 后 |
|---|---|---|
| `serve:pinax`（常驻可见句） | 2 | 0 |
| `pi-agent`／「任务面」 | 1／2 | 0 |
| 「模型面」（与按钮不同词表） | 4 | 0 |
| `.pinax/`／`.json`／`backup-manifest`／`history.git`／`dryRun` | 0（R3 已清零，本轮防回潮） | 0 |
| 行话兜底句（渲染层／主进程／桥／IPC／通道／幂等／落盘／装配／路径词「大纲/」／数值范围 hint） | 24 处 | 0（脚本扫 `settings/*.vue`＋`SettingsModal.vue` 模板与脚本字面量，命中表空） |
| title／折叠里的机制细节（许可落点） | — | 保留：prefs 33／carrier-generic 60／history 34／import 89／outline 55／services 39 字等 |

**每节说明字数前后**（可见正文一句，不含 title／不含插值）：15 节实测 12–34 字，
本轮只有两处变动——ServicesSection 31 → 34 字（存储口径换成「能不能连上、有什么等你确认」的作者说法；变长的是白话，变短的是机制），
SkillsSection／OutlineImportSection 等 13 节节首句未动（BackupSection 复核通过）。
数值 hint 那一类的长度变化在表里按「正文 → title」的位移计（如 WritingPrefs 四行 −25 字常驻）。

### 7.3 任务3 回归与门禁

`next/tests/**` 改动（等强度重写，不放宽）：

- `shell-ui.spec.mjs:3312-3328` —「组标题」断言从 `labels.slice(0,3)` 收紧为 `toEqual(['应用','项目','文档'])`，
  并新增四条：组头是 `P`、无 `role`、`aria-hidden="true"`、无 `tabindex`（把「组头不是可点项」钉成机器判据）。
- `shell-ui.spec.mjs:3410-3413` — 拍平后的结构：`labels === ['应用','项目','文档']` ＋ `.settings-tab.is-standalone` 必须含「技能库」「写作偏好」。
- `shell-ui.spec.mjs:3410` 原位替代了旧判据「组头里有『载体』」（本轮结构改动的直接对立面），
  同用例原有「写作偏好在册／不伪造『小说（夹具） 设置』／`settings: []` 的载体不出格」三条一字未松。
- `shell-ui.spec.mjs:2082` — 探测结果句 `toContain('模型面不可达')` → `toContain('模型服务不可达')`，
  并加两条负断言：结果句与整节文本都不许再出现 `serve:pinax|pi-agent|任务面`。
- `skills-section.spec.mjs:166-172` —「没有桥也照常渲染」用例：钉的新句 `这一格没连上本地服务`，
  外加负断言 `not.toMatch(/IPC|桥|通道/)`；原「页面不白屏」的判据保留。
- `visual-contract.test.mjs`
  - 门禁⑮ 未动；门禁⑱ 未放宽（SkillsSection 改写后的句子不再触词根，白名单无僵尸条目——那条 stale 检查照样跑）。
  - **门禁⑲ 扩展面登记**：扫描面从「`settings/*.vue` 的 `<template>`」扩到 ①`SettingsModal.vue` 目录本体 ②各文件 `<script>` 的字符串字面量
    （R3 只看模板，把常驻句写在 `computed` 里就能绕过——PrefsSection 的探测三态句正是这一形态）；
    token 表新增 `pi-agent／任务面`、`模型面` 两条；脚本侧只查**含汉字**的字面量，
    `'outline.json'`、`payload.dryRun` 这类逻辑常量与标识符不在这一面（判据按「上屏的话」划）。
    取样器 `collectLiterals` 逐字走脚本：注释跳过、`'http://127.0.0.1'` 里的 `//` 不当注释、模板串 `${}` 里嵌套的字面量并回同一句
    （否则一句被插值截断，后半句的机制词就从闸下溜走）。
  - 「统一设置二级页」用例新增三条源码级判据：组头必须是有条件的静态 `<p aria-hidden>`；拍平判据写在声明结构上；
    不许回潮成无条件 `<p class="settings-group-label"`。

**`npm run verify:next` 五段读数（EXIT=0，全部达标／只增不减）**

| 段 | 基线 | 本轮 |
|---|---|---|
| 验收 `acceptance.mjs` | 44/44 | 44/44 |
| 内核单测 `node --test next/tests/*.test.mjs` | 830/830，fail 0 | 830/830，fail 0 |
| 界面 `vitest`（16 files） | 242/242 | 242/242 |
| `eslint next --max-warnings 0` | 0 warning | 0 warning |
| 打包门禁 `bundleAssertions.mjs` | 全部通过 | 全部通过 |

计数持平的解释：本轮是**结构改动 + 判据扩展**，不新增用例文件；两条被结构改动钉住的旧用例改成钉新结构（等强度），
⑲ 的断言数从 1 条正向扩到 3 条正向＋双扫描面，token 表 6 → 8 条。要「读数增长」须往门禁里塞冗余用例，那与「不新增只镜像实现的测试」相冲，记在此请调度方定。

### 7.4 limitations（做不到／越界未做）

1. **真窗复拍没做**：不许启停 electron，验收判据①②③改由 DOM 断言（`shell-ui.spec.mjs`／`skills-section.spec.mjs`）
   ＋源码门禁（`visual-contract.test.mjs` ⑲／统一设置二级页）代跑；请调度方按 ux-sweep 复拍 `set-00..12`。
2. **`AppNext.vue` 不在允许文件**：`settingsSections` 的 keywords 里仍留着旧词「模型面端点」（prefs 那条）。
   影响：搜「模型面」仍能命中这一格（旧词在册是好事），搜「模型服务」目前靠 title 之外的字段命不中——
   需要把 `模型服务` 加进 keywords，请调度方批准越界一行（或与 R5 并批）。
   组头/节名本身不需要改注册表：拍平完全在 `SettingsModal.vue` 里按声明结构算。
3. **运行时／主进程透传的上游句子还在行话**，且不在允许文件：
   模型不可达那句「未检测到可用模型。请先启动 pi-agent 任务面（serve:pinax）…」（`next/runtime/runnerAdvisor.mjs`，
   由 `runtime-context-runner.test.mjs:287` 钉成「原话透传、不替模型编」的诚实边界）、
   技能 `surface.note`「运行时尚未就绪：装不上的原因是工具面还没装配」（`skills-settings.test.mjs:295` 钉）、
   主进程那句「技能服务未接入（主进程未创建 skillsService）」（`next/shell/ipcContract.mjs`）。
   这三处要换词表得连钉子一起改，属下一批范围；本轮只保证**设置面自己写的句子**干净。
4. **`styles/next-shell.css` 未改**：组头与拍平项的度量放在 `SettingsModal.vue` 的 scoped 样式里（该文件在允许面），
   布局层没有新增共享类；`.nx-note-details` 沿用 R3 的落点。
5. **存储键／通道／IPC 语义零改动**：本轮没动任何 `IPC_CHANNELS.*` 调用、payload 字段（含 `dryRun` 参数名）与偏好键。

### 7.5 越界登记与状态交接

- **越界文件：0。** 本轮改动落在 `next/shell/SettingsModal.vue`、`next/shell/settings/*.vue`（9 份）、
  `next/tests/shell-ui.spec.mjs`／`skills-section.spec.mjs`／`visual-contract.test.mjs`、以及本记录文件——全在工单允许面内。
  `styles/next-shell.css` 允许但没动（度量放在 SettingsModal 的 scoped 样式里）。
- **`docs/STATUS.md` 没改**：工单允许文件不含它，且分工裁定里状态行与提交归调度方。
  待调度方验收（§8）后按 handoff 口径把 R4 从「待执行」改写成「已实施＋真实读数」，
  §7 就是那一行的证据出处（44/44 · 830/830 · 242/242 · eslint 0 · 打包门禁全通过 · EXIT=0）。
- 没执行任何 git 命令，没启停 electron，没加依赖，没动保存通道／存储键／IPC 语义／68-R1 字体口径／workspace 状态轴。

---

## §8 调度方验收

（待 Zcode 填写：真窗复拍三判据 ①组头不可点／无重复落点 ②偏好节一句白话无 `serve:pinax` ③十四节 dump 无机制 token；以及 limitations 2、3 的越界批准与否。）
