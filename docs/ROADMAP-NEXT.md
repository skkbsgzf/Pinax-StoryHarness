# Pinax.Next 工单与路线图 — 2026-11-10 推演链 P-WIRE→P-M5 收口后

> 唯一开发仓 `D:\Pinax-next`（origin=skkbsgzf/Pinax-StoryHarness，upstream=Recoletas/Pinax）。
> **git**：`feat/pinax-electron-next`＝开发单线；`main`＝集成点（每轮收口后 --no-ff 合入）。
> 上游 Recoletas/Pinax 同步仍走窄面 PR（T12 谈判），不整线回塞。
> 门禁基线：gate v2 五段全绿；kernel 1155/1155 零豁免；UI 267/267；lint 零告警；bundle 全通过。

## 本轮已完成（2026-11-10，六批）

| 批次 | 提交 | 内容 |
|---|---|---|
| P-WIRE | `9f8334b` | **推演编排深度接线**：`sceneContext.js` 第一视角裁剪（ledger／world 双保真度）进局面卡与候选；`pov`/`goal` 贯穿 settle→投影→chapterize（换视角即换章）；伏笔与目标弧进成书 prompt；修掉 `pack.entries` 恒空的静默失效 |
| P-M4 | `528c359` | **张力引擎**：`fronts.js` 威胁前线＋压力时钟（只推进不倒退／推进源全确定性／满格即触发）；世界书 rules 预埋 fronts 模板；**伏笔编织**（前线全空时把悬置伏笔接成新威胁，解决 200 拍中段张力归零）；导演四动（点火/已处理/结线/编织）＋面板 |
| P-ALIGN | `d0a6ae4` | **粒度对齐**：`alignGranularity.js` 抽取段（100–300 字）→ 成书拍（600 字/拍），五规则（不跨章／不跨视角／按信息量累积／钩子跟拍走／超长自成拍）＋覆盖核对；修掉「一章 12 段直喂被切成 2 章」 |
| P-STYLE | `48b3f3c` | **文风实例化**：`styleProfile.js` 蒸馏产物→styleSpec（只认材料里的数字／区间推导可复核／分层可选）；`styleProfileDoc.js` 档案校验（samples 非空即报错＝版权红线）；**实件入仓** `异兽迷城-彭湃.json`（只含派生量，代表句不入库） |
| P-M5 | `456203f` | **连续宇宙**：`patchChannel.js` 补丁通道（只认已确认事实／一律 proposed／带出处／幂等／多周目并存判定）；多视角重演固定端点进 session＋state；面板补丁块＋换视角重演入口 |
| 小项 | `524174d` | `undecidable` 可判定化：抽取行 schema 支持可选 `constraints:[{key,value}]`，给了 gate 就能机判、不给仍如实进 undecidable |

## 剩余工单

### P-LLM — LlmPort 子 Agent 接入（作者排最后）
按裁定：**无 API token，开子 Agent 走既有模型通道**（Pi 子会话形态，参考 core 0.13 nativeAssistantSession）。
现状：`next/runtime/factLlmService.mjs` 已有一条 CLI 通道实现（dispatchCodebuddyCompletion，命中 `PINAX_FACT_LLM_*`），
但作者已定「不必用其它 cli」——**下一步要替换掉 CLI 派发，改成主进程内起 Pi 子会话**。
落地后即可开诡秘之主实测（前几章 wiki 化＋推演续写）。

### P-KIT — Kit 17 卡契约迁移（依赖 kit 仓访问）
kit 仓侧的 17 卡契约迁移，需先拿到 kit 仓访问与现有卡表。

### P-TRIM — 采集数据缩减与语义精炼（**长期项目**，作者 2026-11-11 立项）

> 作者裁定：第一版（guimi-acceptance / extract-trial 的产出）**只当草稿看**，不当质量基线。两条线长期推进。

**Track 1 · 数据本体缩减（格式层，无语义损失，可排单）**
实测输入（2026-11-10 对两份真实产物逐字段计字节，均条 1.2–1.5KB）：

