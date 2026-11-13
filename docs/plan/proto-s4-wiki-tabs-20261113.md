# 工单 S4 · wiki 派生进 kernel ＋ 世界书五页签（S0-S5 工单排期 S4）

> 基线：`D:\Pinax-next` @ `cd81b79`（S2 已收口：writeFactFile/readFactWiki/两代兼容全绿；verify:next EXIT=0）
> 原型：`D:\Pinax-e2e\proto-v1\pinax-wiki-page.html`（五页签 wiki 页）；规格补充：`pinax-worldbook-system.md`
> 派生算法真源：`devtools/build-wiki.mjs`（680 行，零模型纯计算：buildBook/deriveCharacter/firstAppearances/deriveTerms/extractPalette/chapterTitlesFromSource）

## 0. 硬约束

1. `npm run verify:next` EXIT=0 五段全绿。
2. **派生算法一字不改**：S4-01 是「搬家＋改输出格式（HTML→JSON）」，不是重写；输入拆解 JSON，输出 wiki JSON 字段与现有 `result.wiki` 对齐。
3. devtools 版 build-wiki **保留**（对照用，工单边界明文）。
4. 令牌纪律；术语表；不新增依赖（图/表用现有依赖——d3-hierarchy 已在 deps，EntriesBoard 图谱在用）。
5. 不执行 git；不启停 electron。

## 1. WO-S4-01 · wiki 派生进 kernel

- 新 `next/kernel/wikiDerive.mjs`：从 `build-wiki.mjs` 搬派生核心（buildBook/deriveCharacter/firstAppearances/deriveTerms 等），导出 `deriveWiki(factEnvelope | entries, options)` → **纯 JSON 对象**（不产 HTML/字符串拼接 CSS——devtools 版的 HTML 壳与 SVG 生成不搬，字段结构对齐既有 `result.wiki`）。
- 写出：经 `writeFactFile` 的 wiki 分离路径（S2 已建）——`拆解/<id>.wiki.json`（`derivedFrom:{factRevision, schema:'pinax-wiki-derived@1'}`）。
- 读出：`readFactWiki` 已有两代兼容（S2 建好），直接消费。
- 用例：夹具拆解 → deriveWiki → 字段结构断言；同输入两次派生输出 deepEqual（纯函数幂等）。

## 2. 通道（新增两条只读＋一条派生，均显式收 root——追加性扩展，已冻结的四条签名不动）

| 通道 | 请求 | 响应 |
|---|---|---|
| `fact:wiki:get` | `{root, bookId}` | `{ok, wiki, derivedFrom}`（无则 `{ok, wiki:null}`） |
| `fact:wiki:derive` | `{root, bookId}` | `{ok, wiki, derivedFrom}`（跑派生并经 writeFactFile 落 wiki.json；纯计算无模型调用） |

- 命名：`factWikiGet: 'pinax:agent:fact:wiki:get'`、`factWikiDerive: 'pinax:agent:fact:wiki:derive'`，进 `IPC_CHANNELS`。
- main 注入沿用 `factStoreFor`（store 加 `wikiGet/wikiDerive` 两方法，derive 调 kernel 的 deriveWiki）。

## 3. WO-S4-02 · 世界书板五页签（前端）

- 世界书板中栏在既有 **阅读/表格/图谱** 三态之外，新增 wiki 页签组（`entriesView.mjs` 词表扩展或独立 wiki 视图，按现有 entriesView 先例做状态记忆）：
  - **概览**：条目总数/类型分布/可溯源率——数据全部来自 wiki JSON 既有字段。
  - **人物矩阵**：demo 的热力矩阵（人物 × 章节出现密度）；实现用现有图谱依赖，不引新库。
  - **时间线**：按 `chapters`/事件回目排布。
  - **章纲**：章纲列表（wiki 章纲字段）。
  - **伏笔**：伏笔窄窗条目。
- 新组件放 `next/shell/wiki/`（WikiTabs.vue ＋ 每页签子组件/纯函数），EntriesBoard 挂 wiki 入口——**只加不改**既有三态与 P3 分组左栏。
- 数据经 `fact:wiki:get`；库根无拆解数据 → 页签不出现（沉默层）。「派生 wiki」动作钮放 wiki 页签内（点 → `fact:wiki:derive` → 刷新），不在无数据态摆死钮。
- **术语**：屏面用「条目/章节/伏笔」；不出现 wiki 之外的行话。

## 4. 验收

- [ ] deriveWiki 纯函数用例 ≥5（结构/幂等/空输入）。
- [ ] 两通道 Node 级用例（get 空态/derive 落盘/get 回读）。
- [ ] 五页签 UI 用例：有数据显页签、无数据整组不出现、派生钮走通、页签状态记忆。
- [ ] 既有三态与 P3 分组左栏零回归。
- [ ] `verify:next` EXIT=0。

## 5. 允许改动的文件

```
next/kernel/wikiDerive.mjs                  （新建）
next/kernel/factFileStore.mjs               （wikiGet/wikiDerive 两方法）
next/shell/ipcContract.mjs                  （两通道）
next/shell/main.mjs                         （无新注入则不动）
next/shell/wiki/WikiTabs.vue                （新建）
next/shell/wiki/*.mjs                       （新建，页签纯函数）
next/shell/EntriesBoard.vue                 （仅挂 wiki 入口）
next/shell/entriesView.mjs                  （如需视图词表扩展）
next/tests/wiki-derive.test.mjs             （新建）
next/tests/fact-wiki-channels.test.mjs      （新建）
next/tests/shell-ui.spec.mjs
next/tests/visual-contract.test.mjs         （如钉页签声明）
```

## 6. 边界（不做）

- 不删 devtools/build-wiki.mjs（对照保留）。
- 不做模型派生（章纲/梗概的 LLM 归纳另议）；本单全部零模型纯计算。
- 不做跨书聚合 wiki（单库内按 bookId）。
- 不做图谱自动布局（worldbook-system.md 下一步第 5 条，另议）。

## 7. 回填格式

同 P1。
