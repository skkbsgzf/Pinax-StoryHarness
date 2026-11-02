# 批次63 记录：状态栏＋故障隔离＋批次62 四笔收编（Obsidian 框架轮·桩1 续）（2026-11-02）

> 工单：`docs/plan/pinax-electron-next-m2-batch63-ticket-20261102.md`（调度方 Zcode，执行方 Qoder CLI）。
> 前置：批次62（命令面＋手势）已收口，本批收编它评审里那四笔已披露账（medium 一笔＋low 三笔）。
> 结果：`npm run verify:next` 五段全绿（`EXIT=0`）——acceptance **39/39** ／ node:test **694**（批次62 基线 689，本批新增 5 条）／ vitest **200**（14 文件，含 `shell-ui.spec.mjs` **89** 例，本批新增 4 例）／ `lint:next` 零告警 ／ bundleAssertions 全过（**未改任何计数**，理由见 §6）。
> 边界遵守：不改协议 schema、不动写族闸与文件服务、不加 npm 依赖、状态栏不加新动作、不起 Electron、不执行 git、不动 `src/**` 与 `server/**`。

---

## 1. 四块任务 → 落点

| 任务 | 落点 | 对应测试 |
|---|---|---|
| 1 `StatusBar.vue`（新，底栏常驻） | `next/shell/StatusBar.vue`（只读组件：props 四格＋`emits: open-services`，不认识桥、不碰载体、不碰文件系统）；挂载 `AppNext.vue:2408`（`.nx-shell-root` 的最后一段：标题栏 → 三栏 → 状态栏）；取数 `AppNext.vue:444/456/458/465/474` 四个 computed，全部现取自既有事实源；**样式写在组件自己的 `<style>` 里，没有动 `next/shell/styles/next-shell.css`**（该文件不在本批允许清单内，见 §7） | `shell-ui.spec.mjs`「状态栏：四要素读数、唯一可点件点开『服务与通知』，不新增任何动作」；`acceptance.mjs`「批次63 状态栏在位：四要素齐、可点件只有一枚」 |
| 2 故障隔离回归（规范 §9.3 那条从未实现的） | `next/tests/shell-ui.spec.mjs` 末段新 describe「故障隔离：全部载体停用（批次63 任务2）」；生产代码这一条**一个字都没改**——判据是「今天就已经不白屏」，把它钉住而不是顺手加固 | 同上两条 `it`：① 三栏不塌／竖条不没／空态话术在／状态栏照旧报数；② Ctrl+P 唤得起、列得出应用菜单动作、Enter 真执行（打开载体管理节＝自救那条路） |
| 3 收编 a：hotkeys 落真盘＋白名单收窄 | `next/shell/main.mjs:617` `hotkeysStoreFor()`（照 `settingsStore`／`carrierOverridesStore` 那三条硬规矩：坏档不崩不覆盖＋记账、`.tmp`＋rename 原子写、`lastWritten` 内容没变不写）＋`:650/:655` 注入 `session.loadHotkeys`／`session.saveHotkeys`；`next/shell/hotkeys.mjs:385` `createHotkeysFileStore`（fs 由主进程注入，本模块一个字都不 import `node:fs`，渲染层才能共用）；白名单收窄 `hotkeys.mjs:155` `STANDALONE_KEYS`＋`:185` | `command-face.test.mjs`「批次63 白名单收窄」「批次63 hotkeys.json 真盘往返」「批次63 主进程接线」 |
| 4 收编 b/c/d | ①`AppNext.vue:684` `runMenuAction`：菜单 id 命中 `menuActions` 走原动作表，命不中就查命令表里 **`group==='carrier'`** 那一条，把它的 `run` 串交给面板同一条 `resolveCommandRun`；三个调用点全部 `void runMenuAction(...)`（`:705` 菜单行点击、`:1767` 键位总线、`:2081` 原生菜单事件）。主进程侧 `menu:invoke` 的接受集**没动**（`ipcContract.mjs` 只补了一句注释）。②`hotkeys.mjs:99-106` `nativeAcceleratedIds()`（对照表＝`MENU_TEMPLATE` 里带原生 accelerator 且可绑定的那几条，模块级缓存、全仓一处）＋`matchHotkey` 跳过它们；`AppNext.vue:1689-1711` 的总线注释同步改写。③测试调整见 §2／§3 | `command-face.test.mjs`「批次63 单点化」「批次63 收编b」；`shell-ui.spec.mjs`「菜单落载体命令＝真执行」 |

---

## 2. 白名单收窄：改了哪一格，为什么

