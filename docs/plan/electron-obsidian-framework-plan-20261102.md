# Electron-Obsidian 式框架：正确的搭法、我们的差距、断层清单与方案（2026-11-02）

> 范围：只读分析。**本轮没有改动任何一行界面或内核代码，没有 commit。**
> 作者口径（三条目标不变）：① Obsidian 式高可玩性 Doc 栏　② 1＋N 多形态切换 UX 丝滑可用　③ 所有设计语言统一且简洁。
> 证据来源：`next/` 工作树源码实测 ＋ 本机安装的 `obsidian.asar` 字面量实测 ＋ 上一轮外部工具审计 [`external-tool-audit-rea-impeccable-opendesign-20261102.md`](./external-tool-audit-rea-impeccable-opendesign-20261102.md)。所有计数口径见 §9。
> 配套规范：本文只补"框架该怎么搭"，视觉与界面层的缺口不重复展开，直接引用审计报告。

---

## 1. 结论先行

**我们的框架不是"搭错了"，是"搭到一半停了"。** 内核层（合同、校验器、能力闭包、注册表）已经比 Obsidian 更规整，但支撑"可玩性"的三张公共表我们只有半张，且**从磁盘装载插件的通路是零**。以下五条是本轮实测的硬结论，每条都有出处。

**一、目标①的真正缺口是"没有命令面"，不是"Doc 栏不够漂亮"。** Obsidian 的可玩性有非常具体的技术底座：`obsidian.asar` 里 `addCommand` 字面出现 **151 次**、`registerViewType` **17 次**、`addSettingTab` **26 次**、`registerHoverLinkSource` **18 次**、`registerCliHandler` **46 次**，`workspace.on(` 收敛出 **21 个事件名**（`active-leaf-change`／`file-menu`／`layout-change`／`hover-link`…）。这是一套"任何功能都能被枚举、被搜索、被绑定快捷键、被卸载时自动摘除"的公共设施。我们这边：`CommandPalette`／`命令面板`／`statusBar`／`状态栏`／`QuickSwitcher`／`hotkey` 在 `next/` 里的字面命中**全部为 0**，键盘处理是 `next/shell` 里 **39 处各自注册的 `keydown`**，没有注册表。

**二、讽刺的是命令的合同已经写完了，只是没人坐进去。** `contributes.commands` 的校验器是齐的（`next/kernel/carrierManifest.mjs:430-462`，字段限定 `id`／`title`／`run`，id 有正则闸、title ≤60 字、重复 id 直接拒），归一后还提升到清单顶层（`:296`）；注册表甚至开了两个取口 `registry.commands()` 与 `registry.commandOwner()`（`next/kernel/pluginRegistry.mjs:268-281`）。**但 11 份真清单里 `commands` 声明 0 处**（`grep commands next/carriers/*/manifest.mjs` → 0 命中），渲染层 0 处消费——这个取口目前只在内核单测的假清单里被验证过（`next/tests/manifest-v2.test.mjs:184`）。这是典型的"插座已埋、电器为空"，所以补命令面是全案里**成本最低、收益最大**的一根桩。

**三、"可插拔"只写在规范里，没落在代码里。** 规范 v1 第 2 节把载体定成"二级公民＝插件边栏"（`docs/plan/pinax-electron-next-spec-20261027.md:40-44`），代码这边 11 块载体是**静态 import 的冻结数组**（`next/carriers/index.mjs:2-31` 逐条 import、`:201` `BUILT_IN_CARRIER_PLUGINS = Object.freeze([...])`）。全仓 `next/kernel`／`next/carriers`／`next/runtime`／`next/index.mjs` 里**没有任何一处 `readdir` ＋ 动态 `import()` 的装载路径**（grep 零命中）。唯一接近的是 `.pinax/carrier-overrides.json`（`next/carrierOverridesStore.mjs:7,30`），那是"覆盖已有载体的面板/服务/设置值"，是**覆盖不是装载**。后果是加一块载体要动 9 处（新目录四件套 ＋ `carriers/index.mjs` 的 import/信任常量/工厂/数组/认领表/再导出 ＋ `kernel/capabilities.vocab.mjs` ＋ `shell/viewRegistry.mjs:43-49` 绑定 ＋ `shell/layoutTemplates.mjs` 推断 ＋ `kernel/projectSkeleton.mjs` 目录 ＋ 打包拷贝 ＋ 门禁计数），而门禁把数量**写成了断言**：`next/testing/acceptance.mjs:361` `BUILT_IN_CARRIER_PLUGINS.length === 11`。Obsidian 的对照面是：`.obsidian/plugins` 扫盘、`manifest.json` 装载、`minAppVersion` 版本闸、`core-plugins.json` 与 `community-plugins.json` 分别开关、卸载自动 `removeCommand`。

**四、规格沟通断层是系统性的，而且方向一致：文档落后于代码，代码注释落后于代码。** 规范 v1 第 3 节描述的是 `pinax-carrier@1` 的字段名（`capabilities`/`scopes`/`panes`），代码今天写侧是 `@4`，`@2` 那轮已把 `capabilities→provides`、`scopes→permissions`、`panes→contributes.panes`（`next/kernel/carrierManifest.mjs:46-56`，读侧仍兼容 @1），**文档从未回写**。同一件事连内核注释都没跟上：`carrierManifest.mjs:149,465,476` 三处写"宿主六种视图"，而 `next/shell/viewRegistry.mjs:21-33` 实际枚举 **8 种宿主视图 ＋ 1 种 custom**（批次44 加了 `board`/`app`，注释没改）。更深一层是**状态轴的词表比实现大**：协议形态词表有五个值 `dock|split|overlay|fullscreen|immersive`（`next/shell/paneForms.mjs:16`，且被写进给外部读的 `next/host-descriptor.json` 的 `forms`），v3 状态机只有三个落点（`paneForms.mjs:19-24` 的 `FORM_ACTIONS` 只到 dock/side/float；`next/shell/workspace.mjs:38` 的 `PAGE_FORMS = ['page','floating','tab']`），后果可量化：**25 处 pane 声明里 23 处 advertise `fullscreen`、13 处 advertise `immersive`，而这五个词在菜单里点不出来**（作者 §7 待裁④ 至今未裁）。

