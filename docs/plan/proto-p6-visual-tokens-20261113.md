# 工单 P6 · 视觉令牌落地（按作者 2026-11-13 裁定「按照我发的那个 demo 去实现」）

> 基线：`D:\Pinax-next` @ `81247b7`（verify:next 全绿：验收 42/42、内核 1319/1319、界面 288/288、lint 0、打包过）
> Demo 真源：`D:\Pinax-e2e\proto-v1\*.html`（token 从各屏 `:root` 提取，**第六节有完整对照表**）
> 作者两项已裁：①珊瑚红**全局**上（不只新屏）；②页面大标题字阶照 demo（28px 档开第六档）。
> 环形图（settings-wheel 左轮）**不做**（作者 2026-11-13 裁定）。

---

## 0. 硬约束

1. `npm run verify:next` EXIT=0 五段全绿（验收 42/42、界面 ≥288、eslint 0 警、打包过）。
2. 明暗两套都要成立；对比度：正文/按钮文字 ≥4.5:1，图标/描边 ≥3:1（**demo 自身 #ff385c 底白字只有 3.5:1，不许照抄进按钮底色**——见 §2 的落法）。
3. 不新增依赖；令牌一律进 `legacy.css` / `next-shell.css` 的 token 区，组件里不写裸 `#hex`。
4. 既有断言只许按本文允许的方式改写，翻案处注释「作者 2026-11-13 按 demo 裁定」。
5. 不执行 git；不启停 electron；不动内核合同。

---

## 1. Demo 令牌真源表（照抄，不得改值）

```css
--accent:        #ff385c   /* 珊瑚红：图标/描边/选中底/纯色块 */
--accent-hover:  #e31c5f
--accent-active: #e00b41
--accent-on:     #ffffff
--bg:            #ffffff
--fg:            #222222
--muted:         #6a6a6a
--meta:          #929292
--border:        #dddddd
--border-soft:   #ebebeb
--surface-warm:  #f7f7f7
--danger:        #c13515
--success:       #008a05
--radius-sm: 8px;  --radius-md: 14px;  --radius-lg: 20px;  --radius-pill: 9999px
--motion-fast: 150ms;  --motion-base: 200ms;  --ease-standard: cubic-bezier(0.2, 0, 0, 1)
--leading-tight: 1.2;  --leading-body: 1.43
```

---

## 2. 落法：映射进现有令牌名（不是新造第二套）

### 2.1 颜色（`src/styles/themes/legacy.css`）

| 现有令牌 | 亮色新值 | 暗色新值 | 理由 |
|---|---|---|---|
| `--accent` | `#ff385c` | `#ff385c`（暗底上 4.9:1，文字可直接用） | demo 纯红；亮底上它只许做**图标/描边/色块**（≥3:1 达标），做正文色不够 4.5 |
| `--accent-hover` | `#e31c5f` | `#e31c5f` | demo hover |
| `--accent-text`（**新令牌**） | `#e00b41` | `#ff385c` | 亮底上红色**文字**用深一档（4.87:1 ≥4.5）；暗底 #ff385c 本身过 4.5 |
| `--workbench-action` | `#e00b41` | `#e00b41` | 实心主钮底色：白字 4.87:1（demo 的 #ff385c 底白字只有 3.5:1，**不许照抄**——这是对 demo 唯一的刻意偏离，注释写明） |
| `--workbench-action-hover` | `#e31c5f` | `#e31c5f` | 白字 4.58:1 仍达标 |
| `--workbench-action-text` | `#ffffff` | `#ffffff` | |
| `--danger` | 不动 | 不动 | demo #c13515 与现值语义重叠，本批不碰错误色（边界） |

- `--accent` 既有消费面（~40 处）**逐一审计**：现作**文字色**的（链接、可点词）改用 `--accent-text`；作图标/描边/色块的保持 `--accent`。逐处列出审计结论（文件:行：文字/图标）。
- `--workbench-selected`（列表选中底）不动——demo 未覆盖列表选中形态。

### 2.2 圆角（`next-shell.css` token 区）

| 新令牌 | 值 | 用途 |
|---|---|---|
| `--nx-radius-lg`（新） | `14px` | 卡片（LibraryCard）、弹窗内大块面 |
| `--nx-radius-pill` | `999px` → `9999px` | 与 demo 一致（视觉无差，值对齐） |

