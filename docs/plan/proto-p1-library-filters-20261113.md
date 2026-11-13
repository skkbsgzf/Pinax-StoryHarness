# 工单 P1 · 库管理器筛选与卡片信息

> 基线：`D:\Pinax-next` @ `0910045`（verify:next 全绿：验收 42/42、界面 274/274、lint 0、打包过）
> 原型参考：`D:\Pinax-e2e\proto-v1\pinax-library-screen.html`（"我的库"屏）
> 作者裁定：环形图不需要，其余原型可参考；以本文文字为准。

## 硬约束

1. `npm run verify:next` 必须 EXIT=0 五段全绿（验收 42/42、界面 ≥274、eslint 0 警、打包门禁）。
2. 既有断言只许按本文明确允许的方式改写，改写处注释说明翻案依据。
3. 不新增依赖；图标用既有 `WorkbenchIcon`。
4. 令牌纪律：颜色/字号/圆角/间距走 `--nx-*` / `--surface-*` / `--hairline-*`；禁裸 `#hex`、禁裸 px 字号；明暗两套成立。
5. 术语只用：库 / 模块 / 条目 / 文档 / 提案。禁「载体 / 载板 / 板块 / 工程」。
6. 一屏一主钮。
7. 不动 `next/kernel/*`、`next/project/*`、`next/fact/*` 合同。
8. **不执行 git 命令；不启停 electron。**

## P1-1 类型筛选条

「我的库」标题与卡片区之间加筛选条：`全部 · 小说 · 剧本 · 漫剧 · 世界书 · 资料 · 未分类`

- 筛选值来自 `recentProjects[].kind`（已存在字段）。
- 映射（放纯函数 `next/shell/library/libraryFilters.mjs`）：`novel→小说`、`script→剧本`、`comic→漫剧`、`worldbook→世界书`、`reference|dossier→资料`；其余/缺失→`未分类`。
- 点某类＝只显示该类；该类无卡片时显示「这里还没有这一类库」＋「新建库」入口（不空白）。
- 筛选状态不落盘（会话内记忆），默认「全部」。
- tab 带计数；计数为 0 的类别**不渲染**（沉默层）。
- 无障碍：`role="tablist"` / `role="tab"` / `aria-selected`；方向键左右切换（复用 `SettingsModal.vue` 的 roving tabindex 写法）。

## P1-2 卡片补「篇章数」

卡片第三行补篇数：`12 篇 · 昨天编辑`。

- 数据来源：`recentProjects[].count` 在 open/create 成功时由主进程写入 `{ count, countAt }`（复用 `onProjectOpened`，与 `name/kind` 同处）。
- 旧记录无该字段 → 只显示时间，**不扫盘、不猜数**。
- 口径写进纯函数注释：count＝项目 `正文/` 下章节文件数（novel）或主模块条目数；主进程打开时统计一次。

## P1-3 验收

- [ ] 有 3 类库时，筛选 tab 只出现有内容的 3 类＋「全部」。
- [ ] 点「剧本」只留剧本卡；该类为空时出现空态与新建入口。
- [ ] 旧记录（无 `count`/`kind`）不崩、不显示错值。
- [ ] 键盘：Tab 顺序不被打乱；筛选条方向键可用。
- [ ] `verify:next` 全绿；新增纯函数用例 ≥4 条。

## P1-4 允许改动的文件

```
next/shell/library/LibraryManager.vue
next/shell/library/LibraryCard.vue
next/shell/library/libraryFilters.mjs        （新建，纯函数）
next/runtime/appPreferences.mjs              （仅新增 count/countAt 可选字段归一）
next/shell/main.mjs                          （仅 onProjectOpened 记账处补 count）
next/tests/library-manager.spec.mjs
next/tests/app-preferences.test.mjs
next/tests/library-filters.test.mjs          （新建）
```

## P1-5 边界（不做）

- 不做库卡片右键菜单扩展、不做分页/虚拟滚动（20 条上限内）。
- 不改「更多」菜单既有两项。
- 不做类型手改（类别来自项目 `kind`）。

## 回填格式

```
## 执行记录
- 单号 / 执行方 / 日期
- 改动文件清单（与允许清单逐条对账，越界登记理由）
- 门禁读数：验收 x/42、界面 x/274、eslint、打包
- 界面级证据（DOM 断言或截图）
- limitations
```
