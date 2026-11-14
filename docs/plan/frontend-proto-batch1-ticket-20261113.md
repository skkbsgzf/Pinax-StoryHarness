# 前端工单 · 第一批（原型落地 P1–P3）

> 基线：`D:\Pinax-next` @ `0910045`（2026-11-13，verify:next 全绿：验收 42/42、界面 274/274、lint 0、打包过）
> 原型来源：`C:\Users\Administrator\Downloads\原型图第一版.zip`（已解包到 `D:\Pinax-e2e\proto-v1\`）
> 作者裁定（2026-11-13）：**环形图不需要**，其余原型均可参考；条目/字段形态以文字为准，原型只作布局参考。
> 交付对象：Coding Agent（Qoder / CodeBuddy）。本文是执行合同，条目编号即任务编号。

---

## 0. 硬约束（违反即打回）

1. **门禁不许红**：每单结束跑 `npm run verify:next`，必须 EXIT=0 五段全绿（验收 42/42、界面 ≥274、eslint 0 警、打包门禁）。
2. **既有断言只许按本工单明确允许的方式改写**，不许删。改写处必须写注释说明「翻案依据」。
3. **不新增依赖**（不引 UI 库、不引图标库；图标用既有 `WorkbenchIcon`）。
4. **令牌纪律**：颜色/字号/圆角/间距一律走既有 `--nx-*` / `--surface-*` / `--hairline-*`；禁裸 `#hex`、禁裸 px 字号。明暗两套都要成立。
5. **术语**：界面只出现「库 / 模块 / 条目 / 文档 / 提案」。禁「载体 / 载板 / 板块 / 工程」。
6. **一屏一主钮**：同屏只允许一个实心主按钮。
7. **不动内核**：`next/kernel/*`、`next/project/*`、`next/fact/*` 的合同字段与错误码语义不动。
8. **不执行 git 命令**；**不启停 electron 进程**。

---

## 1. 背景：三单并行，互不碰面

| 单号 | 主题 | 主导文件 | 与另两单的关系 |
|---|---|---|---|
| **P1** | 库管理器筛选与卡片信息 | `next/shell/library/*` | 独立 |
| **P2** | 设置页字段规范与恢复默认 | `next/shell/SettingsModal.vue`＋`next/shell/settings/*` | 独立 |
| **P3** | 世界书板左栏分组列表 | `next/shell/IndexWindow.vue`＋`next/shell/entriesView.mjs` | 独立 |

三单文件面完全不重叠，可同批次并行派给不同 Agent。

---

## 2. P1 · 库管理器筛选与卡片信息

**原型参考**：`pinax-library-screen.html`（"我的库"屏）

### P1-1 类型筛选条

- 「我的库」标题与卡片区之间加一条筛选条，形如：`全部 · 小说 · 剧本 · 漫剧 · 世界书 · 资料 · 未分类`
- 判定：
  - 筛选值来自 `recentProjects[].kind`（已存在字段，`open/create` 成功时写入）。
  - 映射：`novel→小说`、`script→剧本`、`comic→漫剧`、`worldbook→世界书`、`reference|dossier→资料`；其余或缺失→`未分类`。
  - 映射表放**纯函数**（建议 `next/shell/library/libraryFilters.mjs`），可被 node:test 直接测。
- 行为：
  - 点某类＝只显示该类卡片；无该类卡片时显示一句「这里还没有这一类库」＋「新建库」入口（不空白）。
  - 筛选状态**不落盘**（会话内记忆即可）；默认「全部」。
  - 各 tab 上带计数（如 `小说 3`），计数为 0 的类别**不渲染 tab**（沉默层：零内容不出现容器）。
- 无障碍：筛选条是 `role="tablist"`，tab 为 `role="tab"` 且 `aria-selected`；方向键左右切换（复用 `SettingsModal.vue` 的 roving tabindex 写法）。

### P1-2 卡片补「篇章数」

