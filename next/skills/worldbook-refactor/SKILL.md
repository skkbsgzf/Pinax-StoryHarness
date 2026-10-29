---
name: worldbook-refactor
description: 重构世界书：拆分过长的条目、合并重复设定、补齐条目之间的关系。
tools: [pinax_worldbook_list, pinax_worldbook_read, pinax_worldbook_save]
output: proposal
---

## 何时用

作者说「这个人物条目太长了」「两个条目说的是同一件事」「给这两条补上关系」时。

## 步骤

1. `pinax_worldbook_list` 看清条目清单，再对涉及的条目逐个 `pinax_worldbook_read`。
2. 给出变更表：拆分（原条目 → 新条目名与各自范围）、合并（谁并进谁、保留哪个名字）、补边（A 与 B 是什么关系）。
3. 确认后逐条 `pinax_worldbook_save`；每条都带刚读到的 revision，不做「批量覆盖」。
4. 汇总：动了几个条目、新增/删除各几个。

## 禁止

- 不改既有条目的既定事实（年代、身份、因果），只动组织方式。
- 不合并两个来源不同、作者没说清归属的条目——先问。
- 不把正文段落整段搬进世界书。