**五、因此"正确的搭法"不是把三栏做得更像 Obsidian，而是补三样东西：一张可枚举的命令表、一条从磁盘装载的通路、一份状态轴与词表同构的形态合同。** 视觉与交互层的账（token 覆盖 3.0%、`--text-muted` 一名四值、切载体 CLS 0.1245、444/633 个文本节点 <12px）已在上一份审计里量化完毕，本文只把它们当作 L5 层的既有欠账引用，不重复裁定。

---

## 2. 参照系：Obsidian 的桌面框架到底靠什么撑住可玩性

对象：`C:/Users/Administrator/AppData/Local/Programs/Obsidian/resources/obsidian.asar`（24,060,763 B，实测于 2026-11-02，`grep -a` 字面计数）。下表右列是同一口径下我们 `next/` 的实测值。

| 设施 | Obsidian（asar 字面命中／结构） | Pinax Next（源码实测） | 差距性质 |
|---|---|---|---|
| 视图类型表 | `registerViewType` 17 处；id 是平铺字符串：`file-explorer`/`search`/`graph`/`localgraph`/`backlink`/`outgoing-link`/`outline`/`tag`/`canvas`/`bookmarks`/`footnotes`/`all-properties`/`file-properties`/`webviewer`/`sync` ＋ `markdown-source-view`/`page-preview`/`switcher`/`empty` | 8 种宿主视图＋第三方只许 `pinax.view.custom` 一个名（`next/shell/viewRegistry.mjs:21-33`、`carrierManifest.mjs:140`） | 我们的口更紧，且 custom 不跑第三方代码（`host-descriptor.json:6` `trustMode:"same-process"`）——不是缺陷，是**尚未裁的沙箱决定** |
| 命令表 | `addCommand` 151；id 自动命名空间 `manifest.id+":"+id`、显示名 `manifest.name+": "+name`、卸载自动 `removeCommand` | 合同齐（`carrierManifest.mjs:430-462`）、取口齐（`pluginRegistry.mjs:268-281`）、**真清单 0 声明、0 消费** | **断层**，第一优先 |
| 设置面 | `addSettingTab` 26；`app.json`/`appearance.json`/`hotkeys.json`/`types.json` 分文件落 `.obsidian/` | `SettingsModal.vue` 319 行＋`shell/settings/*.vue` 13 节＋载体 `contributes.settings` 被 `carrierOverridesStore.mjs:367` 消费 | **我们做对了**，缺的只是"每块载体的设置节自动出现并可复位"的回归断言 |
| 状态栏 | `registerStatusBarItem` 9 处，元素挂 `plugin-<id>` 类 | 0 命中；最接近的是 `ActivityRail.vue:65` 与 `RuntimeDock.vue` 的服务灯 | **断层**：没有"我现在处于什么状态"的常驻位 |
| 命令面板／快速打开 | 二者都是**核心插件**（id `command-palette`、`switcher`，`defaultOn`），命令 `command-palette:open` | 0 命中 | **断层**，与命令表同时补 |
| 快捷键 | `hotkeyManager`、`Mod-` 字面 37 处、`hotkeys.json` 落盘可编辑 | accelerator 只硬写在 `shell/menus.mjs:19-32`；`next/shell` 里 39 处独立 `keydown` | **断层**：不可重绑、无冲突表、不可持久化 |
| 插件装载 | `.obsidian/plugins` 扫盘（`getPluginFolder()`，configDir=`.obsidian`）；`manifest.json` 48 处；`minAppVersion` 版本闸；`isDesktopOnly` 平台闸；`core-plugins` 8／`community-plugins` 17 | 无装载路径；内置数组冻结（`carriers/index.mjs:201`）；`runtime/pluginDirs.mjs:9-21` 有 `overrides` 形参但**没有任何外部调用方喂目录** | **核心断层** |
| 核心／社区二分开关 | 显式 26 项内部插件 id 数组＋`core-plugins.json` 的 id→bool＋自愈 `patchCorePluginsFile`（"Fixing core plugins list"） | 11 项内置＋项目级 `carriers{primary,enabled}`；启停过 D3 闭包 | 结构对齐，缺"停用全部后运行时仍可用"的**故障隔离回归** |
| 布局树与持久化 | `getLayout()` 序列化 `{main,left,right,"left-ribbon",floating?,active,lastOpenFiles}`；节点 kind 校验接受 `true\|"tab"\|"window"\|"split"`（递归 Split）；`saveLayout` 写 `workspace.json`（移动端 `workspace-mobile.json`），**debounce 1000ms** | `.pinax/workspace.json` v3 四轴：group(`main\|side`)／order／form(`page\|floating\|tab`)／resource ＋ `active`/`focus`（`workspace.mjs:30-42,225`）；**无 `lastOpenFiles`、无递归 split（只有两组页组）、无逐视图 `getState`** | 半缺：我们的四轴在"页"这一层是清楚的，在"树"这一层比 Obsidian 弱 |
| 事件总线 | `workspace.on(` 70 处／**21 个事件名**；`vault.on(` 37 处／6 名；`metadataCache` 164 | 主进程→渲染 `IPC_EVENT` 4 ＋ `IPC_PUSH` 3；载体可订阅词只有 `['project.changed']`（`carrierManifest.mjs:131`） | **断层**：载体无法订阅"文件被改／选中变了／布局变了" |
| 主题外挂 | **1071 个** CSS 自定义属性（抽出的 `app.css` 实测）；`theme-dark`/`theme-light`；主题装在 `.obsidian/themes/<name>/{theme.css,manifest.json}`；`obsidian.css` 为用户级覆盖 | `next/shell/styles/next-shell.css` 1763 行但语义 token 只 8 个；无主题文件外挂轨；`DESIGN.md`/`tokens.css`/`manifest.json` 全仓不存在 | **断层**（详见审计报告 §5.1–§5.2） |
| IPC 面 | 42 唯一字面通道／118 调用点（`sendSync` 64、`ipcMain.on` 41、`send` 11、`invoke` 1、`handle` 1），按名分散注册 | **56** 条通道常量集中 `next/shell/ipcContract.mjs`，注册一句通用 dispatcher（`shell/main.mjs:774-776`），preload 白名单挡未注册（`preload.mjs:9-26`） | **我们更优，不要倒退** |

