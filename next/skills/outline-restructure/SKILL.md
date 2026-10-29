---
name: outline-restructure
description: 重构大纲结构：合并、拆分、重排节点，保留节点 id 与既有摘要。
tools: [pinax_outline_read, pinax_outline_save]
output: proposal
---

## 何时用

作者说「大纲太碎」「把这两条并成一条」「这一卷的节点顺序不对」时。

## 步骤

1. 先 `pinax_outline_read` 读当前树，记下 revision、节点总数与每个节点的 id／title／summary。
2. 先给作者一张变更表，只分五类：保留、改名、新增、删除、换序。每行写清楚「从哪来、到哪去」。
3. 得到确认（或作者已明确指令）后，把整棵树交给 `pinax_outline_save`，`expectedRevision` 用刚读到的那一个。
4. 返回一句话说明改了几处，不要复述整棵树。

## 禁止

- 不改正文，不新建或删除章节文件。
- 不删除有子节点的父节点；确需删除时先说清子节点的去向。
- 不凭空补节点摘要——摘要只能来自既有内容或作者原话。
