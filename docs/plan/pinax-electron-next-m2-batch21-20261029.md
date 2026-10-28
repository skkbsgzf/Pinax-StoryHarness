# Pinax-Electron-Next M2 批次21：settings 声明接通＋保存统一收尾＋条目元数据编辑（2026-10-29）

> 执行：workflow coder（DeepSeek flash）三单全绿；调度方验收（独立复跑 215/215＋72/72、真窗口截图 46/47）。
> 工单来源：批次20 最大遗留（载体 settings 声明未接通）＋批次19 口径分叉收尾＋世界书条目编辑器补全。

## 1. 交付

**A 载体 settings 声明接通（P14 机制完成）**
- `carrierManifest.mjs` 白名单产物加 settings 透传（新 validateSettings：形状 [{id,title}]，id 命名空间校验、title ≤40 字、同载体 id 唯一、多写字段拒——非法整份清单拒装；缺省 []）。
- `shellView` 的 carriers 映射透出 settings。
- `SettingsModal` 载体目录改读真声明：有声明的载体逐条出目录项（title 照声明、节 id `carrier:<载体id>:<声明id>` 保证跨载体唯一），空声明载体不出——**按载体标题伪造的占位节删除**。
- novel manifest 加真声明 `[{ id: 'novel.writing', title: '写作偏好' }]`（内容组件后续批）；manifest-contract 补 8 用例。
- 截图 `png/46`：目录出现「应用/项目/文档/载体」分组，载体组下「写作偏好」真声明项可见。

**B 编辑面保存交互统一收尾（批次19 口径分叉清零）**
- 大纲/条目编辑面补 `.nx-save-chip`（与四编辑面同一 chip 状态机，STALE 恢复路径齐）；`reloadFromChip` 补两条路径。
- `kernelWriteGuard` 拒绝提示精确化：ownedTools 过滤为「该目录的载体自有**写**工具」（只读的 rule_list、写其他目录的工具不再混入）；拒绝 code/details/判定顺序一字未动；新增 `CARRIER_WRITE_CLASS` 落点表与 `guardCarrierWriteGaps` 门禁对账（漏点名/多余项/目录不归该载体三类）。
- SettingsModal 头注同步（焦点陷阱已落地，取代批次13 说法）。
- 测试：kernel-write-guard 加提示不点名断言＋落点表对账 9 条；carrier-pane 补大纲/条目双通道五段用例。

**C 世界书条目元数据编辑**
- `pinax_worldbook_save` 加可选 `meta`（keys/tags/summary）：契约条目用 meta 覆盖解析出的对应字段再序列化（其余 frontmatter 原样），裸 md 与新建带 meta 即 INVALID_INPUT（修复路径文案）；非法值拒且版本不动。
- 条目编辑态：正文之上「关键词」「标签」两栏（逗号分隔、中英文逗号都切、留空=清空该字段——与 schema「传 [] 清空」一致）；阅读态 meta 行展示 keys。
- 样式全 token（.nx-field 词汇），无新按钮。

## 2. 门禁

调度方独立复跑：验收 16/16、内核单测 **215/215**、外壳界面测 **72/72**、eslint 0 警、打包 a–k 全过（内核 bundle 918.4 kB）。工单侧每单门禁一次实跑全绿。

## 3. 截图

`png/46-light-settings-declared.png`（统一二级页：搜索框＋应用/项目/文档/载体四组目录＋载体组真声明「写作偏好」）、`47-light-declared-section.png`（声明节空态）。

## 4. 诚实边界

- 各载体设置节的具体内容组件未做（机制已通，点开为空态；novel「写作偏好」是占位声明）。
- settings 声明未强制 id 前缀等于载体 id（全局唯一由设置页拼前缀保证）——如需机械前缀约束另批。
- summary 只在工具层可改，界面无摘要输入框（工单只点名关键词/标签两栏）。
- 阅读态只展示 keys 不展示 tags；relations/id/type 编辑不做（关系图域/稳定标识）。
- 「meta 非法＋修订号过期」先报 INVALID_INPUT（形状拒绝在读盘前）——STALE 只在写盘时判。
- kernelWriteGuard 的 ownedTools 提示在「目录无主人」路径仍可能列全（有主人的拒绝路径已精确）。
- 输入框留空＝清空该字段（与 schema 一致），不是「不改」——界面上已用文案说明，但作者要区分「清空」与「不改」时需注意。