判读：把上表按"能不能被枚举／能不能从磁盘来／能不能持久化"三问归并，Obsidian 的可玩性 = **三张公共表（命令／视图／设置）× 一条装载通路 × 一份可序列化的布局树**。它自己只提供槽位、注册表、事件与 chrome，把内容丰富度外包给插件与主题。我们的架构选择（内置载体、集中合同、单入口分发）本身是**优点**，问题在那三问里有两问答案是"零"。

---

## 3. 我们的现状：分层体检（每层先说已经对的）

规模实测（`find`＋`wc`，不含生成的 `next/.build/`）：`shell/` 69 文件／22,833 行，`tests/` 90／26,410，`runtime/` 31／6,137，`carriers/` 43／5,029，`kernel/` 13／2,877，`testing/` 16／2,053，`fs/` 3／1,091，`history/` 1／656，`project/` 4／475，`skills/` 6／351，根文件 13／约 2,360。

**L0 内核（2,877 行）——本项目最健康的一层。** 已落地：@1–@4 四代清单读兼容、写侧 @4（`carrierManifest.mjs:46-56,168-190`）；槽位合同 `OPEN_SLOTS=['left-dock','center','overlay']` 与 `RESERVED_SLOTS=['right','top-menu']`（`:156-157`，right 归运行时的裁定有强制）；`primary` 强制声明、注释直写"框架不做默认"（`:513`）；D2 禁静默回落（`next/project/openProject.mjs:48`、`createProject.mjs:18,22` 出 `PRIMARY_CARRIER_MISSING`）；D3/D4 能力闭包（`next/kernel/capabilityGraph.mjs:5,49,64,80`）。缺：**装载**、**沙箱**（`trustMode:"same-process"`）、以及"描述符自己说的"与"实现能做的"的一致性（见 F6）。

**L1 主进程（`shell/main.mjs` 830 行，单文件）。** 已落地：一句通用注册＋`slimForIpc`（`:774-776`）、单实例锁（`:189-190`）、titleBarOverlay（`:98-119`）、`before-quit` 刷盘（`:794`）。问题：所有服务在主进程**内联构造**后注入 dispatcher（`:627`），没有模块边界，830 行是一个可以继续膨胀的形状；没有任何"插件从这里进来"的钩子；载体与宿主同进程，一块载体的异常没有隔离面。

**L2 IPC 面（56 请求通道＋7 推送）。** 已落地：命名统一 `pinax:agent:*`、常量表可版本化、未注册通道回结构化错误码 `PINAX_INVALID_INPUT`。缺三族：**命令族**（没有 `command:list`/`command:invoke`）、**事件族**（载体订阅词表只有 `project.changed` 一个）、**状态族**（没有"当前焦点/布局摘要"这类给状态栏与面板消费的只读面）。值得注意的是"菜单动作"已经有一条完整通路可以复用：`menuInvoke: 'pinax:agent:menu:invoke'`（`ipcContract.mjs:99`）＋封闭 id 集由 `flattenMenuIds(MENU_TEMPLATE)` 生成、未知 id 直接拒（`:314,719-731`）＋渲染层用同一份 `MENU_TEMPLATE` 页内渲染（`AppNext.vue:1801`）。**这说明"命令面"在我们这里只差把 id 集的来源从一张硬表扩成"硬表 ∪ 载体清单"，不是要从零造。**

**L3 外壳（渲染层）。** 已落地：三栏 Obsidian 式骨架（`AppNext.vue:1790-1900`：标题栏＋菜单行＋项目 chip→`ActivityRail` 竖条→可选 `IndexWindow`＋`resizer`→`.col-center` 页签→右 dock），竖条在代码里就直接自称"Obsidian 的 ribbon"（`ActivityRail.vue:7`）；页身份算法只有一处（`openTarget.mjs:25` 五档 `reveal|replace-page|open-page|raise-tab|block`，且**没有任何一档新建浮窗**，符合批次61 作者裁定①）；右键形态菜单只列清单声明过的形态（`paneForms.mjs` P18）。缺（本轮 grep 复核）：命令面板 0、状态栏 0、快速打开 0、快捷键注册表 0、面包屑 0、多窗（`host-descriptor.json:22` `supportsPopout:false`）、拖拽落位（`IndexWindow.vue` 里 `drag`/`drop` 各 0 命中，拖拽只有移窗与改宽）。
**L4 载体面（11 块／25 个 pane 声明）。** 已落地：`claims` 唯一归属、`multiplicity` 真消费、`dataDirs` 中文真源、批次38 的蓝链与反向链接（可玩性的正向资产，本轮未见回归）。缺：`commands` 全空、`preview`/hover 预览未接（`IndexWindow.vue` 里 `preview` 0 命中；`CarrierPaneHost.vue:145` 自陈"批次53 欠账，`ipcContract.shellView` 未投影"）、23/25 pane 声明落不了地的形态。
**L5 视觉与文案。** 不重复展开，直接引审计：token-map 覆盖 **3.0%**（用 Next 自己的 8 个 `--nx-*` 当目标体系）、`--accent-primary` **144 次引用／40 文件／全仓零定义**、`--text-muted` **一名四值**（对比度 3.37／3.93／4.49／6.10，三档不过 AA）、继承层 **134** 条根外裸 hex 进入 Next 渲染面、切载体 **CLS 0.1245**、444/633 文本节点 <12px。

---

## 4. 断层清单（作者要的"规格的沟通与设计上的断层"）

编号 F，每条给「现象 → 证据 → 后果 → 最小修」。前四条是硬的，后面是配套。

**F1 装载断层（规范说插件，代码是数组）。** 证据：`carriers/index.mjs:2-31` 静态 import、`:201` 冻结数组；全仓无 `readdir`＋`import()` 装载路径；`pluginDirs.mjs:9` 的 `overrides` 形参无外部喂值；门禁把数量写死（`acceptance.mjs:361`）。后果：目标①的"高可玩性"只能由我们自己一条条实现，第三方与作者自制扩展都进不来；"加一块载体"从写清单变成改 9 个文件。最小修：内核加 `pluginLoader`，内置 11 块改走同一条装载路径（内置＝随包已安装，不再是能力特权）。

