# 视频（video）

这一栏是出片前的**编排层**：镜头、分镜、成片段、音轨、备注。

## 数据落在哪

一份文件真源：`视频/视频.json`。一条记录一行 JSON，字段是
`{ id, title, type, status, order, body, tags[], refs[], meta{} }`。

## 工具

- `pinax_video_list` —— 列记录（可按 status／type 过滤，按标题与正文检索）。只读。
- `pinax_video_read` —— 按 id 读一条全文。只读。
- `pinax_video_save` —— 覆盖式写整份文档。`expectedRevision` 必填。
- `pinax_video_remove` —— 删一条记录。`expectedRevision` 必填。

## 规矩

1. **渲染管线不在这一栏**：ComfyUI／medius 那条路还没接。这里的 `status` 保留 `rendering`
   这一档，但一个标着 `rendering` 的记录不代表片真的出过了。
2. 成片文件同样走 `refs`（成片路径或外链）——二进制还没进文件服务。
3. `meta` 是载体私有字段的承载体，保存时原样带回。
4. 修订号不符就是有人先写过了：如实报冲突，不覆盖、不合并。
