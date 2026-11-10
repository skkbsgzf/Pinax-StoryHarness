# 批次68-R2 执行记录（2026-11-07）— §7 执行方回填

> 工单：`docs/plan/pinax-electron-next-m2-batch68r2-ticket-20261107.md`。执行方：Qoder（Pinax-Electron-Next 实现工程师）。
> 口径照旧：不执行 git 命令、不启动/不杀 electron 进程、真窗复拍归调度方。

## 一、任务落地

### 任务一：悬浮球锚主面板
- `next/shell/styles/next-shell.css` `.nx-collapse-orb`：`position: fixed; right: 24px; bottom: 54px`（视口坐标，落在 Pi-Agent 右栏上）
  → `position: absolute; right: 24px; bottom: 16px`（钉进 col-center 主面板容器内右下角；状态栏在中心区之外，54px 让位不再需要，改 16px）。
- 层级不新增档位：仍 `z-index: var(--z-floating-action)`（260）。收起态页唯一回收入口语义（守卫①②）不变；侧组对半时球随主面板走，不居屏幕中缝。
- 门禁：visual-contract 中 CollapseOrb 那条按「主面板内 absolute」重写（读数只增不减）。

### 任务二：世界书三栏维基阅读版式（主体）
- **三栏全部长在 `EntriesBoard.vue` 内**（「worldbook 相关 shell 组件」，允许文件）：
  `nx-wiki-tree(260px) : nx-wiki-center(1fr) : nx-wiki-infobox(min(46%,430px))` 死口径起排；
  窄屏（≤860px）`flex-wrap` 折行，信息卡 `order:3` 整条折到阅读列下方。
- 左树：类别分组＋权重 lvl-dot。S/A/B/C 档由 `computeBacklinks`（wikiLinks.mjs 纯函数，导入未改）**按被引用次数统计**推导（s≥6／a≥3／b≥1／c=0），tooltip 与信息卡如实写「按被引用次数统计」——条目数据形状没有作者权重字段，红线不许改，故不冒充权重（见 limitations）。
- 中阅读列：`EntryDetailPanel` 加 `wiki` 开关（默认关，独立详情面行为不动）——条目名＝大标题（`h1.doc-title.nx-wiki-title`，展示体沿用 .doc-title 白名单族，不新声明 --font-display）；md 正文挂 `.entry-text.nx-wiki-article` 皮：h2 章节底线、首段导语（--nx-fs-xl）、引用块竖线、蓝链 `.nx-wikilink` 做成胶囊（--nx-radius-pill）可点。编辑态 textarea 原样，阅读是常态、编辑是动作。
- 右信息卡：`<dl>` 元信息（类别徽章／层级 dot＋被引用 N 次／字数／修订／类型／来源如实「原文／未建档」）＋关系列表（与详情面同源，wiki 态下详情面让位、不摆两遍）＋底部图谱缩览 260px（`EntryGraph` 加 `variant="infobox"`，只动挂载位与画布高度变量 `--nx-entry-graph-height`，边解析与 0 边如实文案一字未动）。
- Infobox 一钮收起（`entries-infobox-collapse`／展开 rail `entries-infobox-expand`），收起后阅读列吃满（flex 自然给出，收起态只改信息卡自身 `flex: 0 0 auto`）。
- 红线核对：条目数据形状、wikiLinkRanges、mdRender 管线、载体清单与工具面、EntryGraph 数据源全部未动。
- `CarrierPaneHost.vue`：entries-workspace 两段式（board/detail）换成单 `EntriesBoard` 挂载＋错误/警告随行（见「二、越界补登记」）；`viewKind==='entry-detail'` 独立详情面与 Ctrl+S 分派未动。
- 判据翻案登记：批次76-R2「详情面头部不许有 .doc-title」按工单结构翻案——条目名大标题是工单②明文要求，shell-ui 与 批次44 蓝链用例改为钉 `.nx-wiki-title` 读数（判据逻辑未放宽，读数点变了原因写在该用例行内）。
- jsdom 链不读 CSS 文件（`import.meta.url` 在 jsdom 变换下是 http 协议，readFileSync 即抛）——三栏死口径的**声明层**核对归 `visual-contract.test.mjs`（node:test 真 fs），shell-ui 只核 DOM 结构。

