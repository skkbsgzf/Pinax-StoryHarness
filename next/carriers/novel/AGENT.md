# 小说（novel）

这一栏是作者的**正文**：真正写出来的那部分稿子。别的栏（大纲、构思、世界书、设定、资料）
都是为它准备的东西，成品住这里。

## 数据落在哪

一块目录：`正文/`。一章一个 `.md` 文件，文件名就是章节名。

## 工具

- `pinax_chapter_list` —— 章节清单（正文随手带回，短章一次读完）。只读。
- `pinax_chapter_read` —— 读一章全文。只读。
- `pinax_chapter_save` —— 覆盖式写一章。`expectedRevision` 必填。
- `pinax_proposal_list` / `pinax_proposal_read` —— 读提案（`.pinax/proposals/` 里的内核元数据）。只读。
- `pinax_proposal_discard` —— 丢一条提案。

## 规矩

1. 提案不是正文：它住在 `.pinax/proposals/`，是「建议改法」的暂存处，作者确认后才落进正文。
   不要把提案当已定稿的内容引用。
2. 修订号不符就是有人先写过了：如实报冲突，不覆盖、不合并。
3. 正文只认 `.md`。别往正文/ 里塞别的东西——那是别的栏的地盘。

## 已知边界

- 编辑面仍是 textarea；无 diff／拖拽排序；无跨保存撤销（批次15）。
