# 批次62 工单：命令面＋手势（Obsidian 框架轮·桩1）（2026-11-02）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。工单源：`electron-obsidian-framework-plan-20261102.md` §6 桩1＋§11 批次62；前置裁定 Q3 已裁（台账在案）。
> 背景（调研 F2/F3）：命令合同与取口已埋好（校验器/registry.commands()/menu:invoke 封闭 id 集），但 11 份清单 commands 0 声明、渲染层 0 消费、快捷键 39 处散注册——插座埋好、电器为空。本批把电器装上，**只镜像既有动作，不新增行为**。

## 任务（六条）

1. **11 份清单补 `contributes.commands`**：每块 3–6 条、全量 40–55 条，**只镜像既有动作**（如 novel：新建章/导出当前/整本导出/提案审阅；worldbook：新建条目/切换视图；dossier：资料检索/约束编辑…每条命令的 run 落到既有动作通路——menu invoke id 或既有函数，映射表写进清单注释）；id 用载体命名空间（`<carrier短名>.<动作>`），title ≤60 字中文。
2. **命令通道**：`ipcContract.mjs` 扩 `command:list`（返回全部命令：应用菜单动作 ∪ registry.commands()，含 id/title/owner/快捷键）；`menu:invoke` 的 id 集来源从 `flattenMenuIds(MENU_TEMPLATE)` 扩为 **MENU_TEMPLATE ∪ registry.commands()**（:314 一处改）——未知 id 拒绝行为保持。
3. **CommandPalette.vue（新）**：`Ctrl+P` 唤起（Q3 裁定；提案审阅 accelerator 改 `Ctrl+Shift+R`，menus.mjs:28）；模糊搜索（子串包含先行，不做拼音）；回车执行经 command 通路；列出应用菜单动作＋载体命令＋当前焦点页可用动作；Esc 关闭走统一二级页既有焦点陷阱。
4. **hotkeys.mjs（新）＋`.pinax/hotkeys.json`**：读写持久化、**冲突即拒并记账**（serviceLogPool warn）；只收编高频 3–5 项（Ctrl+P 面板/提案审阅新键/Esc 关窗），**不全量重构 39 处 keydown**；hotkeys.json 坏文件回默认并记账（照 settingsStore 模式）。
5. **手势接通（批次61 预留的 gesture 形参）**：`resolveOpenTarget` 不再恒 block——两入口：**Alt+点击**竖条图标/页签＝以浮窗态开（gesture:{form:'floating'}）；**中键点击**页签＝关窗（gesture:{action:'close'}）。语义写进 openTarget 注释与 spec v2 附录一行；每入口 ≥1 断言（含「手势参数到 openTarget 的路由」与「界面确有入口传值」）。
6. **记账断言（不打回）**：acceptance 记账段加两条——命令表非空且每条可解析 commandOwner；命令 id 命名空间与 forms 词表无冲突。

## 允许文件

11 份 `next/carriers/*/manifest.mjs`（仅 commands 声明）、`next/shell/ipcContract.mjs`、`next/kernel/pluginRegistry.mjs`（如需 commands 透传修饰）、`next/shell/CommandPalette.vue`（新）、`next/shell/hotkeys.mjs`（新）、`next/shell/menus.mjs`（Q3 键位）、`next/shell/openTarget.mjs`（gesture 消费）、`next/shell/AppNext.vue`（palette 挂载＋手势入口）、`next/shell/workspace.mjs`（如 gesture 需要窗态入参）、`next/shell/styles/next-shell.css`（palette 样式）、`docs/plan/pinax-electron-next-spec-v2-20261102.md`（手势附录一行）、`next/tests/`＋受影响 spec、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（计数写理由）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

**不新增任何行为**（命令只镜像既有动作——评审会逐一对照）；不动协议 schema（commands 校验 @4 已有）；不动写族闸/文件服务/expectedRevision；**第三方 JS 不开**（Q4）；不动 `server/**`、`src/**`；不加 npm 依赖；39 处散 keydown 只收编点名的高频项其余不动；不起 Electron、不执行 git。

## 守卫标记

批次45–61 全清单继承；本批新守卫：command:list 通道在合同、CommandPalette 组件存在、hotkeys.json 读写用例、gesture 非 block 路径断言、提案审阅键位 Ctrl+Shift+R。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿；palette 枚举数＝菜单动作 ∪ registry.commands() 且每条可执行；hotkeys 持久化跨实例；gesture 两入口断言；记账两条进 acceptance。

## 记账指标（不进闸）

命令总数与逐载体分布；hotkeys.json 首版内容样例。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch62-20261102.md`；§8 调度方补；diff 指引用临时索引法；**命令镜像对照表**（命令 id→既有动作落点）必须进批次记录——评审逐条对照「不新增行为」。

**§7 执行方回填（2026-11-03，Qoder CLI）**

- 批次记录已落盘：`docs/plan/pinax-electron-next-m2-batch62-20261102.md`——§2 是 53 条命令的**镜像对照表**（id→`run`→既有动作 file:line，另附七个动词各自的既有界面入口），§7 是 limitations 七条。
- 六条任务全部落地；`npm run verify:next` **五段全绿 `EXIT=0`**（acceptance 全过 · node:test 689/689 · vitest 14 文件 196/196，含 `shell-ui.spec.mjs` 85 例 · `lint:next` 零告警 · bundleAssertions 全过）。
- 验收判据逐条：palette 枚举＝`commandTable()` 一条口径（菜单 19 ∪ 载体 53＝72，`command-face.test.mjs` 钉住）；每条可执行＝动词闭集＋每个动词指得到 `AppNext` 里既有的落点函数；hotkeys 持久化跨实例（Map 存储 fake 出往返，且「冲突写入被拒后文件字节不变」有断言）；gesture 两入口各有「参数到 openTarget 的路由」＋「界面确有入口传值」两类断言；记账两条进 acceptance，实数见批次记录 §6。
- `bundleAssertions.mjs` **一处计数未改**，理由写在批次记录 §6（commands 不动 pane/tool/描述符任何一面）。
- 两处顺带修出的真缺陷：`matchHotkey` 原来对 `CmdOrCtrl+…` 在 Windows／Linux 永不命中（Ctrl+P 唤不起面板）；`findHotkeyConflicts` 原来按字符串比，`CmdOrCtrl+K` 与 `Ctrl+K` 的冲突会漏（留下按不出的死命令）。
- 唯一实质缺口＝`.pinax/hotkeys.json` 的真落盘需改 `main.mjs`（不在允许文件内），今天两条通道如实报缺；详见批次记录 §7 第 1／2 条。）