- 卡片第三行现在只有路径与相对时间；补一格篇数，形如 `12 篇 · 昨天编辑`。
- **数据来源必须可解释**：篇数从打开该库时的 `view`（shellView 的 chapters/pages 计数）之外拿不到，因此：
  - **首选**：`recentProjects[].count` 在 open/create 成功时由主进程写入 `{ count, countAt }`（复用 `onProjectOpened` 那条链，与 `name/kind` 同处）；
  - 拿不到（旧记录无该字段）→ 卡片只显示时间，**不扫盘、不猜数**。
- 篇数口径写进纯函数注释：`count`＝该项目 `正文/` 下章节文件数（novel）或对应主模块的条目数；由主进程在打开时统计一次。

### P1-3 验收

- [ ] 有 3 类库时，筛选 tab 只出现有内容的 3 类＋「全部」。
- [ ] 点「剧本」只留剧本卡；该类为空时出现空态与新建入口。
- [ ] 旧记录（无 `count`/`kind`）不崩、不显示错值。
- [ ] 键盘：Ctrl+P 面板外的 Tab 顺序不被打乱；筛选条方向键可用。
- [ ] `verify:next` 全绿；新增纯函数用例 ≥4 条。

### P1-4 允许改动的文件

```
next/shell/library/LibraryManager.vue
next/shell/library/LibraryCard.vue
next/shell/library/libraryFilters.mjs        （新建，纯函数）
next/runtime/appPreferences.mjs              （仅新增 count/countAt 可选字段的归一）
next/shell/main.mjs                          （仅 onProjectOpened 记账处补 count）
next/tests/library-manager.spec.mjs
next/tests/app-preferences.test.mjs
next/tests/library-filters.test.mjs          （新建）
```

### P1-5 边界（不做）

- 不做库卡片右键菜单扩展、不做分页/虚拟滚动（20 条上限内）。
- 不改「更多」菜单既有两项。
- 不做类型手改（类别来自项目 `kind`，界面不给改）。

---

## 3. P2 · 设置页字段规范与恢复默认

**原型参考**：`pinax-settings-wheel.html` 的**右栏**（左栏环形图**明确不要**）；规格以 `pinax-settings-map.md` 第 5 节为准。

### P2-1 字段行规范

每个设置节统一成：

```
标签（--nx-fs-2xs／600／--text-muted）
控件（高 36 或 40）
说明（--nx-fs-2xs／--text-muted，可选，≤2 行）
```

- 标签在上、控件在下；节内字段间距 16，节间距 32。
- 开关类：控件与标签同行，说明在下一行。
- 输入类：宽 ≤480；长文本 textarea，min-height 96。
- 每个字段必须有可见标签（不许只靠 placeholder）。

### P2-2 保存模型说明

- 每节标题下一句话说明保存模型（即时保存／显式保存），二选一并写清。
- 即时保存：改动即写，右下角「已保存」2 秒消失（已有 chip 模式，复用）。
- 保存失败：字段下方就地报错，保留输入，不许整节重置。

### P2-3 恢复本节默认

- 每个**应用级**节底部加「恢复本节默认」，二次确认（复用 `WorkbenchModal` 的确认写法或 `window.confirm` 留痕）。
- 只重置本节字段；副作用（如改缩放）走既有 `onPrefsApplied`。

### P2-4 设置总览（只读）

- 「应用」组最底部加一节「设置总览」：只读表列每个键、所属层、文件、当前值；提供「复制为 JSON」。
- 数据源＝`prefs:get` 的返回值＋静态层/文件映射表（纯函数，可测）。

### P2-5 验收

- [ ] 每节都能回答「我改的东西什么时候生效」。
- [ ] 三类 Esc 行为各有用例（已有 B-4 用例，扩展不重写）。
- [ ] 「恢复本节默认」只重置本节；有单测。
- [ ] 「设置总览」列出每个键且层/文件正确（快照断言）。
- [ ] `verify:next` 全绿。

### P2-6 允许改动的文件

