# Pinax-Electron-Next 批次40：M4／M5 五块记录型载体上盘（2026-10-30）

> 作者指令：先补 M4（素材／漫画／视频）、M5（体验／联机），把「底装修」缺的五栏先立起来。
> 本批口径：五块都是**记录型载体**——一份 `<目录>/<载体>.json` 真源 ＋ list／read／save／remove 四把工具，
> 共用同一套界面与数据层；能力名（`media.assets`／`storyboard.shots`／`video.render`／`session.runs`／
> `collaboration.rooms`）先落地为可读可写的记录面，真正的图／片／渲染／联网另批接。
> 未起 Electron、未 commit／push。

## 1. 交付

**共用记录底座** `next/carriers/jsonRecords.mjs`（新）：

- 文档形状 `{ schemaVersion: 1, records: [...] }`；记录形状
  `{ id, title, type, status, order, body, tags[], refs[], meta{}, createdAt, updatedAt }`。
- 四条工具：`<prefix>_list`（摘要＋文档修订号，可按 status／type 过滤、按标题与正文检索）、
  `<prefix>_read`（按 id 回全文）、`<prefix>_save`（upsert；新建不传 id、改稿传 id）、
  `<prefix>_remove`（删一条记录，不删文件）。
- 写入只走 `fileService.write` 的归属／作用域／并发三道闸；`expectedRevision` 必填，
  不符即 `PINAX_STALE_REVISION`，不覆盖、不合并。
- 改稿只改传进来的字段：未传的 tags／refs／meta 原样保留（`meta` 承载漫画 panels、视频时长等载体私有字段，
  界面不拆也不洗）。
- 文档校验：非法 JSON／顶层不是对象／`schemaVersion` 不认识／超过 2000 条，一律拒读，不自作主张升级。

**五块载体清单**（各含 `manifest.mjs` ＋ `tools.mjs`）：

| 载体 | id | 目录／文件 | 工具前缀 | 能力 | 界面 |
| --- | --- | --- | --- | --- | --- |
| 素材 | `pinax.carrier.material` | 素材/素材.json | `pinax_material_*` | `media.assets` | `material.board`／`material.editor` |
| 漫画 | `pinax.carrier.comic` | 漫画/漫画.json | `pinax_comic_*` | `storyboard.shots` | `comic.board`／`comic.editor` |
| 视频 | `pinax.carrier.video` | 视频/视频.json | `pinax_video_*` | `video.render` | `video.board`／`video.editor` |
| 体验 | `pinax.carrier.experience` | 体验/体验.json | `pinax_experience_*` | `session.runs` | `experience.board`／`experience.editor` |
| 联机 | `pinax.carrier.online` | 联机/联机.json | `pinax_online_*` | `collaboration.rooms` | `online.board`／`online.editor` |

- 五块都是 `file:<目录>:rw` ＋ `agent:ask`；`providers: []`（本批不谎报上下文块）。
- 素材／漫画／视频／联机的 `primary.projectKind` 为 `generic`，可在小说／剧本项目里当伴生栏；
  体验的 `primary.projectKind` 为 `screenplay`，并 **requires `script.scenes`**：
  依赖闭包会自动把剧本载体装齐，装不齐就拒绝建项目并给出修复路径，不留「想玩却没有本子」的空壳。
- `next/carriers/index.mjs` 注册顺序追加五栏（小说／大纲／构思／世界书／剧本／设定／资料／素材／漫画／视频／体验／联机），
  `BUILT_IN_CARRIER_PLUGINS` 共 12 块，`BUILT_IN_CLAIMED_TOOLS` 22 → 42。

**外壳**：

- `next/shell/recordCarriers.mjs`（新）：五块载体的界面对照表（目录／记录文件／工具前缀／可选类型与状态／默认值），
  以及 `recordCarrierOfPaneId`、`recordTreeKey`。与清单的一致性由测试逐项钉住。
- `next/shell/useBoardData.mjs`：`recordSets`（每栏一棵树＋文档修订号＋错误位＋取过数标记）、
  `record`／`recordDraft`／`editingRecord`，以及 `loadRecords／openRecord／editRecord／cancelEditRecord／
  setRecordField／saveRecord／createRecord／removeRecord`。保存一律把读到的 `meta` 原样带回。
- `next/shell/IndexWindow.vue`：记录树（行 hover 显示类型／状态／更新时间）、行点击打开、行内新建。
- `next/shell/CarrierPaneHost.vue`：`records-editor` 面——阅读态渲染 md、编辑态表单（标题／类型／状态／标签／引用＋正文），
  头部编辑／保存／取消、两段式删除（删除 → 确认删除）。
- `next/shell/viewRegistry.mjs`：五条 `material.／comic.／video.／experience.／online.` → `pinax.view.editor`（`records-editor`）。
- `next/shell/projectEventRefresh.mjs`：`entries-changed` 的目标树追加五棵 `records:*`；
  `AppNext.vue` 换板时按 pane 前缀调 `loadRecords`，事件刷新只重建树、不重读正在编辑的草稿。
