# 漫画（comic）

这一栏是作者的**漫画页**：一页一条，画格放在记录里。

## 数据落在哪

一份文件真源：`漫画/漫画.json`。字段是
`{ id, title, type, status, order, body, tags[], refs[], meta{} }`。
`meta.panels` 存每一格的 `{ composition, dialogue }`（构图与台词）；页序看 `order`。

## 工具

记录族（写这棵内容树，走文件服务三道闸）：

- `pinax_comic_list` —— 列记录（可按 status／type 过滤）。只读。
- `pinax_comic_read` —— 按 id 读一条全文。只读。
- `pinax_comic_save` —— 覆盖式写整份文档。`expectedRevision` 必填。
- `pinax_comic_remove` —— 删一条记录。`expectedRevision` 必填。

## 出图族（外部 MCP 桥，聚合面上以 `comfy.` 前缀出现）

桥是载体自带的一个独立脚本（`comfy-mcp-bridge.mjs`，stdio 上的最小 MCP 服务端，
零依赖、只用 node 内置模块，不引内核与运行期的任何模块）。
宿主按清单 `mcp` 牌把三把工具挂到聚合面上，名字带 `comfy.` 前缀：

- `comfy.comfy_status` —— 探 ComfyUI 在不在（读 `/system_stats`）。
- `comfy.comfy_submit` —— 提交工作流 JSON，回 `prompt_id`；出图不是写盘。
- `comfy.comfy_result` —— 按 `prompt_id` 读产物元数据（filename／subfolder／type）。

默认打 `http://127.0.0.1:8188`；换地址靠环境变量 `PINAX_COMFY_URL`（宿主可在清单
`mcp` 牌里给这一项配 `env`）。清单里只写回环地址，不写死别的机器。

记录族与出图族互不放行：记录族走文件服务三道闸，出图族走外部 MCP 桥，两条路各走各的。

## ComfyUI 没起时

三把出图工具都会**立即**回人话错误「ComfyUI 没起或不在 8188」（`isError:true`），
不挂起、不重试、不自己拉起进程。记录族不受影响，照常读写。

## 预览

载体自带只读预览服务（`preview-server.mjs`，127.0.0.1:8191，`/health`）。
它只读 `漫画/漫画.json`，渲染页序与每页格子的构图／台词，没有写口。

项目根由宿主摆进环境 `PINAX_PROJECT_ROOT`，服务自己取；也可以用
`?root=<项目根>` 临时指一个。两者都拿不到时 `/` 只报「还没定位到项目」，
不猜路径。

## 清单上声明了什么

| 牌 | 干什么 | 落在哪 |
| --- | --- | --- |
| `entry` | 不自带面板：漫画板用宿主的 `records-editor` 视图渲染 | `entry: null` |
| `services` | 预览服务，宿主起停、探活、崩了拉起 | `preview-server.mjs` |
| `mcp` | ComfyUI 桥，宿主连上后把三把工具挂进聚合面 | `comfy-mcp-bridge.mjs` |
| `context` | 把漫画页清单作为 `references` 块喂进信封 | `context.mjs` |
| `agentMd` | 作者须知（就是本文件），运行时并进上下文信封 | `AGENT.md` |

信封这一路：本栏 `context.providers` 声明 `references`，块里给的是漫画页清单
（页名 + 格数 + 首句台词），供 `authoring-knowledge` 那类只读任务用。

## 规矩

1. **不写图片文件**：本栏只存 `refs`（相对路径或外链），图片二进制等资产迁移裁定；
   桥也不下载图片，`comfy_result` 只回元数据。
2. `meta` 原样保留：保存时未传的字段不许因为界面没显示就被洗掉。
3. 修订号不符就是有人先写过了：如实报冲突，不覆盖、不合并。
4. 能力口径是 `storyboard.shots`：与视频栏共口径，但两栏记录互不相通。
