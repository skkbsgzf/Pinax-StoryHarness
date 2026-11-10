# 小说创作套件功能对账总表（老线 → Next，截至批次46B/48 前）（2026-10-31）

> 标杆1（小说创作套件）的验收底账。老线证据行号来自 2026-10-30 盘点实测（`docs/plan/pinax-next-carrier-migration-audit-20261030.md` 口径，两处过时项已按批次40/41/43 更正）；「落点」＝新线批次。
> 用法：每行是作者的一只「手」。标杆1 的完成定义＝核心三组全绿，其余如实挂账。

## A. 写作核心（标杆1 主场）

| 功能 | 老线证据 | Next 现状 | 落点 |
|---|---|---|---|
| 五动作（续写/改写/扩写/压缩/润色）＋结果卡（插入光标处/替换选中段） | WritingNotebookEditor.vue:251-268 | ✅ 闭集五动作＋额外要求 500 字 | 41 |
| 五动作带本书参考（续写参考） | Authoring.vue:1440,3391-3399 | ✅ 信封组块【本书参考】段（大纲/世界书/约束，缺席降级＋如实标注）＋references 清单 | 46A |
| 提示词预览（作者可见） | PromptPreviewPanel.vue（383 行） | ✅ 最近一次 system+user 折叠层（非实时） | 46A |
| 审查本章（章节体检） | Authoring.vue:10224-10227＝开校对面；openclawService.js:13 writing.chapter.health | ✅ 骑 authoring.review.chapter 只读轨；结果卡 summary/issues/actions＋逐条「转改写」；真模型未验（无凭据，失败路径已验） | 46A |
| 校对批次会话（发现→跳转→候选→事务重放） | useAuthoringReviewWorkflow.js:5-26 | ❌ 挂账（一次一报，无批次会话） | — |
| 行内联想（Ghost/Tab 全采/Ctrl+→ 采句/Esc 忽略） | WritingNotebookEditor.vue:549-557 | ❌ 挂账（协议级岔口：PM 装饰体系 vs textarea） | — |
| 自动保存 | Authoring.vue:8515 起 | ✅ 停手 1500ms，与 Ctrl+S 同路同修订号闸；truncated 不自动存 | 43 |
| 排版偏好（段距/缩进/打字机/专注） | WritingPreferences.vue:11-16 | ✅ 四项＋字号行高（应用级） | 22/46B |
| 快捷词（角色/设定/正文提取） | authoringQuickWords.js:8-45 | ✅ 派生目录＋浮层＋插入光标处（不落盘，同老线） | 46B |
| 取名（本地词库＋查重） | writingNameGenerator.js | ✅ 浮层取名页签＋重名摆灰 | 46B |
| 查找替换（全书） | Authoring.vue:3138,3150-3172 | ✅ 全书查找＋当前章替换（走修订号闸）；全书一键替换有意不做 | 46B |
| 块编辑器（ProseMirror）/批注/世界书行内提及 | Authoring.vue 10,892 行＋NotebookEditor 4,034 行 | ❌ 挂账（md 单真源是 R1 裁定，PM 双真源是协议级抉择） | — |
| 生图（章节配图抽屉） | AuthoringIllustratorDrawer（:1284） | ❌ 归标杆2（comic 载体 ComfyUI 链，批次48 骨架） | 48 |

## B. 章节与文件管理

| 功能 | 老线证据 | Next 现状 | 落点 |
|---|---|---|---|
| 新建章节 | Authoring.vue:8470-8492 | ✅ 索引窗「＋」 | 12 |
| 删除章节（连历史） | Authoring.vue:3365-3371,8500 | ✅ 两步确认＋**删前强制历史快照**＋修订账清理＋未审提案保护（两轨通拦） | 46A |
| 重命名章节 | Authoring.vue:3358-3363 | ✅ 行内重命名（同目录、NNN 前缀保留、账本迁移） | 46A |
| 排序（拖拽） | Authoring.vue:198-212（draggable） | ◐ 菜单式上移/下移（相邻 NNN 前缀交换）；拖拽挂账 | 46A |
| 导入单篇 TXT/MD 并入当前书 | Authoring.vue:8322-8350 | ✅ 标题解析→NNN 顺延（含卷子目录下钻）→NNN-标题.md | 46B |
| 导出当前章/整本 | Authoring.vue:7964-7999 | ✅ 单篇（26）＋整本聚合 txt/doc（46B）；doc=HTML 包 | 26/46B |
| 导入整目录成新项目 | ImportSection | ✅（语义同老线「导入书稿」） | 16 |
| 导出章节分镜 | Authoring.vue:8001-8057 | ❌ 归 M4 素材/分镜域 | — |
| 素材收件箱（插入正文/转素材/入世界书） | Authoring.vue:3384-3392 | ❌ 归 M4（素材域） | — |
| 历史快照/diff/恢复 | — | ✅ 独立 git-dir（批次14 起），白名单 12 目录全 | 14/40 |
| 备份恢复 | — | ✅ 目录复制＋manifest | 18 |

## C. Agent/协议面（v3 标杆口径）

| 能力 | 现状 | 落点 |
|---|---|---|
| 工具注册制（声明∩实现，撞名拒装） | ✅ 8 把自有工具进聚合面（工具面 39） | 1-46A |
| 写族闸（落点表＋提案轨 review/auto/blocked） | ✅ 含外部 MCP 启发式＋审计环 | 4/45 |
| 提案审阅/采纳 | ✅（15 起；46A 后未审提案保护两轨通拦） | 15/46A |
| agentMd 进信封 | ✅（12 载体每块） | 42 |
| 形态五态（dock/split/overlay/fullscreen/immersive） | ✅ novel 全声明 | 35/45 |
| 每插件设置命名空间＋通用渲染器 | ✅ settingsStore＋CarrierSettingsGeneric；novel.writing 应用级待收编 | 45 |
| 项目事件总线＋150ms 合并刷新 | ✅ | 37/39 |
| 解注册（禁用＝关 pane＋清工作区＋服务收掉） | ✅ 接线完成（disposeOwner 生产路径暂零命中） | 45 |
| 商业化声明位（license 牌） | ❌ 挂账（作者裁「声明位＋展示」后另批） | — |

## 结论

- **标杆1 达成**：作者每天用的写作核心（A 组除 PM 系）与章节文件管理（B 组除 M4 域）全绿，且每一只手都过 v3 协议面（注册/闸/提案/信封/形态）。
- **挂账清单**（都不挡标杆结论）：PM 块编辑器系、校对批次会话、拖拽排序、M4 素材域（分镜导出/收件箱/生图归标杆2）、商业化声明位、v3.1 跨板授权。