### 任务三：Agent composer 卡片三层
`AssistantDialog.vue` 底部重排（结构锚点即用例锚点）：
1. **卡片** `data-test="composer-card"`：①输入行（`.authoring-knowledge__input-row` 选择器家族原样——`… textarea` 三十多条既有用例一条没改；typeahead 弹层原地；placeholder 缺省改「发消息或创建任务，/ 调用指令，@ 素材」，RuntimeDock 不传 placeholder，改动收在本组件）＋②控件排 `composer-controls`。
2. **控件排逐项**（对照截图）：
   - 左「＋」`composer-plus`：弹层三项（@素材／/技能与命令／#工作流角色），点击＝往光标处插对应触发符并唤起**同一条** typeahead——`insertTrigger(char)` 是 openSkillMenu 那段就地泛化，键位那条路共用它，**没有第二套插入通路**；
   - 「写模式 chip ▾」：原页眉徽标收进来，类名/`requestMode`/确认行/三档口径一字未动，也不新加禁用态；▾ 走 CSS `::after`——徽标文本读数被既有用例钉着「审阅／自动／锁定」三个词，箭头不许混进读数；
   - 右「模型 chip」：`modelNames` 缺省空——**无清单时 disabled 只显示「模型未回报」（不编造）**；有清单才显 ▾ 并可点开只读清单（切模型不归本批界面）。本批探针通路只有 endpoint 与状态、没有模型名，运行时实况即那行如实显示件；
   - 「停止」只在 busy 时出现在发送钮位（v-if busy→stop，v-else→发送钮），发送钮仍是圆形主色 ↑（原样式未动）；
   - **麦克风不摆死钮**：语音后端本批不做，屏上连「麦克风」三个字都不出现（visual-contract 新增判据钉这一点）。
   - 新按钮全部落进共享控件词汇：＋＝`control-icon`、菜单行＝`nx-row`、模型 chip＝`control-quiet`（门禁「每个按钮都落在共享词汇里」零放宽）。
3. **状态排** `composer-status`（卡片下方小字，全部真数据）：`在途 N`（RuntimeDock 真实 ask 计数进模板）· `上下文 B 块／C 字`（最近一条真 `envelope` 运行事件：liveTrail 优先，回找定格 message.trail）· `本轮 T tokens`（既有 usage 链）；缺数据如实「未回报」，不换算不落 0。
4. 自动档确认行挪到卡片下方（文案与三枚钮一字未动）；「工具面」details 与 session-usage 收进状态排下方 `composer-more` 折叠区（内容只挪位）。
5. 兼容面：typeahead 菜单、IME 229 兜底、abort 链、编辑重发/分支/切换器语义零变化（全库既有用例未改一行即通过）；窄屏未动。

## 二、越界补登记

| 文件 | 越界原因 | 改动面 |
|---|---|---|
| `next/shell/CarrierPaneHost.vue` | 任务二三栏排版落在 EntriesBoard，宿主的两段式容器必须换挂载 | 仅 entries-workspace 模板块（board/detail 两子格→单 EntriesBoard＋错误/警告随行）；其它 viewKind、Ctrl+S 分派未动 |
| `next/shell/RuntimeDock.vue` | 任务三状态排「在途」读数唯一真源是它的 ask 计数（模块级裸 `let` 进不了模板） | `let inflight` → `const inflightCount = ref(0)`（beginWork/endWork 口径一字未动）＋挂载点传 `:inflight="inflightCount"` |

其余改动全部在工单允许文件清单内（CollapseOrb/AssistantDialog/EntryDetailPanel/EntriesBoard/EntryGraph/next-shell.css/next/tests/本记录）。

