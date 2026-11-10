# 批次60 记录：载体形体重排——世界书 web 型／素材图库／资料设定合并（2026-11-01）

> 工单：`docs/plan/pinax-electron-next-m2-batch60-ticket-20261101.md`。
> 执行方：Qoder CLI。前置：批次59 已收口（窗口系统＋布局模板机制）。
> 结果：`npm run verify:next` 五段全绿（`EXIT=0`）；三块形体落地，11 份载体清单 @4、44 把载体工具不变；
> 真窗口实拍三张与 §8 由调度方接管。

---

## 1. 三块任务 → 落点

| 任务 | 落点 | 对应测试 |
|---|---|---|
| 世界书 → web 型（左肥右窄、无树） | `EntriesBoard.vue` 工具条补「新建条目」（类别下拉＋标题输入＋新建钮）；`next-shell.css` 的 `.nx-entries-workspace` 改为横向：看板区 `flex: 1 1 66%`、详情条 `flex: 0 0 320px`；窄屏（≤860px）叠回上下 55%／45%（看板最小 140px） | `carrier-pane.spec.mjs`「世界书是 web 模板（批次59）：不渲染左树…」；`shell-ui.spec.mjs` 批次59 世界书段 |
| 蓝色链接跨知识库 | `wikiLinks.mjs` 新增 `buildKnowledgeCatalog({entries, documents, rules})`：世界书条目＋资料＋约束归一成一张知识库；`EntryDetailPanel.vue` 用它建词表（仍只收「恰好指向一条」的词）；`AppNext.vue` `openKnowledge(target)` 先切到目标载体栏，再经窗口系统开／还原文档窗，最后交既有 `openEntry／openDocument／openRule` | `carrier-pane.spec.mjs` 世界书双链与详情面用例（`entry-rendered` 点击） |
| 素材 → gallery 型（无左栏） | 新 `next/shell/MaterialGallery.vue`：整面卡片墙（卡片＝标题＋类型＋状态＋日期＋图片位占位）；`layoutTemplates.mjs` 按 `material.` 前缀认 `gallery`；`AppNext.vue` 在 gallery 模板下渲染画廊、`selectBoard` 只换板不开窗、点卡才 `openRecord` 并开素材窗 | `carrier-pane.spec.mjs` 新增「素材载体（批次60：图库模板，无左栏）」两条 |
| 资料＋设定 → 「设定与资料」（12→11） | 新 `next/carriers/dossier/`（manifest／tools／context／AGENT）；`dataDirs={documents:'资料', constraints:'约束'}`；六把工具原名合并；`license:{mode:'free'}`；旧 `setting/`、`reference/` 整目录退役 | `carrier-dossier.test.mjs` 12 条（清单、工具面、两目录闸、读写语义、上下文块、迁移、旧 id 零命中）；`carrier-pane.spec.mjs`「设定与资料载体」两条 |
| 旧项目打开迁移 | `next/project/openProject.mjs` `migrateLegacyCarrierIds`：只做内存映射（primary／enabled），去重不落盘；磁盘 `.pinax/project.json` 一字不动 | `carrier-dossier.test.mjs`「打开期迁移：旧 id 映射到合并体（七块→六块），.pinax/project.json 一字不动」 |

## 2. 文件变更

新增：

- `next/carriers/dossier/` — `manifest.mjs`（@4 清单＋`DOSSIER_LEGACY_IDS`）、`tools.mjs`（六把原名字工具）、`context.mjs`（rules／style／references 三块）、`AGENT.mjs` ＋ `AGENT.md`（合并重写）。
- `next/shell/MaterialGallery.vue` — 素材图库卡片墙。
- `next/tests/carrier-dossier.test.mjs` — 合并体全量测试。

删除：

- `next/carriers/setting/`、`next/carriers/reference/` — 清单、工具、上下文与 AGENT 全部退役；`BUILT_IN_CARRIER_PLUGINS` 12→11。

主要修改：

