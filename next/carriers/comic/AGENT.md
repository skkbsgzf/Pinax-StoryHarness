# 漫画（comic）

这一栏是作者的**漫画页**：一页一条，画格放在记录里。

## 数据落在哪

一份文件真源：`漫画/漫画.json`。一条记录一行 JSON，字段是
`{ id, title, type, status, order, body, tags[], refs[], meta{} }`。
`meta.panels` 存每一格的构图与台词。

## 工具

- `pinax_comic_list` —— 列记录（可按 status／type 过滤，按标题与正文检索）。只读。
- `pinax_comic_read` —— 按 id 读一条全文。只读。
- `pinax_comic_save` —— 覆盖式写整份文档。`expectedRevision` 必填。
- `pinax_comic_remove` —— 删一条记录。`expectedRevision` 必填。

## 规矩

1. 画格图片的**二进制**还没进文件服务（它仍是文本口）。记录里只存 `refs`（相对路径或外链），
   等资产迁移那一批再补真实拷贝。
2. `meta` 是载体私有字段的承载体，界面不拆它，保存时原样带回——
   未知字段不许因为「界面上没有」就被洗掉。
3. 修订号不符就是有人先写过了：如实报冲突，不覆盖、不合并。
4. 这一栏的能力口径是 `storyboard.shots`：它与视频栏共用「一格一格讲故事」的口径，
   但两栏的记录互不相通。
