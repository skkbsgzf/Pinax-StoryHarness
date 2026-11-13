# 工单 P8 · 设置增补（settings-map B-6/7/8/10）

> 基线：`D:\Pinax-next` @ `60e605a`（verify:next 全绿：验收 42/42、内核 1332/1332、界面 296/296、lint 0、打包过）
> 规格：`D:\Pinax-e2e\proto-v1\pinax-settings-map.md` 第 5/7 节（B-6/B-7/B-8/B-9 已由 P2 落，本单做 B-6/7/8/10 的剩余面）
> 字段行规范沿用 P2 的 `settings/fields.mjs`（间距/控件高/标签在上）。

## 0. 硬约束

1. `npm run verify:next` EXIT=0 五段全绿。
2. 既有断言只许按本文允许的方式扩展；翻案处注释「作者 2026-11-13 设置图谱裁定」。
3. 令牌纪律；不新增依赖；术语表（库/模块/条目/文档/提案）。
4. 不改 `.pinax/settings.json` v1 形状；不改 `next-preferences.json` 形状。
5. 不执行 git；不启停 electron。

## 1. B-6 · 外观独立小节

- 「偏好与模型」里的主题/缩放两字段迁出到新节「外观」（应用组，紧随偏好与模型）。
- 主题真源口径已正确（prefs.theme），只搬 UI；`readScheme()` 注释按 settings-map 5.2 收口（或删，二选一）。
- 「偏好与模型」节剩：模型端点＋显式保存模型说明＋恢复本节默认（本节默认只重置端点）。

## 2. B-7 · 写作节迁应用组

- 六项排版（字号/行高/段距/缩进/打字机/聚焦）从「载体」声明节（novel.writing）迁到「应用」组新节「写作」。
- 实现：新 `settings/WritingSection.vue`（应用级，读写同一组 `writing*` prefs 键）；`SettingsModal` 的 `carrierSectionComponents` 里 `novel.writing` 映射**移除**（载体声明仍在 manifest，只是 UI 不再从载体组出——移除处注释引 B-7）。
- 编辑区既有 CSS 变量投影不受影响（键不变）。

## 3. B-8 · 库设置·快捷键节

- 新 `settings/HotkeysSection.vue`（放「库设置（模块管理）」同组——存储是库级 `.pinax/hotkeys.json`）。
- 列出 `bindableIds()` 全部可改键位（批次62 三条＋批次77 五条）；每条：动作名＋当前键＋「点击录入」。
- 录入：捕获按键 → `normalizeAccelerator` → 冲突检测（`findHotkeyConflicts`）——冲突就地报错不落盘；合法走既有 `hotkeys:save` 通道。
- 「恢复默认」：整表回 `defaultBindings()`，二次确认。
- 通道已存在（`hotkeys:load`/`hotkeys:save`，ipcContract 既有），本单**不加通道**。

## 4. B-10 · 定时快照间隔控件

- 「备份与恢复」节新增控件：0–120 整数分钟，0＝关闭；写 `prefsSet({ historyIntervalMinutes })`。
- 主进程 `onPrefsApplied` 已按新值重排调度器（main.mjs 既有），前端只写偏好。
- 字段说明写明「应用级，不随库走」。

## 5. 验收

- [ ] 应用组出现：偏好与模型／外观／写作／备份与恢复／服务与通知／设置总览；载体组不再有写作偏好。
- [ ] 快捷键节能改键、撞冲突就地报错、恢复默认有二次确认（新用例 ≥4）。
- [ ] 快照间隔可改可存，0 能关（prefs 单测）。
- [ ] 主题/缩放在外观节生效照旧（迁移不破坏既有 D2 用例，允许按允许方式改写）。
- [ ] `verify:next` EXIT=0。

## 6. 允许改动的文件

```
next/shell/SettingsModal.vue
next/shell/settings/PrefsSection.vue
next/shell/settings/BackupSection.vue
next/shell/settings/AppearanceSection.vue   （新建）
next/shell/settings/WritingSection.vue      （新建）
next/shell/settings/HotkeysSection.vue      （新建）
next/shell/theme.mjs                        （仅 5.2 注释/函数收口）
next/tests/shell-ui.spec.mjs
next/tests/settings-hotkeys.test.mjs        （新建）
next/tests/app-preferences.test.mjs         （如需补 historyIntervalMinutes 断言）
```

## 7. 边界（不做）

- 不做设置总览扩展到库级键（P2 已记账）。
- 不做「重置界面」动作；不做配置导出/云同步。
- 不把 workspace.json 字段做成设置项。

## 8. 回填格式

同 P1。