- `next/carriers/index.mjs`、`next/index.mjs` — 注册合并体，导出 `DOSSIER_CARRIER`／`DOSSIER_CARRIER_ID`／`DOSSIER_LEGACY_IDS`。
- `next/project/openProject.mjs` — 打开期旧 id 内存映射。
- `next/shell/EntriesBoard.vue`、`EntryDetailPanel.vue`、`AppNext.vue`、`IndexWindow.vue`、`CarrierPaneHost.vue`、`viewRegistry.mjs`、`wikiLinks.mjs`、`useBoardData.mjs`、`layoutTemplates.mjs`、`styles/next-shell.css` — 看板重排、新建条目、跨载体双链、dossier 两段树、素材画廊接线。
- `next/tests/**`、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs` — 12→11、24→22 认领 pane、旧 id 替换、合并体计数与守卫。

未改动（按工单边界）：协议 `@4` schema、窗口系统、写族闸／文件服务、`server/**`、`src/**`、外部三目录、《大梦》磁盘内容；`pinax_rule_*`／`pinax_document_*` 工具名与语义未改。

## 3. 迁移映射表（记账指标一）

| 旧 id | 新 id | 处理位置 | 落盘 |
|---|---|---|---|
| `pinax.carrier.setting` | `pinax.carrier.dossier` | `openProject.mjs` 打开期内存映射 | 否 |
| `pinax.carrier.reference` | `pinax.carrier.dossier` | 同上；与 setting 去重为一块 | 否 |
| 旧 primary | 随映射改指 dossier | 同上 | 否 |

《大梦》@3 口径：`enabled` 七块（小说／大纲／构思／世界书／设定／剧本／资料）→ 六块（…／设定与资料／…）；
`.pinax/project.json` 原样保留，下次项目写盘才按新 id 整份重写。目录结构（`资料/`、`约束/`）零改动。

## 4. 世界书卡片条信息密度参数（记账指标二）

| 参数 | 值 | 出处 |
|---|---|---|
| 看板区 : 详情条（桌面） | `flex: 1 1 66%` : `flex: 0 0 320px`（gap 12px，详情左分隔线） | `next-shell.css` `.nx-entries-workspace*` |
| 看板区 : 详情条（≤860px） | 上下两段：55%（最小 140px）／45% | 同上 `@media (max-width: 860px)` |
| 表格列 | 6 列：名称／类别／类型／关键词／字数／摘要 | `entriesView.mjs` `ENTRY_COLUMNS` |
| 摘要密度 | 表格与列表行摘要截 40 字；详情底部 meta 摘要截 80 字；条目信息摘要输入上限 500 字 | `entriesView.mjs` `clipEntrySummary`、`EntryDetailPanel.vue` `SUMMARY_PREVIEW_CHARS`、`maxlength=500` |
| 工具条 | 视图切换（列／表／图）＋全文筛选＋类别筛选＋新建条目（类别下拉＋标题输入＋新建钮） | `EntriesBoard.vue` `nx-entries-board-head` |
| 新建落点 | `世界书/<类别>/<名称>.md`；类别为空＝顶层 | `EntriesBoard.vue` `submitNewEntry` → `createEntry` |

## 5. 守卫标记落点

| 新守卫 | 落点 |
|---|---|
| 世界书无左树 | `carrier-pane.spec.mjs`「世界书是 web 模板…不渲染左树」既有断言继续钉住 |
| 素材 gallery 组件存在／图库行为 | `MaterialGallery.vue`（`data-test="material-gallery"`）＋ `carrier-pane.spec.mjs` 新增两条：卡片墙无索引窗、点卡才开素材窗；空库文案 |
| dossier 注册且 setting／reference 全仓零命中（兼容映射除外） | `carrier-dossier.test.mjs`「守卫：旧载体 id 只活在兼容映射里（next/ 生产文件零命中）」：扫描 `next/` 下 `.mjs/.js/.vue/.css/.json`，跳过 `.build`／`tests`／`node_modules`，仅豁免 `next/carriers/dossier/manifest.mjs` |
| 《大梦》enabled 映射用例 | `carrier-dossier.test.mjs`「打开期迁移…七块→六块」 |
| 继承批次45–59 全清单 | 各原测试未删；12→11、24→22 的计数在 acceptance／bundleAssertions 同步 |

## 6. 测试与门禁

`npm run verify:next`（2026-11-01，`EXIT=0`）：

| 段 | 结果 |
|---|---|
| `node next/testing/acceptance.mjs` | `M1 空框架＋M2 真载体验收：35/35 通过`（11/11 @4、44 把载体工具、聚合 40／载体服务 24 不变、设定与资料 6 把） |
| `node --test "next/tests/*.test.mjs"` | pass 648 / fail 0 |
| `vitest run --config next/vitest.next.shell.config.mjs` | 14 文件 / 199 用例全过（shell-ui 88、carrier-pane 51） |
| `npm run lint:next` | 零警告 |
| `node next/testing/bundleAssertions.mjs` | 全部通过（n3 11 份 AGENT.md、r1 11/11 @4、r2 认领 pane 22） |

分段验证记录：dossier 单测 12/12；carrier-pane 单 spec 51/51。

## 7. 已知边界与偏差（limitations）

1. **真窗口实拍未做**：三张截图（世界书全宽 web 态／素材图库／设定与资料 folder 双段树）按工单由调度方接管；本批只在 jsdom 与产物层验证，未起 Electron、未执行 git。
2. **《大梦》digest 未在真盘复跑**：迁移用例用临时工装目录模拟七块旧 id，证「映射后 enabled=6、project.json 原样」；真盘 digest 需调度方在实机打开时核对（本批不碰外部三目录）。
3. **`.build/` 产物里的旧 id**：`next/.build/dossier/AGENT.md` 的沿革段与主进程 bundle 里的兼容映射仍含旧 id 字样——前者是作者须知里的迁移说明，后者是映射表本身；零命中守卫只扫生产源文件并豁免兼容映射，不把生成产物当源码。
4. **世界书底部「小卡片横条」按工单任务一的左肥右窄落地**：作者原话提过「下方小卡片横条」，工单任务一最终裁定为「左＝大块看板、右＝320px 窄条详情」；本批按工单执行，未另做底部卡条。
5. **设定与资料编辑面共用 `document-detail` 面孔**：约束文件由 `CarrierPaneHost` 按 `selection.type === 'rule'` 动态切成 `rule-editor`；清单里没有给约束单独声明第二块 center pane（folder 模板一栏一窗）。行为一致，但 pane 声明层面看不出「约束面」的存在——这是清单合并后的取舍。
6. **素材图片仍是占位**：图库卡片的图片位用图标占位，记录里的 `refs` 原样保留；真实图片文件位仍挂账（文件服务仍是文本口，等 R3 资产迁移裁定），本批不伪造缩略图。
7. **`shell-ui.spec.mjs` 的 `setting.board` 夹具未改**：该处是 `pluginId: 'fixture.script'` 的无关注入夹具，不对应旧设定载体；零命中守卫只扫生产源文件，不误伤测试夹具。

## §8 调度方验收

（待调度方补：真窗口实拍三张核对、《大梦》enabled=6 与 digest、三块形体逐条判读、信用账。）