批次62 的 `normalizeAccelerator` 尾部对「不带修饰键」的候选只判 `name.length === 1`，于是 `a`／`1`／`P` 这类裸字符都算合法键位——作者随手改成裸 `P` 就会把命令面板的唤起键变成「打字就打掉了面板」。本批把这一格换成 `STANDALONE_KEYS`：

- **仍然合法**：`SPECIAL_KEYS` 那批独立键（`Esc`／`Enter`／`Tab`／`Space`／方向键／`PageUp…`／`Insert`／`Home`／`End`／`Delete`）＋功能键 `F1–F24`；带修饰键的组合照旧（`Ctrl+A`、`Alt+G` 都合法）。
- **一律不认**：裸字母、裸数字（含大小写与 `F0` 这类假名）。
- **存档里的裸字母**：`parseStoredHotkeys` 丢掉该键并记一条 `HOTKEYS_DROPPED_n`，其余条目照用；`applyBinding` 直接回 `HOTKEY_BAD_ACCELERATOR`，写不进表；序列化侧只丢不补，读回时缺的那条由 `defaultBindings()` 补齐（测试里把这条分工写明了，免得以后有人以为序列化会补默认）。

## 3. Ctrl+Shift+R 单点化：只留原生菜单那一把

实测 `nativeAcceleratedIds()` → `['project.reviewProposals']`（`menus.mjs` 里带 accelerator 的可绑定项此刻只有这一条）。效果：

- 原生菜单的 accelerator 保留（作者按 `Ctrl+Shift+R` 由 Electron 直接派发）；
- 渲染层键位总线不再命中它——批次62 那条「`matchHotkey` 按默认表回 `project.reviewProposals`」的断言因此**改成回 `''`**，并在原处写明理由：一次按键两处执行（菜单一次＋总线一次）＝提案审阅节被开两回。
- 对照表只有一处：`hotkeys.mjs` 从 `MENU_TEMPLATE` 现算，不另列白名单，菜单加键不用改两处。
- 键位表里那条**照旧在册可改**（作者能给它另配一把），面板也照旧列得出来——单点化的是「谁执行」，不是「谁能执行」。

## 4. 状态栏：四要素、取数源与两条硬判据

| 要素 | 取数源（全部现取，状态栏不是第二份真相） |
|---|---|
| ① 服务灯 | `serviceSnapshot.carriers`（批次49 `serviceLogPool` 的快照，与竖条状态点、设置页同一份）→ `{ id, title: carrierTitle, color, notices: unackedNotices }`；一载体一盏，整组只有**一个** button |
| ② 当前载体／页组 | `activeBoard.title`（`:456`）＋焦点那一页的 `group`（`main`→主组／`side`→侧组，`:458`） |
| ③「1＋N 的 N」 | `openWindows.length`（`:465`）＝工作区 v3 在册条数（页／浮窗／侧缘标签都算）——**工单口径**，与 spec v2:337 的「启用载体数」不同，见 §7 |
| ④ 焦点文档字数 | `pageDataOf(focusedInstance())` 上此刻装载的那份文档（`:474`）：有草稿读草稿（作者手上那份），没草稿读盘上那份的 `totalChars`；大纲／提案这类不可计字的文档如实回 `null` → 界面留破折号，不摆 `0 字` 冒充读数 |

两条判据（外部审计 H／OD craft）落成度量：可点件 `min-width/min-height: 24px`（底栏高 26px，`--control-hit-min` 那 36px 档放不下，取判据下限）；文本一律 `--text-secondary`。对比度不是估的，`acceptance.mjs` 按 WCAG 公式从 `src/styles/themes/legacy.css` **现读色值实测**：明亮 `#575b62` 压 `#f3f3f2` = **6.14:1**，深色 `#a9adb3` 压 `#1b1c1e` = **7.56:1**（`--text-muted` 那档明亮只有 ≈4.49:1，除灰色灯的空心描边——非文本——外一处不用）。

## 5. 故障隔离：三条判据各自钉在 DOM 上

夹具＝`carrierView()` 把两份载体都 `isEnabled:false` 且 `left/center` 清空（清单还在，设置页要能把它们重新打开）。

1. **不白屏**：`.nx-ribbon`／`.nx-index-window`／`.col-center`／`.col-dock` 四件俱全，中栏说得出「当前没有已启用的载体板块」。
2. **竖条仍显**：`.nx-ribbon` 在，格数＝0（一块板都没启用），底部主题钮照旧在——竖条是宿主的地盘，不是载体的延伸。状态栏照常报数：载体 `—`、在册 `0`、字数 `—`。
3. **面板仍可唤起可执行**：`Ctrl+P` 唤得起，列表＝应用菜单那份（`['settings.carriers','settings.preferences']`），过滤后 Enter 真的把「载体管理」节打开——「先靠命令面板把载体重新启用」这条自救的路没被自己的故障堵死。

