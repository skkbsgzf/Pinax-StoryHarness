# 批次65a 工单：装载正式第一波——外部声明型插件从磁盘装入（2026-11-02）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。工单源：框架计划 §6 桩2，按「内置改造分开落」纪律拆两波：**本批 65a＝外部声明型装载（新增能力）；65b＝内置 11 块迁同路径（另行派发）**。
> 前置裁定（台账在案）：Q1 R4 追认；Q4 第一档**不开第三方 JS**。批次64 桩判定＝通过（registry.install 对外部清单无硬障碍）。

## 定义：声明型外部插件（本批的唯一外部形态）

`.pinax/plugins/<插件id>/manifest.json`（@4）——**只有清单，没有 impl.mjs**：
- 允许：`dataDirs`（项目根下目录认领，走 fileService 既有 grant 闸）、`contributes.panes`（**宿主八视图词表内**的类型：tree/editor/list/board/gallery 等——内容由 fileService 从其 dataDirs 读，零第三方代码）、`contributes.settings`（声明式键值，经 settingsStore 落盘）、`license`、`agentMd`、`commands`（**本批暂空**——声明型命令的执行通路未设计，登记不做的理由）；
- 拒绝：`tools`（需要 JS impl）、`services`（需要 spawn）、`mcp`（外部 MCP 接入是既有能力但外部插件的 mcp 声明随沙箱裁定另批）、`entry`（iframe 面板＝第三方 HTML，沙箱裁决另批）；
- 内核提供**声明式 impl 工厂**（`next/kernel/declarativeImpl.mjs` 新）：按清单生成 impl——tools 空数组、blocks 空、panes 视图由宿主视图词表承接、dataDirs 经 fileService 正常认领。

## 任务（四条）

1. **loader 正式化**（扩批次64 的 `pluginLoader.mjs`）：扫描 `.pinax/plugins/*/manifest.json`（项目级）；声明型校验（tools/services/mcp/entry 四字段出现即拒装并说明「沙箱未裁」）；经 `declarativeImpl` 生成 impl → `registry.install`；装载结果进 doctor（新态：`external-declarative` 成功／`external-rejected` 拒装带原因——复用五态框架）。
2. **宿主可见**：装入的外部插件出现在竖条（图标用通用插件图标）＋其 panes 可开窗（folder/list 等 host 视图渲染其 dataDirs）＋其 settings 节出现在 SettingsModal（通用渲染器批次45 已有）。
3. **启停与卸载**：载体管理面板可见外部插件并可停用/启用（走既有 carrierSetEnabled 链——批次45/51 的 dispose 链保证干净退场）；「卸载」=移动目录到 `.pinax/plugins/.trash/<时间戳>/`（不真删，作者数据安全）。
4. **doctor＋记账**：doctor 增外部插件装载态用例；acceptance 记账一条（fixture 从 `.pinax/plugins` 装入→竖条可算→停用释放）。

## 允许文件

`next/kernel/pluginLoader.mjs`（扩）、`next/kernel/declarativeImpl.mjs`（新）、`next/doctor.mjs`、`next/project/`（如打开路径需触发装载）、`next/shell/AppNext.vue`（竖条外部插件渲染，最小）、`next/testing/fixtures/`（外部声明型夹具）、`next/tests/`、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（计数写理由）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

**不动内置 11 块的装载方式**（批次65b）；不执行第三方 JS（impl 一律内核声明式工厂）；不动协议 schema；不动写族闸语义（外部插件 dataDirs 走同一 fileService 三道闸）；不改 `server/**`、`src/**`；不加 npm 依赖；不起 Electron、不执行 git。

## 守卫标记

批次45–64 全清单继承；本批新守卫：declarativeImpl 存在、外部声明型夹具装入用例、tools/services/mcp/entry 拒装断言。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿；真窗口实拍（外部声明型夹具出现在竖条并开窗）调度方接管；卸载回滚用例在。

## 记账指标（不进闸）

声明型外部插件的字段覆盖矩阵（哪些 @4 字段对外部开放/哪些拒）——进批次记录，供 65b 与沙箱裁定引用。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch65a-20261102.md`；§8 调度方补；diff 指引用临时索引法。）

### §7 执行方回填（Qoder CLI，2026-11-02）

- **任务1 loader 正式化：完成。** `declarativeImpl.mjs`（新，76 行）＝拒接闸＋声明式工厂；`pluginLoader.mjs`（88→145 行）新增 `loadDeclarativeFromDir`，与批次64 桩装载器并存不混用；项目打开路径（`openProject`→`externalPlugins.registerExternalPluginsOnOpen`）只走声明型。impl.mjs 在场＝stage:'form' 整目录拒装，探针夹具（ext.implprobe：一执行即计数＋抛错）在 acceptance 与测试里实证 `__pinaxImplProbe` 恒 0——红线不是口头保证。
- **任务2 宿主可见：机制完成，零改 shell 文件。** 竖条／开窗数据源 `shellView←registry.list()` 自动含外部插件；pane 图标走清单显式声明（缺省名 'plugin' 不在 WorkbenchIcon 字表——见 limitations 1）；settings 节由 collectSettingDeclarations 现收活注册表，外部 volatile 键经 GUI 可写（项目层测试⑤）。AppNext.vue 无需动。
- **任务3 启停与卸载：project 层机制＋测试完整。** 启停走既有 carrierSetEnabled 链不变；ledger 区分「新装自动启用」与「停用过保持停用」；卸载＝dispose 链跑完才移目录进 `.pinax/plugins/.trash/<UTC时间戳>/<id>`，永不真删，回滚用例在册（测试③＋acceptance 记账条）。IPC/UI 按钮接线不在允许文件，交调度方。
- **任务4 doctor＋记账：完成。** doctor 六态守卫不动，外部态另表 `EXTERNAL_PLUGIN_STATES`＋`diagnoseExternalLoads`；acceptance 新条「批次65a 外部声明型装载：fixture 装入→竖条可枚举→停用释放」总账 41/41；bundle 新门禁 w（拒接码／效应标签前缀／外部态标签进主进程 bundle＋5 份字段级拒接夹具在册，计数零变化，理由写在注释里）。
- **验证：`npm run verify:next` 五段全绿**——acceptance 41/41；node --test 710/710；vitest 14 文件/200 用例；lint:next --max-warnings 0 零告警；打包门禁 a–w 全过。
- **记账指标：@4 字段覆盖矩阵**已落批次记录 §4（开放：dataDirs/panes/settings/license/agentMd/primary/context/scopes 等；拒：tools/services/mcp/entry/commands＋impl.mjs 形态位，各带理由）。
- **limitations（全文见批次记录 §5）**：①缺省图标 'plugin' 字形不在册（改协议归一层缺省或补 src/** 字表都在禁止清单，夹具已显式声明）；②CarrierPaneHost 不为外部 dataDirs 渲染内容，开窗为空态（宿主其余文件不在允许清单）；③卸载无 IPC 通道，按钮接线交调度方；④真窗实拍归调度方；⑤同秒双卸载靠后缀重试，极端撞名报 IO_FAILED 可重跑。未执行 git、未起 Electron、未动内置 11 块与协议 schema。