- **库管理器顶栏两枚钮改药丸形**（`border-radius: var(--nx-radius-pill)`）：「新建库」（实心红）与「打开文件夹…」（白底描边）——demo 原样。
- `--radius-control: 10px`、`--radius-surface: 24px` 不动（demo 未覆盖设置弹窗整体圆角；24px 与 demo lg 20 接近，不折腾）。

### 2.3 字阶（`next-shell.css` token 区 + LibraryManager）

- `--nx-fs-3xl: 28px`（**新档**，仅页面主标题用——现阶段唯一消费点是库管理器「我的库」；翻案注释：68-R1 五档收敛，作者 2026-11-13 按 demo 裁定开第六档）。
- LibraryManager 的 `.lib-title` 从现有档改 `var(--nx-fs-3xl)`＋`leading var(--leading-tight≈1.2)`。
- 其它字号一律不动（demo 的 14/12 与现有 md/2xs 对应）。

### 2.4 库管理器卡片（LibraryCard / LibraryManager）

- 卡片圆角 `var(--nx-radius-lg)`（14px）。
- 选中/悬停态照 demo：**悬停＝描边加深**（不改文字色）；**选中（最近打开的第一张）＝`inset 0 0 0 1px var(--fg)`＋外描边 2px 墨色**（demo 原话 `inset 0 0 0 1px var(--fg)`，做成 2px 墨环）。
- 类型胶囊：`--nx-radius-pill`＋细描边（demo 原样）。
- 卡片底 `--surface-workbench-raised` 不动；demo 的 `--surface-warm #f7f7f7` 收进 token 注释备查，不新增消费。

### 2.5 筛选条改 demo 口径（翻案）

- **全部 7 个类别 tab 恒渲染**（全部/小说/剧本/漫剧/世界书/资料/未分类），零计数照显（demo 原样）；作者 2026-11-13「按照 demo 去实现」——P1 的「零计数不渲染」沉默层口径被此裁定**推翻**，翻案注释写进用例。
- 选中态＝文字墨色＋2px 下划线（demo 原样，现实现已接近，对齐即可）。
- 「类别管理」链接（demo 右上角）**不做**（无此功能，不摆死入口）。

### 2.6 发送钮与红色面（全局自然生效，不单独改）

- Agent 发送钮走 `--workbench-action` → 自动变红（demo 原样）。
- 「已保存」类确认 chip、focus ring 等 `--accent` 消费者随 2.1 的审计结果走。

---

## 3. 允许改动的文件

```
src/styles/themes/legacy.css                （token 值：亮/暗两段）
next/shell/styles/next-shell.css            （--nx-fs-3xl/--nx-radius-lg/pill 值/新令牌）
next/shell/library/LibraryManager.vue
next/shell/library/LibraryCard.vue
next/shell/library/libraryFilters.mjs       （tab 恒渲染的口径改动＋用例）
next/shell/*.vue                            （仅 --accent 文字色消费者 → --accent-text 的逐处替换）
next/tests/visual-contract.test.mjs
next/tests/library-manager.spec.mjs
next/tests/library-filters.test.mjs
next/tests/settings-fields.test.mjs
```

## 4. 验收

- [ ] 库管理器：标题 28px、两枚药丸钮（红实心＋白描边）、卡片 14px 圆角＋选中墨环＋悬停描边加深、筛选条 7 tab 恒在。
- [ ] Agent 发送钮、设置主钮等**全部实心主钮变红**（`--workbench-action` 生效），白字对比度 ≥4.5。
- [ ] `--accent` 作正文色的消费点全部迁 `--accent-text`（亮底 4.87:1），审计清单落工单回填。
- [ ] 暗色主题整屏过一遍不破（截图两套）。
- [ ] `verify:next` EXIT=0；新增/改写用例均有翻案注释。

## 5. 边界（不做）

- 不做设置轮盘环形图；不做 wiki 五页签；不做推演三栏工作区（另单）。
- 不改 `--danger`/`--success` 值（demo 有但本批不碰错误/成功色）。
- 不动列表选中底 `--workbench-selected`。
- 不做 demo 未覆盖屏（提案审阅/大纲转换等）的额外重绘——它们只吃全局 token 变化。

## 6. 回填格式

同 P1（改动文件对账＋门禁读数＋limitations），另附：`--accent` 消费审计表（文件：行：文字/图标/底色）。
