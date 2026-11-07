# 批次68-R2 工单：悬浮球锚主面板＋世界书维基阅读版式＋Agent composer 专属化（2026-11-07）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。**前置：批次68-R1（字体/字号/文案归一）已落地合入后才开工**——本批同文件冲突面大（AssistantDialog/next-shell.css）。
> 触发：作者 2026-11-07 三条前端需求（原文要点）：①悬浮球悬的应该是**主面板**右下角，不是 Agent 右下角；②世界书太死板、左右比例奇怪，参照 NovelPedia（作者自有仓库）的 HTML 版式——做成静态 HTML 都可以；③Agent 面板底部改成**专属 Agent** 形式（参照作者给的 Linear 风截图）。

## 参照物

- **NovelPedia**：已克隆 `D:/Pinax-e2e/ref-Novelpedia`，版式范本 `demo/index.html`／`src/index_template.html`。版式语言＝维基百科阅读版：右浮 Infobox（可占右侧半屏 `ib-wide: min(46%,430px)`＋图谱 260px）、`sec>h2` serif 章节底线、`.lead` 导语、`.quote` 引用块带出处、`.tag` 可点蓝链、来源徽章（原文/推断/统计）、S/A/B/C 权重徽章＋侧栏 `lvl-dot`、`.statgrid` 数据卡、`style-chip` 子导航、`fold` 折叠。
- **Composer 截图**（作者提供，Linear 风）：圆角卡片容器；第一行输入（占位「发消息或创建任务，/ 调用指令，@ 文件或对话」）；第二行控件排＝左「＋」「⊙ 自动审查 ▾」右「模型 chip ▾」「麦克风」「圆形发送钮 ↑」；卡片下方一条小字状态排「01 task · 缓存命中 77% · 5%…」。

## 任务（三条）

### 任务一：悬浮球锚主面板（小，先做）

`CollapseOrb` 现为 `position: fixed; right: 24px; bottom: 54px`（next-shell.css:1102）——落在 Pi-Agent 右栏上。改为**挂进主面板容器**（col-center 中心区）内 `position: absolute; right/bottom` 贴中心区右下角：球跟着主面板走，Agent 面板永远不被它盖住。落点仍是收起态页的唯一回收入口（守卫①②语义不变），z 档沿用 `--z-floating-action`。侧组对半时球随主面板（不居屏幕中缝）。

### 任务二：世界书维基阅读版式（主体）

把 worldbook 面从「树＋textarea 详情」改造成**三栏阅读版**（参照 NovelPedia 版式语言，比例从「奇怪」归位）：

- **布局**：左条目树（窄列 ≈260px，带权重 lvl-dot 与类别分组）·中央阅读版（flex 弹性，真正的阅读列）·右侧 Infobox 卡（`min(46%, 430px)`，含条目元信息＋关系图 svg 占底部 260px）。窄窗口时 Infobox 折到阅读列下方（@media 语义）。
- **阅读版式**（mdRender 之上加 wiki 皮）：条目名＝大标题；正文按 md 结构分节（h2 带底线）；首段 `.lead` 导语样式；引用行（> 块）＝quote 带出处；条目间蓝链（既有 wikiLink 链路）渲染为 `.tag` 胶囊可点；类别/层级元信息入 Infobox（类别徽章、层级 dot、字数、修订号、来源标签如实）；关系列表入 Infobox（与 EntryGraph 同一数据源，0 边时如实文案——守卫既有口径不放宽）。
- **比例死口径**：树:阅读:Infobox 起排 `260px : 1fr : min(46%,430px)`，拖拽分隔不做（本批不定分隔条语义），Infobox 可整体收起（一钮，收起后阅读列吃满）。
- **编辑态**：保留现有「编辑」切换（textarea 底稿不变），编辑完回阅读版式——阅读是常态，编辑是动作。
- **红线**：条目数据形状、蓝链解析（wikiLinkRanges）、EntryGraph 数据源、worldbook 载体清单与工具面一字不动；本批纯呈现层。

### 任务三：Agent composer 专属化（参照截图逐项）

重排 `AssistantDialog` 底部为**卡片容器三层**：

1. **输入行**：textarea 顶部化（rows=1 自长高），占位语改「发消息或创建任务，/ 调用指令，@ 素材」（三类 typeahead 语义不变，判定/回填仍在 composerTypeahead 纯模块）。
2. **控件排**（输入行下方、卡片内）：
   - 左：「＋」钮＝插入菜单（@素材／/技能／#工作流 三类，点击插入对应前导符并唤起既有 typeahead——不新增第二套插入通路）；
   - 「写模式 chip」：现审查/自动模式徽章收进来做 ▾ chip（点开的两项与自动模式确认对话逻辑照旧，禁用态口径不变）；
   - 右：「模型 chip」：显示当前模型名，点开列运行时模型面清单（无清单时只显示不可点——不编造）；「停止」钮只在 busy 时出现在发送钮位；**发送钮改圆形主色 ↑**（主色走既有 token）；
   - **麦克风不摆死钮**：语音后端本批不做，按钮不出现（等真功能再入排）。
3. **状态排**（卡片下方小字一行，全部真数据）：在途任务数（真实 ask 计数）· 上下文组装读数（envelope blocks/chars）· 本轮 tokens（既有 usage 链，无回报显「未回报」口径不变）。既有「工具面」折叠层与 session-usage 收进状态排下方折叠区（工具面中文名化由 68-R1 承担，本批只挪位）。
4. **兼容面**：typeahead 菜单、IME 229 兜底、abort 链、编辑重发/分支/切换器（77-R2）全部语义零变化；窄屏不动（禁止边界沿用批次77）。

## 允许文件

`next/shell/CollapseOrb.vue`、`AppNext.vue`、`AssistantDialog.vue`、`EntryDetailPanel.vue`、`EntriesCategoryTree.vue`、`EntryGraph.vue`（只动挂载位/样式）、`worldbook 相关 shell 组件`、`styles/next-shell.css`、`next/tests/**`、执行记录 `docs/plan/pinax-electron-next-m2-batch68r2-20261107.md`。越界先补登记。

## 禁止边界

不动 mdRender 管线与 wikiLinkRanges、载体清单/工具面/workspace 状态轴、ExternalAppHost 安全属性、`src/**` 与 `server/**`；不加依赖；不自设阈值当闸；visual-contract 既有守卫零放宽（新增判据随登记进册）。

## 验收判据

`verify:next` 五段全绿读数只增不减；真窗复拍（调度方）：①球贴主面板右下角且 Agent 面板无遮挡 ②世界书三栏比例按死口径、Infobox/蓝链/权重 dot 在真窗可见 ③composer 三层结构与截图逐项对得上（＋、写模式 chip、模型 chip、圆发送、状态排真数据、无死麦克风）。

## 记账指标

世界书三栏宽度实测值；composer 控件排逐项对照表；悬浮球坐标前后对照。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录落盘 `docs/plan/pinax-electron-next-m2-batch68r2-20261107.md`。）