**F2 命令断层（插座埋好、电器为空）。** 证据：`carrierManifest.mjs:430-462` 校验齐、`pluginRegistry.mjs:268-281` 取口齐、`next/carriers/*/manifest.mjs` 里 `commands` **0 命中**、渲染层 0 消费。后果：所有功能只有"点竖条"和"点菜单"两条路，可发现性没有基础设施；快捷键、面板、状态栏、以及"插件卸载自动摘除"都无处挂。最小修：见 §6 桩1，复用已有的 `menu:invoke` 通路。

**F3 入口断层（palette／hotkeys／statusBar／quick switcher 全无）。** 证据：`next/` 内 `CommandPalette|命令面板|statusBar|状态栏|QuickSwitcher|hotkey` 字面命中均为 0；`next/shell` 有 39 处独立 `keydown`；accelerator 只存在于 `menus.mjs:19-32`。后果：目标②"丝滑"缺一条主通道——**长键盘作者的手必须离开主区去找竖条**；同时无法回答"这个软件能干什么"（没有可枚举的目录）。最小修：桩1 一次带上面板＋状态栏＋可持久化的 `hotkeys.json`。

**F4 规范回写断层（文档落后代码，注释落后代码）。** 证据：规范 v1 §3 描述 `pinax-carrier@1` 字段（`:56-98`）与"没有 right"的槽位（`:74,133`），代码写侧是 @4、字段已改名、槽位多了 `overlay`（`carrierManifest.mjs:46-56,156-157`）；`carrierManifest.mjs:149,465,476` 三处注释仍说"宿主六种视图"，`viewRegistry.mjs:21-33` 实际 8＋1；`paneForms.mjs:25` 注释写"批次61 起缺省＝页"，同文件 `:26` 常量仍是 `DEFAULT_PANE_FORM = 'dock'`；`ipcContract.mjs:102` 的头注释写"反向通道只有这三条"，紧接的 `IPC_EVENT` 表已有 **4** 条（批次37 加了 `projectEvent`，`:106-113`），另有 `IPC_PUSH` 3 条（`:124-132`）。后果：新读者（含 AI 工具）按文档写的合同去声明清单会被校验器拒；"规范 v1"事实上失去约束力。最小修：桩4，出一份与代码同代的规范 v2 ＋ 一张字段改名对照表。

**F5 隐形闸断层（未裁的事已经在硬拒）。** 证据：规范 §10 明列 **R4「建项目时强制装齐依赖闭包」状态＝未裁**（`spec:214`），代码已实现为硬失败（`next/project/createProject.mjs:30` `DEPENDENCY_UNMET`）并进了门禁。后果：作者既往裁决"自设阈值/自设规则禁当隐形闸，新增闸须人裁留名"——这条正踩线；而且它以"规范推荐"的名义转正，比我自己加闸更难被发现。最小修：要么作者追认（写进 v2 并留名），要么把硬拒降级为"提示＋可继续"。

**F6 词表与状态轴不同构（设计断层里最硬的一条）。** 证据：协议五词（`paneForms.mjs:16`）且写进对外描述符 `host-descriptor.json` 的 `forms`；v3 只有三档落点（`FORM_ACTIONS` `:19-24`、`PAGE_FORMS` `workspace.mjs:38`）；`fullscreen`／`immersive` 无落点且作者 §7 待裁④ 未裁；**25 处 pane 声明里 23 处含 `fullscreen`、13 处含 `immersive`**。后果：清单向插件作者广告了点不出来的能力，同时"1＋N 的多形态"这个数字在文档里是 5、在代码里是 3、在 UI 里是 3——三层各说一套，正是"设计断层"本身。最小修：二选一（补齐两个形态，或从词表与 25 处声明里删掉），并把"声明的形态必须有落点"写成断言。

**F7 事件断层（载体订阅词表只有一个词）。** 证据：`CARRIER_SUBSCRIPTIONS = ['project.changed']`（`carrierManifest.mjs:131`）；对照 Obsidian 21 个 `workspace.*` ＋ 6 个 `vault.*` ＋ 4 个 `metadataCache.*`。后果：载体无法响应"选中项变了／布局变了／文件被外部改了"，这是索引窗与 Doc 栏联动（可玩性的核心手感）的机制缺口。最小修：扩词表＋把已有的 `projectEvents`（批次39）暴露给载体。

**F8 设计语言的权威层未裁定（两份文档指向不同 CSS 真源）。** 证据：`agent-skills/ui-style-check/SKILL.md §1` 把老 `src/styles/` 当 token 真源，批次61 与本轮审计把 `next/shell/styles/next-shell.css` 当 Next 视觉面，两者互不引用，且 `DESIGN.md`/`tokens.css`/`manifest.json` 不存在。后果：同一个"统一且简洁"的目标，两套验收口径；`--text-muted` 一名四值（3.37/3.93/4.49/6.10）正是没有权威层的必然结果。最小修：桩4 里连同 DESIGN.md 一次性裁掉。

**F9 术语断层（一物多名）。** 证据：同一层概念在代码与文档里叫法不同——`carrier`（内核）／`载体`（规范）／`plugin`（`pluginRegistry`、`BUILT_IN_CARRIER_PLUGINS`）／`边栏`（规范 v1"插件边栏"）；`pane`（清单）／`板`（`useBoardData`、`board.layout`）／`页`（v3 `PAGE_FORMS`）／`窗`（`PaneWindow`）／`标签`（`tab`）。后果：`forms`/`form`/`layout template`（`folder|web|gallery`，`layoutTemplates.mjs:17`）这三组词在文档里常被混写成"形态"，读者无法判断"1＋N 的 N"指的是形态数、页组数还是载体数。最小修：v2 附一张术语表（一物一名，中英对照，禁止同义替换）。

**F10 门禁与目标脱节（测自洽，不测目标）。** 证据：`npm run verify:next` 五段（`package.json:103`）＝36 项 `record()` ＋ `node --test`（82 文件／646 个 `test()`）＋ vitest（241 例）＋ eslint 0 警＋45 项打包断言，全绿；但**没有一条断言**"能从磁盘装一块载体""命令能在面板里被找到""声明的形态能落地""停用全部载体后运行时仍可用"。后果：门禁成为现状的复刻——它保证我们不倒退，不保证我们朝目标走；且 `acceptance.mjs:361` 那种"数量断言"让新增能力必须先改门禁。最小修：桩1/桩2 各带一条目标级断言进 `verify:next`（按作者既有裁决，先只记账不设为打回条件）。