| 动作 | 预估省 | 说明 |
|---|---|---|
| 文件头 `{schema,domain,book,book_id,extractor,mode}` | ~11% | 全是逐条重复的常量，提到文件头一处 |
| provenance 瘦身（条目级只留 `quote_hash`） | ~9% | `chapters` 与 `validity` 二选一（留 validity） |
| `sources` 改段表（条目引下标） | ~10% | 同章 9 段每条重写全路径 |
| 删 `events[].title` | ~5% | 是 fact 前 20 字截断，纯派生，无人消费 |
| `fingerprint` 延迟生成 | ~5% | metrics 可由 actinfo 计数推导；`vec` 非空才写 |
| 空值省略（`aliases:[]` 等） | ~2% | 消费侧已兼容缺省 |

- 合计估省 **35–45%**；落点＝`compileExtractionEntries` 的**落盘序列化层**（`.pinax/extractions/*.json`），
  内存/单条流通形状不动（补丁通道是单条采纳的）。
- **红线（C 级，看着冗余不能动）**：`name` 进 `stableEntryId` 哈希——改名＝换 id＝补丁/分支全断链；
  `quote_hash`（D4 版权裁定）／`validity`（双时间轴）／`refs`（知情账本与视角筛靠它）／`status`（状态机）。

**Track 2 · 语义精炼（设计先行，作者方向性裁定）**
抽取的内容要区分**文本功能类型**——陈述／描写／目的性刻画是三种不同的东西：
不同类别在处理时**侧重点、对应的数据类型、挖掘深度都不一样**。
- 陈述（推进事件）→ plot 事件链，深度＝因果与时间轴；
- 描写（场景/感官/氛围）→ worldview 槽位与场景质地，深度＝锚定物与时代感，不硬造事件；
- 目的性刻画（有意图的人物塑造）→ character anchors/memoryPoints/castRole，深度＝行为通道取证。
- 第一版已实测到的问题（作为 Track 2 的起跑证据）：character 层同一事实四写（identity/personality/trajectory/memoryPoints 同义）、
  `castRole.goal/plotFunction` 出现元评论（模型自述抽取策略而非角色剧情作用）→ prompt 要按类型收紧；
  输出 token 是输入的 2 倍（14k/段），大头就是这类散文——精炼同时就是成本优化。
- 开工前置：先出一份「类型→槽位→深度」的映射设计稿（不写 prompt），作者过目再动。

### 待作者
- **诡秘之主实测**（P-LLM 之后）：前几章 wiki 化＋推演续写
- **R4/R5 目视验收**（`8dd526e` 在线上）：①标题栏「设置」逐区翻 ②关掉所有页签看工作区空态
- **T12 与原作者**：core 发布渠道／`next/fact` 平移 pinax-core 时点／NovelPedia 引擎归属
- **风格档案确认**：`next/fact/packs/novel-style-profiles/异兽迷城-彭湃.json` 里的统计量与禁则是否照此使用；
  代表句（samples）刻意未入仓，需语感校准时走 `pickStyleSamples` 在本机语料现取
- **P-TRIM Track 2 设计稿**：类型→槽位→深度映射（见上），作者过目后才动 prompt

## 引擎能力现状（供后续排单参考）

- **推演**：开局冻结（非 adopted 拒）／三层候选（必然▮ 命运⚙ 戏剧✦）／一致性筛＋视角筛／结算落库（runId+pov+goal provenance）／
  事件溯源（15 事件类型／5 checkpoint purpose／读档即分支）／假设轨（open hypothesis）／导演四动／威胁前线＋压力时钟＋伏笔编织
- **成书**：章纲投影（四类边）→ 粒度对齐（段→拍）→ chapterize（视角∷目标分章）→ 逐章渲染（知情约束＋perspective gate＋文风 styleSpec＋目标弧＋未回收伏笔）
- **数据**：fact.data/v2 三层（worldview hard 11 槽／character soft／plot soft）／双时间轴／知情账本／readerCognition／
  一致性检测（gate 四断言＋悬空引用＋槽位堆积＋伏笔统计）／抽取链单轮（段级 100–300 字）
- **连续宇宙**：补丁通道（proposed 落地、作者采纳）／多周目并存／多视角重演（端点固定、路径自由）

## 已知边界（诚实记账，别当 bug 修）

- 知情账本为空的角色：局面卡按 world 级可见降级并**如实记账**（不是「全知」，是「无从判定」）
- 抽取链的 `undecidable`：规则条目只写自由文本时不可机判，需补 `constraint`
- 文风档案不含代表句：第三方原文入仓有版权问题，语感校准就近取
- `alignGranularity` 的目标弧靠显式 `goal`：抽取数据没有 goal 时退回「同视角连续拍＋拍数上限」，不拿章名硬当目标
