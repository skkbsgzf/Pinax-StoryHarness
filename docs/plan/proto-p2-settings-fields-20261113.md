# 工单 P2 · 设置页字段规范与恢复默认

> 基线：`D:\Pinax-next` @ `0910045`（verify:next 全绿：验收 42/42、界面 274/274、lint 0、打包过）
> 原型参考：`D:\Pinax-e2e\proto-v1\pinax-settings-wheel.html` 的**右栏**（左栏环形图**明确不要**）
> 规格：`D:\Pinax-e2e\proto-v1\pinax-settings-map.md` 第 5 节

## 硬约束

1. `npm run verify:next` 必须 EXIT=0 五段全绿。
2. 既有断言只许按本文允许的方式扩展，不许删；翻案处注释说明依据。
3. 不新增依赖；图标用 `WorkbenchIcon`。
4. 令牌纪律同上；明暗两套成立。
5. 术语只用：库 / 模块 / 条目 / 文档 / 提案。
6. 一屏一主钮。
7. 不动内核合同。
8. **不执行 git 命令；不启停 electron。**

## P2-1 字段行规范

每节统一：

```
标签（--nx-fs-2xs／600／--text-muted）
控件（高 36 或 40）
说明（--nx-fs-2xs／--text-muted，可选，≤2 行）
```

- 标签在上、控件在下；节内字段间距 16，节间距 32。
- 开关类：控件与标签同行，说明在下一行。
- 输入类：宽 ≤480；长文本 textarea，min-height 96。
- 每字段必须有可见标签（不许只靠 placeholder）。
- 规范常量/辅助函数放 `next/shell/settings/fields.mjs`（纯函数，可测）。

## P2-2 保存模型说明

- 每节标题下一句话说明保存模型（即时保存／显式保存），二选一并写清。
- 即时保存：改动即写，右下「已保存」2 秒消失（复用既有 chip）。
- 保存失败：字段下方就地报错，保留输入，不许整节重置。

## P2-3 恢复本节默认

- 每个**应用级**节底部加「恢复本节默认」，二次确认。
- 只重置本节字段；副作用（如缩放）走既有 `onPrefsApplied`。

## P2-4 设置总览（只读）

- 「应用」组最底部加一节「设置总览」：只读表列每个键、所属层、文件、当前值；提供「复制为 JSON」。
- 数据源＝`prefs:get` 返回值＋静态层/文件映射（纯函数，可测）。
- 新组件 `next/shell/settings/OverviewSection.vue`。

## P2-5 验收

- [ ] 每节都能回答「我改的东西什么时候生效」。
- [ ] 三类 Esc 行为各有用例（已有 B-4 用例，**扩展不重写**）。
- [ ] 「恢复本节默认」只重置本节；有单测。
- [ ] 「设置总览」列出每个键且层/文件正确（快照断言）。
- [ ] `verify:next` 全绿。

## P2-6 允许改动的文件

```
next/shell/SettingsModal.vue
next/shell/settings/PrefsSection.vue
next/shell/settings/BackupSection.vue
next/shell/settings/ServicesSection.vue
next/shell/settings/OverviewSection.vue     （新建）
next/shell/settings/fields.mjs              （新建，纯函数/常量）
next/tests/shell-ui.spec.mjs
next/tests/settings-fields.test.mjs         （新建）
```

## P2-7 边界（不做）

- 不做环形图、不做按存储层着色的轮盘视觉。
- 不新增设置项（「设置总览」是只读视图）；历史间隔控件（B-10）另开单。
- 不改 `next-preferences.json` 形状。

## 回填格式

同 P1。