## 三、limitations（做不到 / 不如预期的如实条目）

1. **真窗复拍未做**：按约束不启动/不杀 electron 进程。三栏比例、悬浮球落点、composer 三层的**实测像素**归调度方复拍；本记录只给声明层死口径与测试读数。
2. **lvl-dot ≠ 作者权重**：条目数据形状（红线）没有权重字段，S/A/B/C 由被引用次数统计推导并如实标注口径；要作者自报权重须动 worldbook 数据面，超出本批「纯呈现层」边界。
3. **模型 chip 本批是显示件**：探针通路（prefsProbeModelPlane）只回 state/endpoint、无模型名，故运行时实况为「模型未回报」＋不可点（这正是工单「无清单时只显示不可点——不编造」那格）；`modelNames` prop 与只读清单弹层已就位，等运行面给出真名即可点亮，无需再改界面结构。
4. **拖拽分隔不做**（工单原文：本批不定分隔条语义）；三栏为死口径 flex 起排。
5. **bundleAssertions 的 EBUSY 风险**（68-R1 L1 先例）：comic 预览服务若在跑会锁 build 目录。本次整链 `npm run verify:next` 实跑通过，无此故障；后续批次若红在这一条先查占用再改代码。
6. AGENTS.md 硬规则表点名的项目 skills（ui-style-check / testing-verification / docs-status-handoff / worldbook-workflow / commit-conventions）本会话不在可用 Skill 清单内——按其口径以本记录＋门禁读数代替交付。

## 四、记账指标

### ① 悬浮球坐标前后对照
| | 前 | 后 |
|---|---|---|
| 定位 | `position: fixed`（视口） | `position: absolute`（col-center 内） |
| 偏移 | right 24px / bottom 54px | right 24px / bottom 16px |
| 层级 | `--z-floating-action`（260） | 同档未动 |
| 落点读数 | Pi-Agent 右栏下缘 | 主面板右下角；Agent 面板零遮挡 |

### ② 世界书三栏宽度（声明层死口径；真窗实测归复拍）
| 列 | 起排 | 窄屏（≤860px） |
|---|---|---|
| 条目树 | `flex: 0 0 260px` | `flex: 0 0 40%; min-width: 180px` |
| 阅读列 | `flex: 1 1 auto`（≈1fr） | `flex: 1 1 45%; min-height: 140px` |
| 信息卡 | `flex: 0 0 min(46%, 430px)`；收起态 `0 0 auto` | `order: 3; flex: 1 1 100%`（折到阅读列下方） |
| 信息卡缩览图 | `--nx-entry-graph-height: 260px`（board 态默认 340px 不动） | 同左 |

### ③ composer 控件排逐项对照表（截图 → 实况）
| 截图元素 | 本批落点 | 读数/状态 |
|---|---|---|
| 圆角卡片容器 | `.nx-composer-card`（radius `var(--radius-surface)`） | DOM 锚点 `composer-card` |
| 输入行（占位三用） | input-row textarea，rows=1 自长高 | placeholder「发消息或创建任务，/ 调用指令，@ 素材」 |
| 「＋」钮 | `.nx-composer-plus`（control-icon）＋三项弹层菜单 | 插入触发符走 insertTrigger 单通路 |
| 「⊙ 自动审查 ▾」 | 写模式 chip（原 mode-badge 收进控件排，▾ 走 ::after） | 三档/确认行/禁回退口径未动 |
| 「模型 chip ▾」 | `.nx-composer-model`（control-quiet） | 无清单＝disabled＋「模型未回报」（不编造） |
| 「麦克风」 | **不摆**（语音后端本批不做） | visual-contract 反向钉死 |
| 「圆形发送钮 ↑」/停止 | 原 send（50% 圆主色）；busy 时同位换 stop | v-if/v-else 共用发送位 |
| 卡片下方状态排小字 | `.nx-composer-status` 三项 | 在途＝ask 计数真值；上下文＝真 envelope 事件；tokens＝真 usage；缺→「未回报」 |