**F11 状态基线断层（无法做批次级 A/B）。** 证据：`git status --porcelain` 249 条（95 改／9 删／145 未跟踪），HEAD 仍停在 `36b0fe2 … 至批次41`，批次 42→61 全部在工作树里未入库；`.qoder/` 未跟踪也没被忽略。后果：任何"改之前/改之后"的规格对比只能拿磁盘实物当证据，规范文档里的历史数字无法复核。最小修：一条裁定的事（要么按批次补入库，要么承认工作树是唯一现状并把文档基线改成"实物口径"）。

---

## 5. 正确的搭法：六条判据（可验收，且必须接进 `verify:next`）

一个"Electron-Obsidian 式"的框架，我认为应该由这六条判定，而不是由"像不像三栏"判定。**每条都写成能进门禁的形状**（依作者裁决"门禁必须接在提交链路上"）。

**J1 三张公共表可枚举，且每张必有消费端。** 命令表（清单 `contributes.commands` ∪ 应用菜单）→ 面板＋快捷键＋状态栏消费；视图表（`HOST_VIEW_TYPES`＋`custom`）→ `viewRegistry`＋`doctor` 核；设置表（`contributes.settings`）→ `SettingsModal`＋覆盖落盘。判据形状：`registry.commands()` 非空、每条可解析出 `commandOwner`、面板可列出全部条目、未知 id 调用被拒（这条我们已有，`ipcContract.mjs:719-731`）。

**J2 一切从磁盘装载，内置只是"随包已安装"。** 判据形状：把一块 fixture 载体的清单放到位、外壳代码零改动即可出现在竖条上，停用后干净退场（`pluginRegistry` 的 `onUninstall`/`disposeOwner` 已具备，`:255-260`）；门禁里**不再出现载体数量断言**。

**J3 两个常驻入口永远可达。** `Ctrl+P` 命令面板＋快速打开；**全部载体停用后二者仍可用**（这就是规范 v1 §5 第 4 条"故障隔离"的可见形态，也是 §9.3 的"停用全部插件后运行时仍可用"从未被实现的那一条）。

**J4 状态轴与词表同构。** 清单能声明的每个形态，状态机必须有落点；落不了的词不得出现在对外描述符里。判据形状：对 11 份清单逐 pane 断言 `forms ⊆ 可实现集合`。

**J5 布局可序列化、可恢复，且包含"最近打开"与逐视图状态。** 我们已有四轴（`workspace.mjs:30-42`）；补 `lastOpenFiles`（Obsidian 12 处字面命中）与视图实例状态（树展开、滚动、选中），写盘 debounce 记账（Obsidian 实测 1000ms）。

**J6 设计语言是数据。** `DESIGN.md`＋`tokens.css`＋`manifest.json`（OpenDesign 官方形态），门禁与工具读同一份；"一名一值"作为可检查约束（`--text-muted` 四值、`--accent-primary` 零定义就是它的反例）。

**明确不该照抄 Obsidian 的地方**（我们的选择更好，别倒退）：任意递归 `Split` 树（成本高、两组页组＋浮窗已覆盖真实需求）、渲染层持有 vault 数据逻辑（我们一律过 IPC 到主进程）、按名分散的 42 个 IPC 通道（我们 56 条集中一处＋白名单）、1071 个 CSS 变量（我们要的是**约 60 个一等 token**，不是变量海）。

---

## 6. 方案：四根桩，按批次交付（不动视觉大改，不重写外壳）

以下每批都写「做什么 → 为什么是这根桩 → 判据 → 验收接在哪 → 风险」。范围刻意小：**先补基础设施，再谈"高可玩性"的功能堆叠**。

**桩1｜命令面（第一批，建议单独一批做完）。**
做：① 给 11 份清单补 `contributes.commands`，只镜像已有动作（每块 3–6 条：新建/导入/审阅提案/切换形态/导出…），不新增行为；② `ipcContract` 扩一条 `command:list`，并把现有 `menu:invoke` 的 id 集来源从 `flattenMenuIds(MENU_TEMPLATE)` 改成 `MENU_TEMPLATE ∪ registry.commands()`（`ipcContract.mjs:314` 一处改）；③ 新增 `shell/CommandPalette.vue`（`Ctrl+P` 唤起，可搜索，列出全部命令＋当前焦点页可执行的形态）；④ 新增 `shell/hotkeys.mjs`，读/写 `.pinax/hotkeys.json`，冲突即拒并记账，替换 `next/shell` 里 39 处散注册中的高频项；⑤ 底栏 `StatusBar.vue`（高度、字号、对比度按 OD craft 判据：文本 ≥4.5:1、可点 ≥24×24），承载服务灯＋当前载体/页组/"1＋N 的 N"＋焦点文档字数。
为什么：F2＋F3 一起解，且是目标①与目标②的共同前置——没有可枚举命令表，后面任何"可玩"的功能都没有挂载点。
判据：面板能列出全部命令且每条可点；`registry.commands()` 有真实消费端；快捷键可重绑、重启后仍在；未知 id 拒。
验收接法：`verify:next` 加两段（命令表非空＋每条可解析 owner；`forms` 与命令 id 命名空间不冲突）。按作者既有裁决**先只记账进复核清单，不设为打回**。
风险：`Ctrl+Shift+P` 已被"提案审阅"占用（`menus.mjs:28`）→ 需 Q3 裁定键位。净增估：8–12 文件，约 600–900 行。

