---
name: fact-consistency
description: 整库一致性检测——全书拆解完成或改编改写前，对已发布的事实快照过一遍：锚点/规则/时间线/知情四类断言，加关系与知情引用悬空、同名跨层、槽位堆积与伏笔统计。只读，不写事实库；可判定项直接给结论，不可判定项如实列出。
tools: [pinax_skill_read, pinax_fact_check, pinax_extract_status]
output: checklist
domain: worldbook
---

## 什么时候用

抽取链路**不做**查漏与错判复核——那一轮只负责把内容记下来。这条 Skill 是补上的那一次全文扫描，只在需要时跑：

- 全书（或一个完整卷）拆解完成、准备定稿前；
- 改编、改写、续写前，确认既有事实之间没有硬冲突；
- 推演开局前，确认世界状态自洽。

日常单章抽取结束后**不必**跑；跑也只花几十毫秒（确定性，零模型调用）。

## 怎么跑

1. `pinax_fact_check({dataset})` — 对**已发布快照**整库检测（需先 `pinax_extract_finish`）。
2. `pinax_fact_check({dataset, runId})` — 对**进行中的运行**里已交的行现场编译后检测（不要求先 finish）。
3. `scope:'summary'` 每类只回前 20 条（默认）；`scope:'full'` 回全量。

## 怎么读结果

- **`conflicts`（error，可判定）**：必须处理。例如时间轴区间倒置、知情早于来源、规则与事件直接冲突。工具已用确定性规则判死，不需要再让模型复核一遍。
- **`warnings`（可判定但非致命）**：关系目标/知情来源悬空、同名跨层、别名歧义、槽位堆积。多数是**抽取阶段实体名不规范**造成，改条目名或补索引即可，不必改事实。
  - `RELATION_TARGET_UNRESOLVED` / `KNOWLEDGE_SOURCE_UNRESOLVED`：关系或知情指向的名字不在索引里。先看是不是别名没登记（补 `aliases`），确实是新实体就走定向补抽 `prepare(mode:repair, sourceIds)`。
  - `NAME_ACROSS_LAYERS`：同一名字出现在两层（如人物「白灼」同时被抽成 worldview/roles 条目）。通常是同一实体两份投影，择一保留。
  - `SLOT_PILEUP`：`other` 槽位占比过高，说明槽位映射没跟上——补 `next/fact/usecases/pipeline/extractionChain.js` 的 `SLOT_KEYWORDS` 映射表，而不是逐条手改。
- **`undecidable`（不可判定）**：规则条目只有自由文本、没有结构化 `constraint` 字段。工具**不拿文本猜语义**——要么给规则条目补 `constraint:{key,value}`，要么如实接受「这一条没法机判」。
- **`hooks`**：伏笔清单（总数＋前 50 条）。只统计不判定：是否该回收由作者决定，工具不替你关伏笔。

## 修复优先级

1. 先清 `conflicts`（硬冲突，会污染后续推演与成书）；
2. 再扫 `warnings` 里的悬空引用（多半一条别名就能解决）；
3. `SLOT_PILEUP` 改映射表（一次性收益覆盖全库）；
4. `undecidable` 按需补结构化字段，不强行转可判定。

## 边界

- 只读：不改条目、不写断点、不自动采纳、不删任何东西。
- 判定全部确定性（零模型调用）：工具说 error 就是 error，说 warning 就是 warning，不用再问模型。
- 文学质量、合理性、好不好看不在这条链路——这里只判「数据自不自洽」。