- `next/history/gitHistory.mjs`：变更历史允许前缀追加 素材／漫画／视频／体验／联机（作者的记录能回溯）。

## 2. 测试

- `next/tests/carrier-records.test.mjs`（新，4 条）：五份清单过校验且与界面表逐项对齐；体验依赖闭包正反两向（自动带剧本／缺剧本拒绝建项目）；
  记录底座真链路（空文档 0 → 建 1 → 盲写拒 → 改 2 → 删 3，未传字段保留，文件仍在）；坏 JSON 与版本漂移拒读。
- `next/tests/records-data.spec.mjs`（新，6 条）：数据层载树／点开／编辑保存／新建删除／STALE 不静默合并／事件不冲草稿；
  索引窗真挂载列树、点行、行内新建；中栏真挂载阅读态、编辑保存、两段式删除。
- `next/testing/acceptance.mjs`：新增 4 条 M4／M5 验收（建项目与目录／工具面 43·23／记录修订链／一载体一文档）。
- 既有关卡同步：`declaredOutsideKernel` 数组（两份）、写族闸落点表与只读白名单、载体注册顺序、项目事件映射、
  `next/carriers` 顶层允许文件、验收计数说明。

## 3. 门禁（`npm run verify:next`）

- 验收 **20/20**（M1 七条＋M2 九条＋M4/M5 四条）；内核单测 **440/440**（436，＋新 4 条）；外壳界面测 **133/133**（127，＋6）；eslint **0 警**。
- 打包 a–l＋m/m2/m3 全过：主进程 1044.5 kB／外壳 1777.4 kB／渲染 905.0 kB／preload 3.6 kB。
- 全 12 块载体若同时启用，工具面为 57（19 内核＋1 技能＋37 自有）／42 个名字由载体服务；
  验收项目只启用 6 块（五记录＋剧本）故为 43／23。

## 4. 诚实边界

- **二进制不搬**：文件服务仍是文本口。素材／漫画／视频里的图、片、音只存 `refs`（相对路径或外链），
  不做真实拷贝、不做缩略图、不做图集预览；资产迁移等 R3 裁定。
- **渲染不接**：视频不接 ComfyUI／medius，漫画不出图；`video.render` 只是能力名与记录，不是渲染任务。
- **体验不跑团**：不接模型自动主持、不做骰子／状态机实时演算；`meta` 承载状态快照，界面不拆。
- **联机不联网**：未申请 `net` 作用域，没有房间传输／成员同步；本批只有联机房间的记录面。
- **老数据未迁移**：老前端这几块的 localStorage／IndexedDB 数据没有自动搬进来（R3 未裁定）；
  记录 id 可换成旧 id，为将来搬家留了口。
- **界面是最小记录面**：无拖拽排序、无分页／批量操作、无富文本；`type`／`status` 不设枚举硬闸（老数据混用先收进来）。
- 上限：单文件 2000 条、正文 20 万字符、list 每次最多 500 条。
- 未起 Electron，无肉眼验收；jsdom 覆盖索引窗、中栏记录面与数据层，但未做真窗口观感与打包后装机验证。
- 未 commit／push（工作副本不是 git 仓库）。

## 5. 本批踩坑账

1. **在大函数体里插代码，插进了 JSDoc 中间**：`useBoardData.mjs` 的 `loadProposals` 注释开头被新代码挤掉，
   `knowledge-service.test.mjs` 直接报 `SyntaxError: Unexpected token '*'`。教训：插代码前后跑 `node --check`，
   注释块要整段换，不按行猜边界。
2. **上下文 profile 不能按板块名字挑**：`materials-selection`／`storyboard-shot` 等 profile 在只读任务表里没有映射，
   主载体一提问就 `DEPENDENCY_UNMET`。本批统一用 `writing-selection`（体验用 `authoring-knowledge`）。
3. **新目录不能塞进 `PROJECT_KINDS`**：它与服务端 `KIND_TEMPLATES` 必须逐字对等；五个新目录走载体 `dataDirs`，
   建项目时由骨架 ∪ dataDirs 落盘，门禁用 `CARRIER_EXTENSION_DIRS` 逐条点名。
4. **既有测试的 `slice(-N)` 会因追加载体而错位**：资料载体那条断言改成按工具名前缀过滤；
   批量追加工具时先搜 `declaredOutsideKernel`／`slice(-`／`Object.keys(CARRIER_WRITE_CLASS)`。
5. **写族闸落点表要同步**：新载体的 save／remove 都是 `readOnlyHint:false`，不补 `CARRIER_WRITE_CLASS`
   会让 `guardCarrierWriteGaps().unmapped` 直接红——这也是「拒绝提示指得准」的保证。
6. **左栏视图不由 viewRegistry 决定**：索引窗按 pane 前缀渲染树；viewRegistry 只服务中栏。
   测试里拿 `legacyBindingForPane('material.board')` 去断言 list 视图会红，已改成直接断言清单的 pane 声明。
