# 批次76-R2 执行记录：窗 chrome 压平（浏览器 IDE 式一层页签）＋应用面高度链修复（2026-11-05）

> 工单：[批次76-R2 工单](./pinax-electron-next-m2-batch76r2-ticket-20261105.md)。执行方=Qoder CLI；调度方=Zcode（§8 待补）。
> 本批性质＝**呈现层手术**：五条任务全落在「同一屏幕不许出现两行都在列同一批 pane」这一句裁定上，workspace v3 的状态轴语义（page/tab/floating/maximized、main/side、placement 数据形状）一字未改。

## §7-1 五条任务落点

**任务1 应用面高度链（守卫⑫）**——断点原本在 `.nx-pane-window-body`：它有定高（830px 实测）却是**块容器**，于是子节点 `.pane` 写的 `flex:1 1 auto` 完全惰性，`.pane` 按 content 收成 216px，`.nx-app-pane` 的 `height:100%` 拍平在这 216px 上，iframe 只剩 150px。修法是**把链上每一环统一成同一族声明**（`display:flex` ＋ `flex-direction:column` ＋ `flex:1 1 auto` ＋ `min-height:0`），并**删掉所有 `height:auto`／`height:100%`**：

| 环 | 处 | 现状 |
| --- | --- | --- |
| 窗 body（断点就在这） | `styles/next-shell.css:1050` | 从块容器改成 flex 列 |
| 载体面板根 | `styles/next-shell.css:613` `.pane` | flex 列＋`flex:1 1 auto`＋`min-height:0` |
| 应用面外层 | `CarrierPaneHost.vue:2081` `.nx-app-pane` | 同上（`height:100%` 已删） |
| 跨组件那一环 | `CarrierPaneHost.vue:2087` `.nx-app-pane :deep(.nx-external-app)` | 同上 |
| 应用面根 | `ExternalAppHost.vue:117` | 同上 |
| iframe 本体（链尾＝flex **子项**，不必自己是容器） | `ExternalAppHost.vue:124` | `flex:1 1 auto`＋`min-height:0`＋`width:100%` |

jsdom 量不到排版，所以 `clientHeight ≥ 500` 这条**不由测试冒充**——守卫⑫ 量的是声明链（见 §7-4），真机半屏复拍记在 limitations 的「未真机复核」账上。

**任务2 页态窗头撤除（守卫⑪）**——`PaneWindow.vue:280` 的 `<header>` 加 `v-if="state !== 'page'"`：页态整行不渲染（活动页签就是标题行），× 与拖拽手柄落在页签上；**floating／maximized 照旧给窗头**（浮窗没有页签可代替标题行，窗头还是拖动／双击最大化／右键改形态的挂点）。页签侧配套：`PaneTabStrip.vue:57 onTabPointerDown` 只对 `form==='page'` 的签发 `drag`，`:75 onTabClick` 用 4px 位移守卫压掉「拖完顺手又发一次揭示」（不靠 `preventDefault` 的跨浏览器语义）。

**任务3 `nx-center-tabs` 退役并入页签条**——顶部那行「视图切换」整条删除（连同 `chooseCenterPane`／`centerPaneTabs`／AppNext 的 `<style scoped>` 那一小节），职责并进**同一条** `PaneTabStrip`：一块板声明了多块中栏 pane 时，没开出来的那些以**虚线「待开签」**出现（`PaneTabStrip.vue:163 data-pending-pane`），点它＝`AppNext.vue:1817 openCenterPane`——先把同载体那块兄弟面收进悬浮球（旧语义一条没少：切换＝旧窗收、新窗占位），再开这一面。判据落在守卫⑪ 用例里：`[data-test="center-pane-tabs"]` 必须不存在。

**任务4 应用面 chrome 减层**——`nx-external-app-head`（URL 行）与 `nx-app-pane-foot`（常驻复制脚行）都撤干净，应用面＝iframe 独占（空态「没有声明地址」与失败态文案保留，`sandbox`／`referrerpolicy` 一字未动，批次54 的回环覆盖逻辑未动）。地址从**画的 chrome** 改成**报的读数**：`ExternalAppHost.vue:32/77` 用 `defineEmits(['address'])` ＋ `watch([url,urlSource],…,{immediate:true})` 上抛，宿主 `AppNext.vue:164 appAddress`（reactive，所以tooltip与状态栏不用另加响应轴）收下，三个读处：① 页签 `title` ＋ `data-page-address`；② `StatusBar.vue:57 carrierTitle` 在既有「当前载体」条目**末尾**接一段地址（不新辟一格，`:97 data-test="status-address"`）；③ `PaneFormMenu.vue:56 addressItems` 的「复制地址单开」——`AppNext.vue:1459 copyAppAddress` 是唯一碰剪贴板的地方（内容组件不许自己抄），反馈写进这一页数据面既有的 `notice` 行，不新开 chrome。非应用面的页 `address` 为空 ⇒ 状态栏与菜单都不凭空多出这一段（有用例正向钉住）。

