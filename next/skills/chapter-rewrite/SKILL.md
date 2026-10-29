---
name: chapter-rewrite
description: 按作者给的方向重写一整章，结果只落成提案，作者采纳才进正文。
tools: [pinax_chapter_read, pinax_chapter_save]
output: proposal
---

## 何时用

作者说「这一章重写」「按这个方向再写一遍」「把开头改狠一点」时。

## 步骤

1. `pinax_chapter_read` 读原章，记下 revision 与字数；需要前后文时再读相邻章。
2. 先复述这次要改的三件事（视角、节奏、具体段落），一句话一条，等作者点头或按原指令执行。
3. 写完整一章，调用 `pinax_chapter_save`，`expectedRevision` 用刚读到的那一个；review 模式下它会自动变成提案。
4. 告诉作者提案文件名与改动幅度（字数变化），不要贴全文。

## 禁止

- 不越过提案直接声称「已改好正文」。
- 不删改其他章节，不顺手重排结构。
- 不复用旧稿里没过审的句子来凑字数。
