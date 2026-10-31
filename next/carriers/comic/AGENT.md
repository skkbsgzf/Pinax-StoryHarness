# 漫画（comic）

这一栏是作者的**漫画页**：一页一条，画格放在记录里。

## 已知边界

- 没接真 ComfyUI；`comfy_submit` 停用；不写图片；画布只承载 :3010，不 spawn 外部服务（批次48／58）。

## 三个独立体，三个接入面

漫画这一栏同时接住作者创作链上的三个独立运行体。它们是**各自独立跑、各自接入 Pinax 底座**的服务，
底座不当它们的替代品：负责端口管理（监督／探活／日志／状态灯）与承载，不悄悄 spawn 它们。

| 独立体 | 是什么 | 接入面 | Pinax 侧做什么 |
| --- | --- | --- | --- |
| 画布 | toonflow（作者 dev 流程起，:3010） | `comic.canvas` 这块 app 档 pane | 给一块内嵌浏览器承载，页面自己长什么样就什么样；不手搓编辑器 |
| 引擎 | ComfyUI（常驻 :8188） | `comfy.` 前缀的外部 MCP 桥 | 只探活、只收结果；提交通路不开 |
| 资产 | 素材／漫画记录树 | 本栏四把 `pinax_comic_*` 工具 ＋ 素材载体自带工具 | 读写记录，图片二进制等资产迁移裁定 |

### 画布（toonflow）

`comic.canvas` 声明 `app.url = http://127.0.0.1:3010`，走宿主的内嵌浏览器。
toonflow 没起时那块面会如实说「先确认那个端口的服务起没起」，旁边摆着地址，可以复制出去单开。
Pinax **不 spawn、不重启** toonflow——它的起停由作者自己的 dev 流程管。

### 引擎（ComfyUI）

桥是载体自带的一个独立脚本（`comfy-mcp-bridge.mjs`，stdio 上的最小 MCP 服务端，
零依赖、只用 node 内置模块，不引内核与运行期的任何模块）。
宿主按清单 `mcp` 牌把**只读两把**挂到聚合面上，名字带 `comfy.` 前缀：

- `comfy.comfy_status` —— 探 ComfyUI 在不在（读 `/system_stats`）。
- `comfy.comfy_result` —— 按 `prompt_id` 读产物元数据（filename／subfolder／type）。

默认打 `http://127.0.0.1:8188`；换地址靠环境变量 `PINAX_COMFY_URL`（宿主可在清单
`mcp` 牌里给这一项配 `env`）。清单里只写回环地址，不写死别的机器。

**`comfy_submit` 停用。** 提交通路的纪律归底座：多提交方抢 ComfyUI 的串行队列会雪崩
（CF2TF SPEC §1.1 单提交点 queue gate 的教训）。底座的提交闸没建好之前，Pinax 侧不开
第二个直连 ComfyUI 的提交口——桥里仍保留这把工具的实现，但清单 `allow` 不放行，聚合工具面上看不到它。
**恢复条件＝底座提交闸落地**：届时由底座统一提交，而不是各载体自己再开一条直连。

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

记录族与引擎族互不放行：记录族走文件服务三道闸，引擎族走外部 MCP 桥，两条路各走各的。

## 引擎没起时

两把只读工具都会**立即**回人话错误「ComfyUI 没起或不在 8188」（`isError:true`），
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
| `entry` | 不自带面板：漫画板、画布都走宿主视图渲染 | `entry: null` |
| `services` | 预览服务，宿主起停、探活、崩了拉起 | `preview-server.mjs` |
| `mcp` | ComfyUI 桥，只放行探活与收结果两把 | `comfy-mcp-bridge.mjs` |
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
5. **提交闸归底座**：未建前 `comfy_submit` 停用，不许以任何形式绕过 `allow` 回到工具面；
   恢复条件＝底座提交闸落地。

## 过渡参考与登记项

CF2TF 是过渡层的参考，不是要内置的中间件：它的 SPEC 十条红线是将来**底座自建出图管线**的设计输入，
Pinax 不预声明 CF2TF MCP。登记（本批不做，已排期）：

- services 牌的 adopt 模式（只探活／状态灯／池记账，不 spawn——外部独立运行体的端口管理正身）→
  批次52 @4 随 services 词表扩展落地；落地后本栏以 adopt 声明 comfyui(8188, healthPath `/system_stats`)
  与 toonflow(3010)，四色状态点对三个独立体全亮。
- 底座出图管线设计批（吸收 CF2TF SPEC 全部十条红线：单提交点 queue gate、超时必 interrupt、
  h264 收割、上传器唯一实现）→ 另立项，待作者点头；立项前 CF2TF 维持作者现状使用，与 Pinax 互不干扰。