**任务5 回归口径同步**——既有页签／窗头／拖拽／右键菜单／悬浮球／守卫④吸附预览的用例按新层级改写，**行为语义一条未删**（判据换了落点，断言的方向和数量只增不减）。

## §7-2 越界补登记

工单「允许文件」清单外的改动，先登记后动手：

| 文件 | 为什么必须动 | 动了什么 |
| --- | --- | --- |
| `next/shell/PaneFormMenu.vue` | 任务4 要求「复制地址单开」进**页签右键菜单**，而菜单项是这张组件的产物；不改它就没有第三个读处 | 新增 `address`／`addressNote` 两个 prop 与第三组菜单项（`data-test="form-menu-copy-url"`），高度记账把新组算进去；`defineExpose` 补 `addressItems`。词表与既有的形态／页组两组语义未动 |

## §7-3 记账指标（不进闸）

- **同屏 chrome 行数**：诊断时 5 行（`nx-center-tabs` → `nx-page-tabstrip` → `nx-pane-window-head` → `nx-external-app-head` → `nx-app-pane-foot`）→ 页态实测 **1 行**（只剩 `nx-page-tabstrip`，待开签与 ×／拖拽都在这一行）；浮窗／最大化态 **2 行**（窗头 ＋ 窗内内容动作行）。工单目标 2，实况压到 1。
- **iframe clientHeight**：未真机复核（见 §7-5），只有声明链判据。
- bundle 记账：外壳 2019.3 kB／渲染层 js 1275.1 kB／主进程 1688.6 kB（未新增数值线）。

## §7-4 新增机器判据（只加条，未放宽任何既有条）

`next/tests/visual-contract.test.mjs`（声明级，两条）：

- **守卫⑪**（`test:973`）：`<header v-if="state !== 'page'" … class="nx-pane-window-head">` 必须在 `PaneWindow.vue` 里逐字命中；`defineExpose` 仍交得出 `startDrag`；退役物零残留（`.nx-center-tabs`／`chooseCenterPane`／`centerPaneTabs`／`center-pane-tabs`）；AppNext 零 `<style scoped>`；页签条须含 `pendingPanes|data-pending-pane|open-pane|entry.form !== 'page'|emit('drag'` 且**全行只一枚 `<button>`**（防「形态钮做成常驻死按钮」回潮）。
- **守卫⑫**（`test:1018`）：§7-1 表里 6 环逐条量 `display:flex`（链尾 iframe 除外——它是 flex 子项）、`min-height:0`、`flex:1`，并拒绝 `/height:\s*(auto|100%)/`；被撤的节点名（`nx-external-app-head/-url/-source`、`nx-app-pane-foot`、`app-copy-url`）**剥注释后**必须零命中（注释里记「撤了什么」是留痕，不算还画着）；`<iframe>` 恰好一枚；地址读数通道正向钉（`data-app-url`、`defineEmits(['address'])`）；**安全属性反向钉死**（`referrerpolicy="no-referrer"`、`sandbox="allow-scripts allow-forms allow-same-origin allow-popups"`）防「顺手清理」改掉；宿主三处落点在册；并断言 `ExternalAppHost` 源码里不出现剪贴板调用。

`next/tests/shell-ui.spec.mjs`（运行时，新增 2 条＋1 条正向对照）：地址三读处端到端（面上无 URL 行／无常驻钮 → 页签 `data-page-address` 与 `title` → 状态栏 `status-address` → 右键菜单点「复制地址单开」真打到 `clipboard.writeText` 并落 `.pane-notice`）；负向对照（正文页无地址 ⇒ 状态栏与菜单都不多出那段）；守卫⑪ 正向那一半（浮窗**必须**渲染窗头）补进「形态只从右键菜单改」用例。

## §7-5 门禁读数表（`npm run verify:next`，exit 0）

