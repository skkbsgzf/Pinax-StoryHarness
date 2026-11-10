# 批次68-R5 执行记录（2026-11-07）

> 工单：工作页空态与一致性收口（UX 全扫·工作侧）。执行方：Qoder CLI（workflow 子任务模式）。
> 本文件为 §7 执行方回填；§8 归调度方验收。

## §7 执行方回填

### 7-1 任务落点

**任务1 IndexWindow 空态收敛**（`next/shell/IndexWindow.vue`）
- 复核实况：工单实拍（ux-sweep 2026-11-07）里左栏的「（构思/）」等路径 token 系 68-R3 验收期越界补做的清账（68-R3 记录 §8 追认）之前的形态——本轮逐句核对，左栏八棵树的空态句**均无路径 token**，判据①常驻面达成。
- 收敛动作（发现1 尺子的「主操作钮」选项）：左栏各空态句子同排补一枚主操作钮，词汇照「新建大纲」先例（`control-quiet nx-index-add`），点击走**同一条** toggleNewItem 新建通路（区顶临时输入行，Enter 建档/Esc·失焦取消，语义一字不动）：
  - 正文树 → 新建章节；世界书树 → 新建条目；构思树 → 新建构思；
  - 资料树（独立栏）→ 新建资料；约束树（独立栏）→ 新建约束；剧本树 → 新建剧本；
  - 记录树（素材/漫画/视频/体验/联机）→ 新建「{载体标题}」（钮文字随载体）。
  - 大纲树原已有「新建大纲」，未动。
- 守卫⑱白名单随之清账：IndexWindow 六条 hover-＋ 例外（构思/资料/约束/剧本/还没有记录/这一栏还没有条目）全部退账——不许攒僵尸条目是那条闸自己的规矩。EntriesBoard 看板那条不在本栏版面，原样保留。

**任务2 设定与资料空态合并**（`IndexWindow.vue` dossier 段＋`CarrierPaneHost.vue`）
- 左栏：新增 computed `dossierDocumentsEmpty`／`dossierRulesEmpty`（各自「干净地空」＝零条目且无报错；报错行仍各归各）。
  - 两段都空 → 只出一个合并空态：「资料与约束都还没有内容。」＋主操作钮「新建资料」（`data-test="dossier-empty-merged"`）；
  - 只一段空 → 那一段自己的句子＋自己的钮（新建资料／新建约束），另一段不说话。
- 中栏 document-detail：检索框保留原样；「从左边索引窗里选一篇资料。」那格提示改为只在**资料树非空**（有可选）时出现——树空时它是第三块噪音，其「新建」指引已并入左栏主空态。同屏空态块 3 → 1。

**任务3 全工作页复核（发现3–6）**
- 发现3 大纲空态：路径 token 与机制句（outline.json／大纲转换）均已在 title（68-R3 落的「二选一=收进 title」选项），版面＝一句话＋「新建大纲」钮。复核通过，未再动。AppNext.vue:2731 悬浮大纲窗同款（一句话＋「去索引窗新建」，机制在 title）——已合规且不在允许文件，未改。
- 发现4 六处路径 token：复核＝全零。「（构思/）」「（资料/）」「（约束/）」「（剧本/）」「（漫画/漫画.json）」「（大纲/outline.json）」在常驻版面绝迹；漫画/素材那条在 MaterialGallery（68-R3 落点，title 承载），本轮记录树新建钮补齐。工具描述（`next/carriers/*/tools.mjs`）里的「（资料/ 下）」是给模型看的参数说明、不是界面常驻文案，不在本尺子面（未动、非越界）。
- 发现5 主操作钮控件词汇：本轮全部新钮＝`control-quiet nx-index-add`（与「新建大纲」同件）；中栏八块空态指南＝`control-quiet nx-empty-guide-go`；无每页自绘样式。CSS 只补一行 `.nx-index-empty .nx-index-add` 的行内间距（next-shell.css，全 token）。
- 发现6 Agent 面板：`AssistantDialog.vue` 新增 `tokensCellRedundant` computed——已有回答在场且全线无 usage 回报时（卡片 chip 已如实说「这一轮没有用量」），状态排「本轮 tokens 未回报」那格省略；没答过／没消息时状态排照常如实报。守卫⑦语义（不换算、不落 0）一字未动，只去重复感。

