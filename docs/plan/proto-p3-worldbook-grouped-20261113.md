# 工单 P3 · 世界书板左栏分组列表

> 基线：`D:\Pinax-next` @ `0910045`（verify:next 全绿：验收 42/42、界面 274/274、lint 0、打包过）
> 原型参考：`D:\Pinax-e2e\proto-v1\pinax-writing-screen.html` 的左栏（世界书板：搜索＋分组列表＋每项段数）
> 作者裁定：环形图不需要，其余原型可参考；以本文文字为准。

## 硬约束

1. `npm run verify:next` 必须 EXIT=0 五段全绿。
2. 既有断言只许按本文允许的方式改写，翻案处注释说明依据。
3. 不新增依赖；图标用 `WorkbenchIcon`。
4. 令牌纪律同上；明暗两套成立。
5. 术语只用：库 / 模块 / 条目 / 文档 / 提案（世界书里叫「条目」）。
6. 一屏一主钮。
7. 不动内核合同。
8. **不执行 git 命令；不启停 electron。**

## P3-1 左栏形态

世界书板（`pinax.carrier.worldbook` 的 `left-dock` pane）左栏从「树」改为**分组列表**：

```
[搜索条目…]
关系图谱            7 节点      ← 组头（可点，切中栏图谱）
人物                3
  林砚             16 段
  沈鹤             12 段
  老周              8 段
地点                2
  雾港              9 段
  灯船              6 段
物件                2
  旧钟楼            4 段
  旧木箱            3 段
```

- 分组键＝条目 `type`（人物／地理／势力／编年／设定…），映射人话组名；`relations` 单独成「关系图谱」组头。
- 每项右侧显示该条目**段数**（`segs.length` 或正文按空行切分，取已有字段，不新算其它指标）。
- 组默认展开；组头可折叠（会话内记忆，不落盘）。

## P3-2 与中栏联动

- 点组头「关系图谱」→中栏切 `graph`（复用既有 `entriesView` 三态切换）。
- 点条目行→中栏开该条目（复用既有 `openEntry`）。
- 搜索框按 name/keys/summary 过滤；无命中给「没有匹配的条目」。

## P3-3 实现落点

- 新组件 `next/shell/WorldbookGroupedTree.vue`（渲染）。
- 新纯函数 `next/shell/entriesGroupedList.mjs`：分组/排序/过滤，可 node:test 直测。
- `IndexWindow.vue` 的**世界书分支**切换到此组件；其他载体的树不动。
- 段数口径写进纯函数注释。

## P3-4 验收

- [ ] 世界书板左栏呈现分组列表，组头带计数、条目带段数。
- [ ] 点组头切图谱、点条目开条目、搜索可过滤。
- [ ] 其他载体（正文/大纲/构思）左树**行为不变**（回归用例）。
- [ ] 折叠状态不落盘。
- [ ] `verify:next` 全绿；纯函数用例 ≥6 条。

## P3-5 允许改动的文件

```
next/shell/IndexWindow.vue                      （仅世界书分支）
next/shell/WorldbookGroupedTree.vue             （新建）
next/shell/entriesGroupedList.mjs               （新建，纯函数）
next/tests/shell-ui.spec.mjs
next/tests/entries-grouped-list.test.mjs        （新建）
```

## P3-6 边界（不做）

- 不做中栏五页签（wiki 矩阵/时间线/章纲/伏笔/概览）——S4／另开单。
- 不做拖拽排序、不做条目新建/删除。
- 不改 `entriesView.mjs` 三态词表。

## 回填格式

同 P1。