**桩2｜装载面（第二批，安全面先裁）。**
做：① 新增 `next/kernel/pluginLoader.mjs`：扫 `.pinax/plugins/*/manifest.json` ＋（可选）宿主 `overrides` 目录 → 走**同一个** `normalizeCarrierManifest(@4)` → scope 摘要 → `registry.install`；② 内置 11 块改由 `resources/carriers/<id>/manifest.json` 经同一路径装载，`BUILT_IN_CARRIER_PLUGINS` 退化为"随包安装清单"（只列 id，不再 import 实现），门禁数量断言随之删除；③ `doctor` 增加"外部插件装载态"用例（五态已有框架可复用）；④ **第一档只允许"声明型"外部插件**：panes/commands/settings/tools 全部复用既有内核面，**不执行第三方 JS**（`trustMode` 保持 `same-process` 但对声明型只读数据）。
为什么：F1；也是规范 §9.3「把小说换成 mock 插件、把第三方按同合同装进来，外壳都不改一行」这条 DoD 从未实现的部分。
判据：一块 fixture 载体从磁盘装入→出现在竖条→其命令出现在面板→停用后视图/订阅/工具全部释放（`pluginRegistry.mjs:255-260` 的 dispose 链已具备）。
风险：Windows 中文路径与打包路径（既往坑）；`overrides` 目录的信任边界；第三方 JS 执行需要沙箱裁定（Q4）——所以**本批明确不开 JS 执行**。
净增估：4–6 文件，约 500–800 行＋11 处装载声明改写。

**桩3｜状态轴与"我在哪"（第三批，与桩1 的表联动）。**
做：① 解 F6：`fullscreen`/`immersive` 二选一（补齐落点，或从 `PANE_FORMS`、`host-descriptor.forms` 与 23/13 处声明里删掉），并把"声明形态必有落点"写成断言；② 补 `lastOpenFiles` ＋ 逐视图状态（`IndexWindow` 展开/滚动/选中）进 `workspace.json` v4，读侧一次性迁移（v1/v2 迁移已有先例 `workspace.mjs:26`）；③ 1＋N 常驻可见（审计 §8-C）落进桩1 的状态栏，不新增按钮（作者裁定③"不做死按钮"）；④ 扩 `CARRIER_SUBSCRIPTIONS`（F7）到 `selection.changed`/`layout.changed`/`file.changed`，把批次39 已有的 projectEvents 暴露给载体。
为什么：目标②"丝滑"里除了 CLS 那条（视觉层，走审计的 D/B 项），剩下的就是"状态看得见、恢复得了"。
判据：重启后页组/当前页/最近打开/树展开一致；描述符形态集合 ⊆ 可实现集合。
净增估：5–8 文件，约 400–600 行。

**桩4｜回写与设计语言（与桩1 同批启动，零代码风险）。**
做：① 规范 **v2** 一份：@4 全字段合同表（＋@1→@4 改名对照）、槽位/形态/视图三词表、装载合同、三张公共表、J1–J6 判据；② 术语表一张（F9，一物一名）；③ **`DESIGN.md` ＋ `tokens.css` ＋ `manifest.json`**（OD 官方形态），约 60 个一等 token，含 `--text-muted` 收敛为"一名一值＋主题覆盖表"（审计 §8-P）、`--accent-primary` 要么定义要么清除 144 处引用（审计 §8-A/§5.2）；④ 统一裁定台账：把散在 6 份文档里的未裁项（R3/R4、§7④⑤⑥、审计 A–P）收进一张表，逐条留名；⑤ 把 `od lint`（0 模型、headless、可 `--fail-on`）与 `impeccable detect` 接进 `verify:next` 的**记账段**（先不打回；且必须先解它们的 `.mjs`/`.vue` 盲区，否则假绿——审计 §2.2）。
判据：新读者按 v2 写的清单能通过校验器；`DESIGN.md` 存在且被 OD `token-map` 读得到（覆盖率从 3.0% 起跳，只记账不设闸）。

**明确推后（需单独裁定，不进本方案）**：多窗 popout（`supportsPopout:false` 现状）、拖拽落位/任意分屏、第三方 JS 沙箱、富视图、主题外挂轨。

---

## 7. 顺序与理由

落批与工时排期见 §11（本节只讲因果顺序，§11 讲批次号、前置裁定与完成判据）。

**桩1 先做**，因为它是唯一"合同与取口都已埋好、只缺声明与消费端"的事，投入产出比最高，而且桩2 与桩3 的可见判据（"外部载体的命令能出现在面板里""我在哪一组"）都要挂在它上面。**桩4 与桩1 同批启动**，因为不先把词表与合同回写清楚，桩1 会立刻制造新断层（又一批只有代码没有文档的行为）。**桩2 第二**，因为它把"加一块载体改 9 个文件、还要改门禁"这笔债一次性消掉，也是第三方生态的唯一入口。**桩3 第三**，因为"最近打开/逐视图状态/形态收敛"的价值在命令面与装载面成立之后才完整——单独做只会变成又一处 UI 改动。

工作量合计粗估：**约 25–34 个文件、净增 1,500–2,300 行**（不含 DESIGN.md/tokens 的文案量），其中桩1 约 600–900 行、桩2 约 500–800 行、桩3 约 400–600 行。桩1＋桩4 可以在一个工作日批次里出可看结果，桩2 需要两次批次（loader 与内置改造分开落，便于回退）。这是工程量估计，不是承诺，落批时按批核对。

---

## 8. 需要你点头的裁定（Q1–Q6）

| # | 议题 | 我的倾向（仅供裁） |
|---|---|---|
| Q1 | **R4 追认还是降级**：建项目强制装齐依赖闭包，今天已是硬拒（`createProject.mjs:30`），规范 §10 却写"未裁"（F5） | 追认并写进 v2 留名；若不想硬，就改成"提示＋可继续，缺口进状态栏常驻" |
| Q2 | **`fullscreen`/`immersive` 留词还是删**（23/25 与 13/25 处正在声明落不了地的形态，F6） | 建议**删**：先让"1＋N 的 N"这个数字在文档/代码/UI 三处一致；真要做沉浸态再单独开批 |
| Q3 | **命令面板的键**：`Ctrl+Shift+P` 已被"提案审阅"占用（`menus.mjs:28`） | 面板用 `Ctrl+P`；"提案审阅"改 `Ctrl+Shift+R`（面板优先，因为它是入口不是动作） |
| Q4 | **外部插件是否允许执行第三方 JS** | 本方案第一档**不开**（只接受声明型）；要开必须先裁沙箱形态（worker/iframe＋scope 审批 UI），不能沿用 `same-process` |
| Q5 | **多窗（popout）与任意分屏是否进路线图** | 建议推后：v3 的两组页组＋浮窗已覆盖"并排两章"的真实需求，popout 的窗口生命周期成本最高 |
| Q6 | **DESIGN.md 与规范 v2 谁先** | 同批。二者是同一把钥匙：v2 解 F1/F4/F6/F9，DESIGN.md 解 F8（也是上一轮审计的 A 与 P） |

