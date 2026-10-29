---
name: continuity-check
description: 连续性核对：把正文与大纲、世界书对一遍，只出问题清单，不改任何文件。
tools: [pinax_project_context, pinax_chapter_read, pinax_worldbook_list]
output: checklist
---

## 何时用

作者说「查一下有没有前后矛盾」「这段和设定对得上吗」时。

## 步骤

1. `pinax_project_context` 拿项目概览与大纲要点；需要细节时再 `pinax_chapter_read`／`pinax_worldbook_list`。
2. 只报三类问题：事实冲突（年龄、地点、时间线）、设定越界（正文用了世界书里没有的能力或名词）、伏笔断线（大纲里有、正文没接）。
3. 每条写成一行：问题 → 依据（哪一章／哪一条目）→ 一句话建议。
4. 结尾用数字收口：核对了几章、报了几条。

## 禁止

- 不改任何文件，不生成提案。
- 不把「读起来不顺」算成连续性问题——那是文风，另说。
- 没有依据的怀疑不报；宁可少报，不编证据。