### ④ 门禁读数（只增不减核对）
- `npm run verify:next` **五段全绿**（acceptance.mjs → node:test → vitest → lint:next → bundleAssertions，2026-11-07 实跑）。
- node:test：`next/tests/*.test.mjs` **827 pass / 0 fail**（含 visual-contract **39/39**，本批新增 CollapseOrb 重写 1＋任务二结构闸 1＋任务三结构闸 1）。
- vitest shell：16 文件 **242 pass / 0 fail**（本批：三栏用例重写 1、任务三 composer 新增 1、批次44 蓝链翻案 1）。
- 新增判据均随登记进册；既有守卫（legacy 词汇／token／命中区 24 线／字号单轨／出屏文案／字体三族）零放宽——新按钮以 `control-icon／nx-row／control-quiet` 挂进既有词汇过关。

## 五、§8 留给调度方

真窗复拍三点（工单验收判据原文）：①球贴主面板右下角且 Agent 面板无遮挡；②三栏按死口径起排、Infobox/蓝链胶囊/权重 dot 真窗可见、收起钮有效；③composer 三层与截图逐项对得上、状态排三项为真数据、无麦克风死钮。

---

## §8 调度方验收（Zcode · 2026-11-07）

**判定：通过（含调度方补刀）。** 门禁独立复跑 exit 0：44/44 · 827/827 · 242/242 · eslint 0 · 打包过。执行记录 §7 扎实：两处越界（CarrierPaneHost 换挂载、RuntimeDock `let`→`ref`）补登记齐全；判据翻案（页态 .doc-title → wiki 态 .nx-wiki-title）工单②有据；lvl-dot 统计口径诚实不冒充作者权重。

### §8-1 真窗对图实拍（截图 148/149，`next-batch65a-shots/png/`）

- **任务一悬浮球**：`insideCenter:true · overAgent:false`，相对主面板右缘 24px／底缘 16px——球贴主面板右下角，Agent 面板零遮挡。✔
- **任务二世界书**：三栏死口径生效（树 260:中列弹性:信息卡 min(46%,430)）；wiki 阅读版真窗可见——大标题、蓝链胶囊（务虚学会，11 枚在册）、引用块竖线、信息卡 dl 元信息＋关系图缩览。✔
- **任务三 composer**：卡片三层结构成立——控件排「＋／审阅 chip／模型 chip（无清单 disabled 显示『模型未回报』，不编造）／圆形发送」；**麦克风零出现**（新判据钉住）；状态排全真数据「在途 0 · 上下文 17 块／16526 字 · 本轮 tokens 未回报」。✔

### §8-2 调度方补刀（窄容器自适应，实拍暴露的实现缺陷）

侧组开着 ComfyUI 时主组只剩 ~543px，三栏死口径把阅读列压成 **53px 竖条**（工单折行判定用的是视口 @media，1440 视口不触发——**容器**窄了不折叠）。补刀：

1. `EntriesBoard.vue`：ResizeObserver 实测容器宽，**<760px 自动收信息卡**（作者手动收/展开后以作者为准）；jsdom 无 ResizeObserver 则跳过（排版增强不进测试环境，声明层判据归 visual-contract）。
2. `next-shell.css`：阅读列 `min-width:240px` 保底；`is-infobox-collapsed` 时树可压缩（min 180）、收起态窄条瘦身。
3. 终拍实测：容器 624＝树 180＋中列 305＋窄条 114＋间距，**零溢出**（scrollWidth=clientWidth）；全宽主组（≥760）自动回到三栏满版。

### §8-3 limitations 追认

- 模型 chip 本批为显示件（探针无模型名）：追认——等运行面给真名即可点亮，无需再改结构。
- lvl-dot=被引用次数统计：追认，等作者要真权重再动数据面。