上一份审计的 K（是否部署 OD daemon，我倾向不部署）、L（`.qoder/skills/impeccable/**` 22 MB 未跟踪的处置）、A、P 四条仍未裁；本方案与它们不冲突，**桩4 会把 A 与 P 吃掉**，K 与 L 独立成裁。

---

## 9. 取证方法与复现（口径先说清，免得"0 命中"被读成"没问题"）

**Obsidian 侧**：对安装包 `obsidian.asar`（`C:/Users/Administrator/AppData/Local/Programs/Obsidian/resources/`，24,060,763 B）做 `grep -a -o "<literal>" | wc -l` 的字面命中计数；代码是 minified，所以**计数只用于"这个设施是否存在、量级多大"，不用于语义覆盖率**。抽出的 `app.css` 在 `D:/Pinax-main/_tools/obsidian-app.css`（与 asar 内尺寸一致）；REA 的证据包 `D:/Pinax-main/_tools/obsidian-core-evidence.json` 已复核**不含**这些 IPC 通道字面量，故本文的 IPC 数字来自直接 grep（与上一轮审计 §10-P5 同一口径）。本轮独立复核的关键计数：`addCommand 151`、`registerViewType 17`、`registerView 41`、`addSettingTab 26`、`registerHoverLinkSource 18`、`registerCliHandler 46`、`minAppVersion 2`、`isDesktopOnly 2`、`command-palette 15`、`hotkeys.json 2`、`registerStatusBarItem 9`、`lastOpenFiles 12`、`core-plugins 8`、`left-ribbon 2`，以及 `workspace.on(` 去重后 **21 个事件名**（与 `_tools/obsidian-core-rea.md:96-105` 的 `literal_channels:42 / main_handlers:42` 一致）。

**我们侧**：`next/` 工作树源码（不含 `next/.build/`）。规模：`find next/<dir> -type f -not -path '*/.build/*' \( -name '*.mjs' -o -name '*.vue' -o -name '*.json' -o -name '*.css' -o -name '*.md' \)` 计数＋`cat | wc -l`。通道数：`grep -cE "^\s+[a-zA-Z]+: '" next/shell/ipcContract.mjs` → **56**（distinct `pinax:` 字面 57）。缺失项判据：`grep -rn "<词>" next/ --include=*.mjs --include=*.vue | grep -v '/.build/' | wc -l` → `CommandPalette`/`命令面板`/`statusBar`/`状态栏`/`QuickSwitcher`/`hotkey` 全为 0，`keydown` 全 `next/` 110（含测试）、`next/shell` 内 `addEventListener('keydown'|@keydown|onkeydown` 39。命令面判据：`grep -rn "commands" next/carriers/*/manifest.mjs | wc -l` → **0**；`registry.commands()` 的调用方只有 `next/tests/manifest-v2.test.mjs:184,198`（假清单）。形态声明计数：`grep -rho "slot: '" next/carriers/*/manifest.mjs | wc -l` → **25**；其中含 `fullscreen` **23**、含 `immersive` **13**。

**复现命令**（全部只读）：

```bash
ASAR="/c/Users/Administrator/AppData/Local/Programs/Obsidian/resources/obsidian.asar"
for k in addCommand registerViewType addSettingTab registerStatusBarItem command-palette hotkeys.json lastOpenFiles core-plugins; do
  printf "%-24s %s\n" "$k" "$(grep -a -o "$k" "$ASAR" | wc -l)"; done
grep -a -o 'workspace\.on("[a-z-]*"' "$ASAR" | sort -u
cd /d/Pinax-main/Pinax-main
grep -cE "^\s+[a-zA-Z]+: '" next/shell/ipcContract.mjs
grep -rn "CommandPalette\|命令面板\|statusBar\|状态栏\|QuickSwitcher\|hotkey" next/ --include=*.mjs --include=*.vue | grep -v '/.build/' | wc -l
grep -rn "commands" next/carriers/*/manifest.mjs | wc -l
grep -rho "slot: '" next/carriers/*/manifest.mjs | wc -l
```

---

## 10. 本轮边界（如实声明）

改了什么：**仓内源码零改动**。本轮在仓内新增的只有这份 md（上一轮的审计 md 与官方安装的 `.qoder/skills/impeccable/**` 之外无其他写入）。**未 commit**（按既有口径：无明确指令不提交）。

**机器层与语义层的分层**：本文的"有没有"（命令面板 0、装载路径 0、`commands` 0 声明、23/25 形态落不了地）是**机器层可复核**的；本文的"该怎么搭"（六条判据、四根桩、不照抄清单）是**我的判断**，依据是 Obsidian 的结构事实与规范 v1 的既有裁定，不是外部标准。`addCommand 151` 这类计数是 minified 字面命中，只能说明"这设施在 Obsidian 里无处不在"，不能换算成"我们要 151 条命令"。

没测到的：没起真 Electron 窗口跑 CDP（依审计 §9 同一缺口），所以窗口级 IPC、原生菜单实际渲染、iframe 承载位（批次44）不在本文结论内；`pluginLoader` 的可行性我只做了代码形状核对（`registry.install`/`disposeOwner`/`dirOf` 齐备，`pluginDirs.mjs` 的 `overrides` 形参现成），**未做原型验证**——桩2 落批前应先打一个 30 行的 fixture 桩；第三方 JS 执行的沙箱成本未评估（这也是 Q4 建议先不开的原因）。

一处必须留名的现状：HEAD 停在 `36b0fe2（至批次41）`、工作树 249 条改动（批次 42→61 由并行会话推入未入库），本文所有 `next/` 数字是 **2026-11-02 工作树实测**，不能与任何历史批次文档里的数字做 A/B（F11）。

---

## 11. 改造排期（建议 8 批、约 8.5 个工作日；批次号接当前工作树）

