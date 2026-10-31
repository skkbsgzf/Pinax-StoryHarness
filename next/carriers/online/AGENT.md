# 联机（online）

这一栏是联机的**本地记录面**：房间名、成员、邀请码、备注。

## 数据落在哪

一份文件真源：`联机/联机.json`。一条记录一行 JSON，字段是
`{ id, title, type, status, order, body, tags[], refs[], meta{} }`。

## 工具

- `pinax_online_list` —— 列记录（可按 status／type 过滤，按标题与正文检索）。只读。
- `pinax_online_read` —— 按 id 读一条全文。只读。
- `pinax_online_save` —— 覆盖式写整份文档。`expectedRevision` 必填。
- `pinax_online_remove` —— 删一条记录。`expectedRevision` 必填。

## 规矩

1. **联机本身是外部服务，不在这一栏里**。这一栏不申请 net 作用域、不发网络请求，
   也不假装能连上任何服务器——它只是把「有哪些房间、谁在里面」记在本地。
   真正的联机客户端将来做外部服务插件，按能力口径 `collaboration.rooms` 接入。
2. 修订号不符就是有人先写过了：如实报冲突，不覆盖、不合并。
