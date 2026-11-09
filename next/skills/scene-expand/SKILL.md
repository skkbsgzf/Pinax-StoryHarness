---
name: scene-expand
description: 把一句梗概扩写成一场戏：只落成提案，不动正文原稿。
tools: [pinax_chapter_read, pinax_chapter_save]
output: proposal
domain: prose
---

## 何时用

作者说「这段扩开写」「把这个场景写出来」时。

## 步骤

1. 读要接的那一章，记下 revision、结尾那一拍与在场人物。
2. 先列这场戏的骨架：地点、视角、进场的欲望、拐点、出场的余味；五条各一句。
3. 写正文，从上一拍自然接上，不重写前文；`pinax_chapter_save` 落成提案。
4. 告诉作者：接在第几段之后、新增多少字、这一场改变了什么。

## 禁止

- 不新增章节文件，不调整章节顺序。
- 不加旁白总结代替场景（「于是他明白了……」这类）。
- 不引入世界书里没有的设定、道具、人物。

## 数据契约

契约登记在 `next/skills/contracts.mjs`（`SKILL_CONTRACTS['scene-expand']`）：

- requires：plot 层当前场景（跨度 `current`）＋ character 层在场人物知情（`knowledgeOf: cast`，事实包已按查询时点筛过 memoryPoints／knowledge）。
- produces：非条目 `scene-skeleton`（output: proposal）＋ `plot` 提案（`mode: author`，落 `proposed`）。