前提三条，先说在前面：①**批次62 的号已被"手势包（修饰键／中键／拖出）"预留**（`docs/plan/pinax-electron-next-m2-batch61-ticket-20261101.md:48`、`next/shell/openTarget.mjs:72,75-77` 的 `gesture` 形参就是为它留的）；我的建议是**把手势并进命令面那一批**，因为手势的语义就是"以另一形态执行同一动作"，没有命令表可绑，手势只能落回 `GESTURE_NOT_IMPLEMENTED`。②批次61 工单写死一条纪律"**不许新增任何无人消费的清单声明**"，所以每批的声明与消费端必须同批落地，下面每批都按这条排。③排期假设继续在当前工作树推进；HEAD 停在 `36b0fe2（至批次41）`、249 条改动未入库，若要做批次级 A/B 得先补入库（F11）。

| 批 | 内容 | 净增估 | 前置裁定 | 完成判据（进 `verify:next` 记账段，不打回） |
|---|---|---|---|---|
| 第 0 批（0.5 天，纯文档） | 规范 **v2** 骨架：@1→@4 改名对照表、槽位/形态/视图三词表、术语表（F9）＋ 统一裁定台账（R3/R4、§7④⑤⑥、审计 A–P、本文 Q1–Q6 一张表留名） | 文档 | 无 | 新读者照 v2 写的清单能通过 `carrierManifest` 校验器（跑一次即证） |
| 62（1–1.5 天） | **命令面＋手势**：`command:list` 通道；`ipcContract.mjs:314` 的 id 集从 `flattenMenuIds(MENU_TEMPLATE)` 扩成"∪ `registry.commands()`"；11 份清单补 `contributes.commands`（每块 3–6 条，只镜像已有动作，估 40–55 条）；`CommandPalette.vue`（模糊搜索＋回车执行）；`.pinax/hotkeys.json` 读写与冲突拒；`resolveOpenTarget` 的 `gesture` 解除 block | 8–12 文件／600–900 行 | **Q3**（键位：`Ctrl+Shift+P` 已被提案审阅占用，`menus.mjs:28`） | 命令表非空；每条可解析 `commandOwner`；未知 id 拒；面板枚举数＝`registry.commands()` 长度 |
| 63（1 天） | **状态栏＋故障隔离**：`StatusBar.vue`（服务灯＋当前载体／页组＋"1＋N 的 N"＋焦点文档字数）；状态栏可点件达 24×24（审计 H）；补"停用全部载体后，面板与快速打开仍可用"的回归测（规范 §9.3 从未实现那条） | 4–6 文件／300–450 行 | Q2 可后置 | 全部载体 enabled=[] 时外壳不白屏、面板仍可唤起；状态栏文本对比 ≥4.5:1 |
| 64（0.5 天，**先打桩**） | 装载原型：30 行 `pluginLoader` fixture，只在 `node --test` 里跑（不起 Electron）→ 装→`registry.list()` 可见→卸→dispose 链跑完 | 1 文件＋测试 | 无 | 桩不过则**停在原地回报**，不硬推第 65 批 |
| 65（1.5 天） | **装载正式**：扫 `.pinax/plugins/*/manifest.json` ＋（可选）overrides 目录 → 同一个 `normalizeCarrierManifest(@4)` → scope 摘要 → `registry.install`；内置 11 块改走同一路径；删门禁数量断言（`acceptance.mjs:361`）；`doctor` 增"外部插件装载态" | 4–6 文件／500–800 行 | **Q1**（R4 追认/降级）、**Q4**（第一档不开第三方 JS） | 一块磁盘 fixture 装入→竖条出现→其命令进面板→停用后视图/订阅/工具全释放；门禁里不再出现载体数量 |
| 66（1 天） | **状态轴收敛**：`fullscreen`/`immersive` 按 Q2 择一（词表＋25 处声明＋描述符三处同改）；`workspace.json` v4 补 `lastOpenFiles` 与逐视图状态（树展开/滚动/选中），读侧一次性迁移；`CARRIER_SUBSCRIPTIONS` 扩 `selection.changed`/`layout.changed`/`file.changed` | 5–8 文件／400–600 行 | **Q2** | `host-descriptor.forms ⊆ FORM_ACTIONS`；重启后页组/当前页/最近打开/展开态一致；声明形态必有落点成为断言 |
| 67（1 天） | **设计语言成数据**：`DESIGN.md`＋`tokens.css`＋`manifest.json`（约 60 个一等 token）；`--text-muted` 一名一值（审计 P）；`--accent-primary` 144 处引用要么定义要么清除（审计 A）；`od lint` 与 `impeccable detect` 接进 `verify:next` 记账段（**先解 `.mjs`/`.vue` 盲区，否则假绿**） | 文档＋CSS | Q6（默认同批） | OD `token-map` 覆盖率从 3.0% 起跳（只记账）；`--text-muted` 全仓唯一真源；lint 两段能出账 |
| 68（1 天） | **视觉手感收口**（走审计 B/D/E）：竖条 `transition: 0s` 与外壳 120ms／继承 150ms 归一；消 `col-center` 的 CLS 0.1245 位移源；11px 等 <12px 字号收进字号 token | 3–5 文件／150–300 行 | 无 | 切载体 CLSΔ 记账值显著低于 0.1245（**只记账，不设自动打回**）；三套时长归一后 reduced-motion 生效 |

**关键路径**：62 → 63 → 65 → 66。第 0 批与 67/68 可并行插队，64 是 65 的前置打桩。合计 **8.5 个工作日**（按你一天一批的节奏约两周半；砍掉手势则 62 省 0.5 天）。

**三个"看得见"的里程碑**：**M1＝62–63 完**，`Ctrl+P` 能列出这个软件全部能做的事，"高可玩性"第一次有基础设施（而不是又一块面板）；**M2＝65 完**，加一块载体不再改 9 个文件、门禁里没有数量断言，目标①的生态口打开；**M3＝66–67 完**，"1＋N 的 N"在文档/代码/界面是同一份词表，设计语言第一次是机器可读的数据。

**不建议排进来的**：多窗 popout、任意递归分屏、拖拽落位、第三方 JS 沙箱、主题外挂轨（Q5 建议推后）。它们各自的成本都高于 M1–M3 带来的目标增量，且 popout 会牵动 `supportsPopout:false` 的窗口生命周期与 workspace 序列化形状（`host-descriptor.json:22`、`workspace.mjs:30-38`）。
