# Pinax-Electron-Next M2 批次22：收口包＋写作偏好节（2026-10-29）

> 执行：workflow coder（DeepSeek flash）两单全绿；调度方验收（独立复跑 219/219＋73/73）。
> 工单：收口包（批次14–21 记账五笔）＋写作偏好节（载体设置注册制首个真内容）。

## 1. 交付

**A 收口包（五笔）**
1. 大纲/条目保存双通道——**开工前核对发现批次21 已落地**（Ctrl+S 选择器、常驻按钮、STALE 恢复路径俱在），如实报无需新改（避免重做）。
2. 条目摘要（summary）读取口＋界面输入：setting context/tools 加 summary 透传（裁定 dwfq-5c79bf4a-1）；条目编辑态「摘要」栏（≤500 字）随 meta 传；阅读态 meta 行尾摘要截 80 字。
3. 提案↔历史联动测试：writeProposal→setOnWrite→markDirty→commitSnapshot→listFileHistory/readVersion 全链路用例（history-git.test.mjs:179）。
4. 外壳 bundle 体积断言：e2「外壳 bundle < 2.5 MB（含 git 库＋知识服务）」——实测 1602.0 kB。
5. overlay 窗控随主题与缩放：prefs:theme 事件通道（theme.mjs writeScheme 后 fire-and-forget，裁定 dwfq-5c79bf4a-1）＋main.mjs updateTitleBarOverlay（启动/onPrefsApplied/onThemeChanged 三触发；symbolColor 明暗两档、height=36×zoom DIP 对齐）。

**B 写作偏好节（载体设置注册制首个真内容）**
- `next/runtime/appPreferences.mjs`：writingFontSize（14–22，默认 17）/writingLineHeight（1.6–2.4 步进 0.05，默认 1.9）校验与默认值。
- `WritingPrefsSection.vue`（新）：载体组「写作偏好」节——正文字号/行高两行，保存走 prefsSet 即时生效（编辑区 CSS 变量 `--writing-font-size/--writing-line-height`，.editor-area 消费，回退 `--nx-fs-lg`/1.9）。
- ipcContract prefsSet 白名单加两字段（保持「带了才写」语义）；shell-contract 用真 appPreferences 实例钉透传。
- 断言同步：app-preferences 往返期望补新默认字段；shell-ui P14 用例改「真内容＋未声明仍空态」。

## 2. 门禁

调度方独立复跑：验收 16/16、内核单测 **219/219**、外壳界面测 **73/73**、eslint 0 警、打包 a–k 全过（内核 bundle 918.9 kB、外壳 1602.0 kB、渲染 510.5 kB、CSS 109.9 kB）。工单侧每单门禁一次实跑全绿。

## 3. 截图

`png/47-light-writing-prefs.png`（写作偏好节：字号/行高＋保存）、`48-light-save-chip.png`（去噪后编辑面 Ctrl+S chip）、`49-dark-save-chip.png`（深色）。批次20 的四组菜单与设置分组同框可见。

## 4. 诚实边界

- .editor-area 是共享类：写作偏好作用于全部编辑面（章节/构思/约束/条目/资料）——工单指定如此；若要只对章节生效需另裁。
- 偏好只在挂载时读一次，外部改偏好文件不热更新（本节保存后由 writing-prefs 事件即时生效）。
- 保存写作偏好会触发既有 onPrefsApplied 把 uiZoom 重落偏好值（null→0.85）——既有语义未改。
- chip 的「已保存 · 第 N 版」保留版本号（工单只改按钮文案；chip 版本号去留待裁）。
- 阅读态摘要按 UTF-16 slice 截 80 字（emoji 代理对可能劈开，中文无影响）。
- 大纲/条目的 Ctrl+S 在批次21 前已部分接通，本批补的是 chip 反馈（执行方核对后如实报，未重做）。
- 未做自动保存（老版同为手动触发，属另一裁定）；字体族选择未做（已自托管霞鹜文楷）。
