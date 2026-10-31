# 批次53 工单：12 载体迁 @4 ＋ 宿主真消费（Cordis 线B·协议迁移）（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 前置：批次52 已收口（tip `2dc0ec6`，@4 schema 与校验全绿）。工单源：roadmap §5，实质任务不改。
> **与并行会话热点提示**：`next/carriers/**` 是热点目录——派单前已确认 STATUS「当前安排」无别人占用（本管线串行派发天然满足）。

## 任务（五条）

1. **12 份 `next/carriers/*/manifest.mjs` 升 `spec:'pinax-carrier@4'`＋manifestVersion:4**，逐份填 `multiplicity/scope` 并**写明理由**（禁整批复制同一值）——调度方给基线口径供参考、执行方按语义裁并记录：小说正文 `single＋entry`（一章一编辑位）、世界书条目 `keyed＋entry`（keyField='path'）、素材/漫画记录板 `single＋project`、大纲悬浮窗 `list＋session`（overlay 多实例既有语义）、其余按 pane 实际行为裁。
2. **宿主真消费**：`next/shell/viewRegistry.mjs` 与 `next/shell/useBoardData.mjs`（2376 行——**小切口，禁止顺手重构**）按 `pane.priority` 与 `canOpen` 谓词裁决同一资源的归属面板；裁决过程记可观测结果（测试能断言「谁赢了」）。**批次58 实拍的「双中栏 pane 无切换入口」由本批的裁决/呈现收口**：comic.editor 与 comic.canvas 同载体双 center pane 的打开/切换按多实例语义走通。
3. **清掉批次44 例外表**：`KIND_OVERRIDES_BY_PANE_ID`（`next/tests/carrier-v3-rollout.test.mjs:47`）应被 @4 `claims/multiplicity` 正面表达而删除；删除时**同批补等价断言**（世界书两块 pane 的形态不回退）——「断言漂移要改断言并记理由，不许静默」。
4. **《大梦》工作副本 `D:\Projects\大梦` 的 `.pinax/project.json` 同步升 @4**（spec/schemaVersion；enabled 七块语义不变）；**C 盘原稿一个字不碰**（v3/v4 硬口径）；dameng-px 不在范围（测试场，随用户下次打开自动兼容）。
5. **打包断言**：12 块载体 @4 清单全进包、四组字段＋license＋adopt 声明齐全（bundleAssertions 新守卫，命名延续 a–n3/l 系）。

## 允许文件

12 份 `next/carriers/*/manifest.mjs`、`next/carriers/index.mjs`（如需）、`next/shell/viewRegistry.mjs`、`next/shell/useBoardData.mjs`（小切口）、`next/shell/CarrierPaneHost.vue`（如双 pane 呈现需要，最小改动）、`next/shell/AppNext.vue`（如 pane 打开路径需要，最小改动）、`next/tests/`（carrier-v3-rollout 例外表删除＋等价断言＋受影响测试）、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（新守卫＋计数写理由）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不改 `server/**`、`src/**`、`D:\CF2TF`、`D:\toonflow`、`D:\ComfyUI-0.39`；**C 盘《大梦》原稿目录一个字不碰**；不加 npm 依赖；不改写族/revision/拦截点语义（50 的成果）；不动 12 载体的 tools/context/entry/services/mcp 声明值（multiplicity/scope/claims 等新字段是本批唯一清单改动；comfy allow 名单维持批次58 态）；`useBoardData.mjs` 只做裁决小切口禁止重构；不起 Electron、不执行 git。

## 守卫标记

批次45–52 全清单继承；本批新守卫：12 份清单 spec 全 @4、`KIND_OVERRIDES_BY_PANE_ID` 全仓零命中、《大梦》project.json spec=@4。

## 验收判据（完成定义）

`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段全绿；`grep -rn "pinax-carrier@3" next/carriers/**` 归零（@3 只在兼容词表与测试夹具）；例外表已删且有等价断言；争用裁决有「谁赢了」可断言结果。

## 记账指标（不进闸）

12 载体 multiplicity/scope 逐份理由表（进批次记录）。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录由执行方落盘 `docs/plan/pinax-electron-next-m2-batch53-20261031.md`，含门禁自报/偏离/limitations/逐份理由表；§8 由调度方补；diff 指引用临时索引法。）