```
next/shell/SettingsModal.vue
next/shell/settings/PrefsSection.vue
next/shell/settings/BackupSection.vue
next/shell/settings/ServicesSection.vue
next/shell/settings/OverviewSection.vue     （新建：设置总览）
next/shell/settings/fields.mjs              （新建：字段行规范纯函数/常量）
next/tests/shell-ui.spec.mjs
next/tests/settings-fields.test.mjs         （新建）
```

### P2-7 边界（不做）

- 不做环形图、不做按存储层着色的轮盘视觉。
- 不新增设置项（除「设置总览」是只读视图）；历史间隔控件（B-10）**另开单**。
- 不改 `next-preferences.json` 形状。

---

## 4. P3 · 世界书板左栏分组列表

**原型参考**：`pinax-writing-screen.html` 的左栏（世界书板：搜索＋分组列表＋每项段数）

### P3-1 左栏形态

- 世界书板（`pinax.carrier.worldbook` 的 `left-dock` pane）左栏从「树」改为**分组列表**：

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

- 分组键＝世界书条目的 `type`（人物／地理／势力／编年／设定…），映射到人话组名；`relations` 数单独成「关系图谱」组头。
- 每项右侧显示该条目的**段数**（`segs.length` 或正文段数，取已有字段，不新算）。
- 组默认展开；组头可折叠（折叠状态会话内记忆，不落盘）。

### P3-2 与中栏联动

- 点组头「关系图谱」→中栏切 `graph` 态（复用既有 `entriesView` 三态切换）。
- 点条目行→中栏开该条目（复用既有 `openEntry`）。
- 搜索框：过滤列表（按 name/keys/summary），无命中给「没有匹配的条目」。

### P3-3 实现落点

- 新组件 `next/shell/entriesGroupedList.mjs`（纯函数：分组/排序/过滤，可测）＋ `next/shell/WorldbookGroupedTree.vue`（渲染）。
- `IndexWindow.vue` 的世界书分支切换到这个组件；**其他载体的树不动**。
- 段数来源确认：`segs` 字段若不存在，用正文按空行切分的段数（在纯函数里实现并注释口径）。

### P3-4 验收

- [ ] 世界书板左栏呈现分组列表，组头带计数、条目带段数。
- [ ] 点组头切图谱、点条目开条目、搜索可过滤。
- [ ] 其他载体（正文/大纲/构思）左树**行为不变**（回归用例）。
- [ ] 折叠状态不落盘。
- [ ] `verify:next` 全绿；纯函数用例 ≥6 条。

### P3-5 允许改动的文件

```
next/shell/IndexWindow.vue                      （仅世界书分支）
next/shell/WorldbookGroupedTree.vue             （新建）
next/shell/entriesGroupedList.mjs               （新建，纯函数）
next/tests/shell-ui.spec.mjs
next/tests/entries-grouped-list.test.mjs        （新建）
```

### P3-6 边界（不做）

- 不做中栏五页签（wiki 矩阵/时间线/章纲/伏笔/概览）——那是 S4／另开单。
- 不做拖拽排序、不做条目新建/删除。
- 不改 `entriesView.mjs` 的三态词表。

---

## 5. 完成定义（DoD）

- [ ] 三单各自 `verify:next` EXIT=0，且**互不修改对方允许清单外的文件**。
- [ ] 每单在 `docs/STATUS.md` 的「Recently done」追加一条：改了什么、门禁数字（实际跑出来的）、剩余边界。
- [ ] 新增纯函数都有 node:test 用例。
- [ ] 界面无「载体/载板/板块/工程」（P3 若触碰世界书文案，措辞用「条目」）。

## 6. 报告格式（每单回填）

```
## 执行记录
- 单号 / 执行方 / 日期
- 改动文件清单（与允许清单逐条对账，越界登记理由）
- 门禁读数：验收 x/42、界面 x/274、eslint、打包
- 截图或 DOM 断言证据（至少一条界面级）
- limitations（做不到的、挂账的）
```