| 段 | 本批前 | 本批后 |
| --- | --- | --- |
| 验收 `next/testing/acceptance.mjs` | 44/44 | **44/44** |
| 内核 `node --test next/tests/*.test.mjs` | 815/815 | **817/817**（＋守卫⑪⑫ 两条） |
| 界面 `vitest run --config next/vitest.next.shell.config.mjs` | 235/235（15 文件） | **237/237（15 文件）**（＋地址读数 2 条） |
| eslint `next --ext .mjs,.vue --max-warnings 0` | 0 警 | **0 警** |
| 打包 `next/testing/bundleAssertions.mjs` | 全过 | **全过** |

三条只增不减：＋2 内核、＋2 界面、验收条数不变（本批无内核侧新模块）。

## §7-6 limitations（做不到的写在这里）

1. **未真机复核**：本会话不启动/不杀 Electron，故没有半屏分皮下 Toonflow／ComfyUI 两 iframe 的 `clientHeight ≥ 500` 实测值——守卫⑫ 只能量到声明链，**这条验收判据待调度方实拍**。
2. **窄屏适配**按工单不动（本批不做窄栏新设计）。
3. **未 commit**（作者纪律，由 Zcode 统一提交）；全程未跑 git 命令。
4. 待开签的「先收兄弟面再开这一面」用的是既有 `showBoardWindow` 通路，没有新造窗型；但**同屏多块待开签的排序**沿用清单声明顺序，未按使用频率排（未做，等实拍反馈再定）。
5. 状态栏地址段是**截断显示**（`max-width:260px` ＋ ellipsis），完整值在 `title` 里；不做点击复制（复制归右键菜单，避免同一件事两个入口）。
6. **测试隔离的一处旧患（本批发现、未修）**：`shell-ui.spec.mjs` 里未 `unmount()` 的 AppNext wrapper 会把 document 级 `keydown` 监听漏给后续用例——一条用例中途抛错时，前面那些壳实例仍在替每次 Esc 跑 `collapseTopWindow()`，表现为悬浮球计数虚高（3 vs 1）。本批通过把受 chrome 影响的用例改写到新层级（每条都以 `wrapper.unmount()` 收尾）绕开，**没有去动共享的文档级监听注册**，属既有结构问题，留给后续单独收。

---

## §8 调度方验收（Zcode · 2026-11-05）

**判定：通过。** 门禁独立复跑 exit 0：验收 44/44 · 内核 817/817（＋2：守卫⑪页态无窗头＋守卫⑫应用面独占的声明链判据）· vitest 237/237（＋2）· eslint 0 · 打包门禁过。diff 评审：PaneTabStrip 拖拽/点击判分（4px 位移阈值＋draggedOnThisPress 防误触回收）实现干净；待开页签走 routeOpen 唯一通路，未长第二套状态轴；ExternalAppHost 地址改 data-* 读数＋watch immediate 上抛（覆盖补上后宿主也能拿到）合理。

### §8-1 真窗口复拍（守卫⑪⑫的真机证据）

截图 `D:/Pinax-e2e/next-batch65a-shots/png/139-141`：

- **139**：页态两窗 `hasHead:false`（窗头行整撤）· `nx-page-tabstrip`=1 · `nx-center-tabs`=0 · `nx-external-app-head`=0 · iframe clientHeight **921px**（此前 150px）。
- **140/141**：点页签唤出 media.toonflow——对半双嵌终图：Toonflow 真内容满栏渲染（左）、ComfyUI 半栏（右，clientHeight 921）· 同屏仅一条页签行 · 地址进底栏状态栏「载体 … 侧组 http://127.0.0.1:8188」。
- 工单验收判据「iframe ≥500」**达成**（实测 921）；「页态无窗头」「同屏一条页签行」**达成**。

### §8-2 提请裁定（执行方 §7 提出，调度方附议）

1. **守卫编号撞车**：本批⑪⑫与批次77-R1b 线的⑪同号不同义——建议守卫编号改为「批次-序号」复合式，下批工单起执行；历史编号不回改。
2. 执行方发现的 `shell-ui.spec.mjs` 未 unmount 残壳漏 keydown 旧患：登记不扩，留待批次68 视觉收口时一并处理。
3. `Recently done` 条目超 10 条上限：下批 STATUS 整理时裁剪。

### §8-3 提交

commit-worktree ＋ push StoryHarness feat 分支，CI 五 check 关注 Node22。
