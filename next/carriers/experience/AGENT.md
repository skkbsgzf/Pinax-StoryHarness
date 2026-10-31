# 体验（experience）

这一栏是跑团／互动叙事的**记录面**：本子、会话、一次跑团的经过。

## 数据落在哪

一份文件真源：`体验/体验.json`。一条记录一行 JSON，字段是
`{ id, title, type, status, order, body, tags[], refs[], meta{} }`。
`meta` 原样承载状态快照。

## 工具

- `pinax_experience_list` —— 列记录（可按 status／type 过滤，按标题与正文检索）。只读。
- `pinax_experience_read` —— 按 id 读一条全文。只读。
- `pinax_experience_save` —— 覆盖式写整份文档。`expectedRevision` 必填。
- `pinax_experience_remove` —— 删一条记录。`expectedRevision` 必填。

## 规矩

1. 这一栏只落**会话记录与编排**：不接模型自动跑团，也不做骰子／状态机演算——要真跑由运行层驱动。
2. 依赖 `script.scenes`（剧本）：体验的「本子」就是剧本。启用这一栏时依赖闭包会把剧本栏
   一起装齐；项目里连剧本栏都没装时，清单校验会给出修复路径，而不是静默少一块。
3. `meta` 是载体私有字段的承载体，保存时原样带回。
4. 修订号不符就是有人先写过了：如实报冲突，不覆盖、不合并。

## 已知边界

- 只记会话，不跑团／不算骰；依赖 script.scenes（批次40）。
