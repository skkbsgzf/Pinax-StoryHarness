# 批次60 工单：载体形体重排——世界书 web 型／素材图库／资料设定合并（2026-11-01）

> 调度方：Zcode。执行方：Qoder CLI。前置：批次59 已收口（窗口系统＋布局模板机制）。
> 作者原话：「世界书＝上半 90% 图表列、下方小卡片横条呈现词条，不要左栏，更接近 Web 的产品」「素材更像图库」「资料和设定合并到一起，跟正文一样是文件夹类型的产物」。

## 任务（三块）

1. **世界书 → board 型模板（左肥右窄，无树）**：左＝大块 EntriesBoard（列表/表格/图谱三态，批次36/44 能力保持，类别筛选收进顶部筛选条；**工具条补「新建条目」**＝类别下拉＋标题输入——批次59 下线的左栏新建入口在此重建，评审 medium 裁定）；右＝窄条 EntryDetailPanel（选中条目的详情卡，点选左侧行即换内容）。**左右权重＝左肥右窄**（左约 2/3 以上，右窄条固定宽度）。蓝色链接跨知识库：条目正文与详情里所有标蓝词可点可跳，链接目标＝**整个知识库存在的条目**（世界书＋设定与资料合并体的全部条目，buildEntryTokenMap 词表扩为跨载体汇总），点选后经窗口系统开/聚焦该条目窗。

2. **素材 → 图库型模板**（无左栏）：网格画廊（卡片＝条目名＋类型＋图片位占位——图片文件位仍挂账，先用占位图形与 meta 数据）；选中/打开＝卡片点击开素材窗；四工具与自带面板（entry）不动。
3. **资料＋设定合并为「设定与资料」载体**（folder 型，12→11）：
   - 新 manifest `next/carriers/dossier/`（名可调）：`dataDirs = { 资料: '资料', 约束: '约束' }`（两目录两逻辑名，@4 合法）；工具面＝`pinax_rule_list/save`＋`pinax_document_list/read/save`＋`pinax_reference_search` 合并保留原名（对外工具名不变，别断 Agent 既有披露）；`license:{mode:'free'}`；AGENT.md 合并重写；multiplicity/scope 按 folder 型填。
   - 旧 `setting`/`reference` 载体退役：从 `BUILT_IN_CARRIER_PLUGINS` 移除；**项目打开迁移**——enabled 列表含旧 id 的映射为 `pinax.carrier.dossier`（大梦 @3 的 enabled 七块→六块，映射在打开路径做，C 盘与《大梦》目录结构零改动）。
   - 视图＝folder 模板（左树两段：资料／约束），编辑面沿用各自既有面。
   - 测试：迁移映射用例、工具面计数同步（acceptance 的 24 载体工具口径重算）、合并后AGENT.md。

## 允许文件

`next/shell/`（EntriesBoard/EntryDetailPanel 重排、素材 gallery 视图新组件、模板注册表扩充）、`next/carriers/dossier/`（新）、`next/carriers/setting|reference/`（退役删除）、`next/carriers/index.mjs`、`next/kernel/pluginRegistry.mjs`（如需）、`next/project/`（enabled 迁移映射）、`next/tests/`＋受影响 spec、`next/testing/`（夹具与计数）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不动协议 schema（合并是清单实例变化不是 schema 变化）；不动窗口系统（批次59 成果）；不动写族闸/文件服务；`pinax_rule_*`/`pinax_document_*` 工具名与语义不变（Agent 面零破坏）；不改 `server/**`、`src/**`、外部三目录；不加 npm 依赖；《大梦》目录结构零改动（仅 project.json enabled 映射）；不起 Electron、不执行 git。

## 守卫标记

批次45–59 全清单继承；本批新守卫：世界书无左树断言、素材 gallery 组件存在、dossier 载体注册且 setting/reference 全仓零命中（兼容映射除外）、《大梦》enabled 映射用例。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿；真窗口实拍三张（世界书全宽 web 态／素材图库／设定与资料 folder 双段树）调度方接管；《大梦》打开后 enabled=6 且资料约束数据原样（digest 校验）。

## 记账指标（不进闸）

迁移映射表（旧 id→新 id）；worldbook 卡片条的信息密度参数。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch60-20261101.md`；§8 调度方补；diff 指引用临时索引法。）
