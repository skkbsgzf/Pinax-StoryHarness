# 批次72 工单：命令面与键位闭环（2026-11-02）

> 调度方工单（独立可执行）。来源：批次62 记录的剩余四条（键位只有读口没有界面、三条动作没上命令面、手势钩子没有断言、面板过滤只做子串）＋批次63 的白名单遗留。目标②「1＋N 多形态切换丝滑」的入口面全在这里。
> 基线：批次69 收口点（开工时以 git log 现查为准）。
> **红线**：命令面是「入口」，不是新语义——每条命令必须落到既有动作上；不新增形态词、不动窗口系统与写族闸。

## 任务（五条）

1. **快捷键设置界面（写侧收口）**：现在只有读口——`AppNext.vue:1916 hydrateHotkeys()` 经 `hotkeys:load` 取表，`hotkeys.mjs:441 applyBinding()` 与通道 `hotkeysSave`（id 在 `ipcContract.mjs:107`、分发分支在 `:520`）都齐了，但**没有任何 UI 触发点**（实测：`next/shell/settings/**` 内 `hotkey`／「快捷键」／「键位」0 命中）。在统一设置二级页加「快捷键」一节：列表现表、按 modifier＋键改绑、冲突即拒并提示占用者、保存到 `.pinax/hotkeys.json`（落盘口已有：`main.mjs:656 hotkeysStoreFor()`）。**曾被删掉的 `rebindHotkey()` 逻辑要重做得有消费者**，别写第二个孤儿函数。
2. **三条动作上命令面**：新建章／新建条目／资料检索（现依赖 `IndexWindow.vue` 的草稿行与搜索框）。【实测基数订正】命令表今天共 **72 条＝19 条应用菜单＋53 条载体声明**（我原先按 53 记账，只数了 manifest 那一半；`outline.new-draft` 是「新建大纲」，不等于正文新建章）。上表后每条要能被命令面板真执行，且归属可解（沿用批次62 的 `commandOwner` 判据，72 条起点记进记录，不硬钉总数）。
3. **手势钩子进断言**：壳层靠 `.nx-page-tab[data-page-instance]` 与 `.nx-ribbon-item[aria-label]` 认 Alt＋点／中键的目标（`AppNext.vue:1875`、`:1891`、`:1902`）。【实测】前者全 Next 只 **5 处**（`AppNext.vue` 4＋`PaneTabStrip.vue` 1），`visual-contract.test.mjs` 对这两个钩子只有一行沾边、**没有专条断言**。竖条这一支的风险比「静默失效」更具体：它拿 `aria-label` 的**文本**反查板块（`AppNext.vue:1893 boards.find((b) => b.title === title)`），而 `ActivityRail.vue:59` 的 `aria-label` 正是 `board.title`——**两个板块同名就会静默打开第一个**，不是失效；未装载载体的占位格（`:103`）也用同一个 class，撞名同样进这一条查找。补两条正向断言（选择器存在＋`aria-label` 与板块标题一一对应、不重名），把这根线钉住。
4. **命令面板过滤升级**：现只做子串。补模糊子序列＋拼音首字母＋按最近使用排序（纯前端函数，`next/shell/` 内自带单测；不引第三方模糊匹配库——本批禁止加依赖）。
5. **散 keydown 出账**：【实测订正】散 keydown/keyup 处理点是 **41 处 / 10 文件**（`IndexWindow.vue` 23、`CarrierPaneHost.vue` 6、`AssistantDialog.vue` 3、`AppNext.vue` 2、其余 6 文件各 1-2；`hotkeys.mjs` 自己的 2 处在册），批次62 记的 39 是旧口径（不同 grep 样式）。本批**不改代码**，产出一张「哪个组件、哪个键、是否与命令表重复」的清单进记录，作为后续收编的输入。

## 允许文件

`next/shell/settings/**`（新节）、`next/shell/hotkeys.mjs`、`next/shell/AppNext.vue`（设置页组件表＋命令表调用）、`next/shell/CommandPalette.vue`、`next/shell/IndexWindow.vue`（三条动作的落点）、`next/carriers/*/manifest.mjs` 的**命令声明段（只加 commands，不动其他字段）**、`next/tests/**`、`docs/plan/**`。

## 禁止边界

不动 `PANE_FORMS`／形态语义／`single`·`keyed` 判据；不改窗口系统与写族闸；不加 npm 依赖；不改 `server/**`、`src/**`；不起 Electron、不执行 git；键位白名单沿用批次63 的 `STANDALONE_KEYS`，要放宽是另一条裁量（`PrintScreen`/`ScrollLock` 仍不进表，除非作者点名）。

## 守卫标记

批次45–70 全清单继承；本批新守卫：设置页存在「快捷键」节且写侧真落盘（读回一致）、两条手势钩子选择器断言、命令面板过滤函数单测（模糊/拼音/排序三档）。

## 验收判据

`npm run verify:next` 五段全绿；改一次键位→重启→键位仍生效（jsdom 层可用假桥验，真机一致性随调度方实览）；三条新命令在面板里可搜到、可执行、归属可解；5 项任务各有对应用例或记账表。

## 记账指标（不进闸）

命令表条数变化（起点 **72＝19 菜单＋53 载体**，实测）；键位表在册可改绑 id **3 个**（`bindableIds()` 实测＝`palette.open` `CmdOrCtrl+P`／`workspace.collapse-top` `Esc`／`project.reviewProposals` `CmdOrCtrl+Shift+R`，`defaultBindings()` 同为这 3 条）——界面今天只有三行可改，这是本批的真实起点，不是 72；用户实际改绑次数（应为 0，量到的 0）；散 keydown 清单（**41 处 / 10 文件**的逐条归属）。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch72-20261102.md`；§8 调度方补。）