### 7-2 测试同步与新增

- 断言事实同步（判定逻辑不动）：`carrier-pane.spec.mjs`「资料板新建」一条原钉「资料还没有内容。」，合并后钉「资料与约束都还没有内容。」，并**新增**三条负断言（分节句不并排、合并块只一枚钮、中栏第三块提示绝迹）。
- 新增用例 ×2（另有一条原位改写，不计新增）：
  - `carrier-pane.spec.mjs`：左栏空态主操作钮在场（构思栏）＋点击进同一条新建通路＋常驻面无「构思/」。
  - `shell-ui.spec.mjs`：〔68-R5 发现6〕双「未回报」不同屏（答过无 usage → tokens 格缺席、envelope 格不动）；有 usage 时读数照常。
- `visual-contract.test.mjs`：守卫⑱白名单退 IndexWindow 六条僵尸账（见 7-1）。**没有任何判据放宽**——⑰⑱⑲判定逻辑、八块空态指南计数、status-tokens needle、usage「未回报」文案断言全部原样在场。

### 7-3 记账指标

- 路径 token 常驻命中数：**6 → 0**（其中 6 句本体由 68-R3 越界补做清零，本轮复核确认＋第三块噪音「从左边索引窗里选一篇资料」在空树时不再出现）。
- 设定与资料同屏空态块：**3 → 1**；文案字数（工单实拍口径）：「资料还没有内容（资料/）。」8＋15＋「约束还没有内容（约束/）。」8＋15＋「从左边索引窗里选一篇资料，或在那里新建一篇。」21 ≈ 80 字/三块 → 「资料与约束都还没有内容。」12 字/一块＋「新建资料」钮。
- 主操作钮清单（本轮后）：左栏九枚（新建章节／新建条目／新建大纲／新建构思／新建资料×2 处／新建约束×2 处／新建剧本／新建{记录载体}，dossier 合并块共用其中「新建资料」）＋中栏八枚「去索引窗」（原有）＋悬浮大纲「去索引窗新建」（原有）＝控件词汇两族（`control-quiet nx-index-add` / `control-quiet nx-empty-guide-go`），零自绘。

### 7-4 越界与补登记

无越界：改动文件＝IndexWindow.vue、CarrierPaneHost.vue、AssistantDialog.vue、styles/next-shell.css、next/tests/{carrier-pane.spec.mjs, shell-ui.spec.mjs, visual-contract.test.mjs}、本执行记录。EntriesBoard.vue／EntryDetailPanel.vue 判定无需改，未动。

### 7-5 门禁读数表（npm run verify:next exit 0）

| 段 | 基线 | 本轮 |
|---|---|---|
| 验收 acceptance | 44/44 | 44/44 |
| 内核单测 | 830/830 | 830/830 |
| 外壳界面测 | 242/242（16 文件） | **244/244（16 文件）**（+2 新用例；1677 行原一条改写为合并句钉法属原位改写，不计新增） |
| eslint（--max-warnings 0） | 0 警 | 0 警 |
| 打包门禁 | 全过 | 全过 |

### 7-6 limitations

1. 未启动 Electron（工单禁令）——四条真窗复拍判据（左栏无 token／设定与资料单空态／dump 无「（xx/）」／Agent 无双「未回报」并排）本会话只到 jsdom＋源码级断言，实拍归调度方。
2. `slashCommands.mjs` 的「请只依据本书资料（世界书/资料/规则）回答：」是 slash 模板灌进用户草稿的发送内容，不是空态/常驻 chrome；不在允许文件与尺子面内，留裁。
3. 记录树新建钮点开的是「先起名再建档」临时输入行（与区头 ＋ 同一条通路）——不是一键直达空记录，沿用批次33 既定边界。
4. dossier 合并态下「新建约束」不在合并块里（约束的即时入口＝该段区头 ＋，或约束段单独为空时的句子旁钮）；一句话只配一枚主钮是工单尺子，双目标载体的第二动作不升格。
5. `docs/STATUS.md` 一行记账不在允许文件清单，未写；建议调度方验收时一并落。
6. 项目硬规则要求的 `testing-verification` / `docs-status-handoff` / `commit-conventions` 等仓库内 skills 不在本会话 Skill 可用列表——按工单口径以 `verify:next` 官方五段代替等价验证，未 commit（工单禁令）。