## 6. 记账指标（不进闸）与 `bundleAssertions` 未改计数的理由

- `acceptance.mjs` 新增两条 `record`（`39/39`，即批次62 的 37 条 ＋ 本批 2 条）＋一行分布日志：
  - 状态栏在位（四要素齐、`<button>` 恰一枚）；
  - 文本对比实测：`#575b62/#f3f3f2=6.14:1`、`#a9adb3/#1b1c1e=7.56:1`；
  - **停用全部载体的面板枚举数 ≈ 19**（＝`command:list` 里 `group!=='carrier'` 的应用菜单动作数；此刻 53 条载体命令一条都不该出现）。这是主进程侧口径，渲染侧的真值由 §5 第 3 条用例钉住。
- `next/testing/bundleAssertions.mjs` **一个字没改**：状态栏是渲染层 SFC，随 `AppNext.vue` 一起进 bundle，没有新增构建入口、没有新增运行时读的文件（不涉及 skills／ui／AGENT.md 那三类拷贝），体积档也未越界（外壳 bundle 2136.3 kB < 2.5 MB）。本批也没有改任何工具计数（聚合工具面 21 未动）。

## 7. limitations（做不到的与口径冲突，逐条披露）

1. **「1＋N 的 N」两处口径不一致**：工单任务1 写「N＝在册窗数，数据从 workspace v3 现取」，`spec v2:337` 写「N＝启用载体数」。按**工单**实现（`openWindows.length`）。要统一到另一口径只需换 `AppNext.vue:465` 那一行，但那是改判据，不归执行方裁。
2. **状态栏样式没进 `next-shell.css`**：允许文件清单里没有 `next/shell/styles/next-shell.css`，所以 `.nx-statusbar` 那一段收进 `StatusBar.vue` 自己的 `<style scoped>`（视觉合同门禁扫的是 shell 目录下全部 `<style>` 块，规则照旧生效）。代价：底栏高度 26px 这条度量没法抽成本地 `--nx-*` 变量——门禁只认 `next-shell.css` 里的定义，组件自定义 token 在它眼里等于没定义，于是就地写死两处（`height`／`line-height`）。
3. **`main.mjs` 只动了 hotkeysStore 那一段**：工单允许清单括号里写着「hotkeysStore＋状态栏数据源」，但状态栏四格读数今天全在渲染层的既有事实源里（`serviceLogPool` 快照经 `runtimeServiceLog` 通道、工作区 v3 在 `hostWorkspace`、文档字数在那一页自己的 `useBoardData`），没有任何一格需要主进程新出口。为凑「数据源」而加通道就是开第二条路，故未加。
4. **故障隔离一条生产代码都没改**：这一批只做「钉住今天的正确行为」。规范 §9.3 里更狠的那一档（单块载体加载期抛错、清单半坏）不在本批判据内，仍归后续。
5. **真窗口实拍交调度方**：工单验收判据写明由调度方接管，本批未起 Electron、未截图，因此「24×24 命中区在真 DPI 下的实际像素」这类只有真窗口能给的数据缺席；jsdom 里核对的是 DOM 与读数口径。
6. **vitest 有一次与批次无关的抖动**：`carrier-pane-real.spec.mjs` 在全量并发跑时偶发 unhandled `McpError -32000: Connection closed`（用例本身 3/3 通过、单独跑与复跑均 `EXIT=0`）。本批第一次全链跑撞上这一次导致链断在第三段，复跑五段全绿。这不是本批引入的（该文件与新增用例无共享夹具），留此记账。
7. **白名单的边界就是原表，一格没加**：`STANDALONE_KEYS` ＝ `SPECIAL_KEYS` 的全部值（`hotkeys.mjs:30-64`：Esc／Enter／Tab／Space／方向键／Home／End／PageUp／PageDown／Insert／Delete／Backspace／Plus／Minus／Equal）∪ `F1–F24`。`F0` 这类假名由 `FUNCTION_KEY:66` 挡住，本批前后都不认；`PrintScreen`／`ScrollLock` 不在原表里，**本批之前也不认**——收窄没有改变它们的可绑定性，要不要放它们进表是另一笔裁量，没顺手加。

---

## §8 调度方验收

（待补：真窗口实拍四要素＋全载体停用后面板可唤起；§7 第 1 条口径冲突由调度方裁定统一方向。）
