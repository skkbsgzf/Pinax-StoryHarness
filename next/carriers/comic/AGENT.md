# 漫画（comic）

这一栏是作者的**漫画页**：一页一条，画格放在记录里。画布与出图引擎都是外部独立体，
Pinax 只承载、只探活，不 spawn、不重启它们。

## 数据落在哪

一份文件真源：`漫画/漫画.json`，字段是
`{ id, title, type, status, order, body, tags[], refs[], meta{} }`。
`meta.panels` 存每格 `{ composition, dialogue }`（构图与台词）；页序看 `order`。

## 工具

- `pinax_comic_list`／`pinax_comic_read` —— 列记录、按 id 读全文。只读。
- `pinax_comic_save`／`pinax_comic_remove` —— 覆盖式写整份文档／删一条。`expectedRevision` 必填。
- `comfy.comfy_status`／`comfy.comfy_result` —— 外部 MCP 桥：探 ComfyUI 在不在（:8188，
  `PINAX_COMFY_URL` 可改）、按 `prompt_id` 读产物元数据。只读。

记录族走文件服务三道闸，引擎族走外部 MCP 桥，两条路互不放行。

## 规矩

1. **不写图片文件**：本栏只存 `refs`（相对路径或外链），二进制资产迁移另行裁定；
   `comfy_result` 也只回元数据。
2. `meta` 原样保留：保存时未传的字段不许因为界面没显示就被洗掉。
3. 修订号不符就是有人先写过了：如实报冲突，不覆盖、不合并。
4. 能力口径是 `storyboard.shots`：与视频栏共口径，但两栏记录互不相通。

## 已知边界

- 没接真 ComfyUI；`comfy_submit` 停用——底座提交闸落地前不开第二个直连提交口。
  引擎没起时两把只读工具**立即**回人话错误，不挂起、不重试、不自己拉起进程。
- 画布是 toonflow（:3010，作者 dev 流程起），只经 app 档内嵌浏览器承载；Pinax 不管起停。
- 自带只读预览服务 `preview-server.mjs`（:8191），只读记录，无写口；项目根取 `PINAX_PROJECT_ROOT`。
