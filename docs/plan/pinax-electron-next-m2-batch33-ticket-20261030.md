# 批次33 执行工单：IDE 化——文档头归一＋索引窗净化（2026-10-30）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash），经 workflow 编排派发
> 调度方：Zcode（验收、门禁、提交）
> 作者指令（原话）：「主要内容你还是放在一个框里面，而且这个蓝框也很丑。实际上作为一个 doc 来说，就是标题栏放一个标题，其他东西就不用放了，最多在底部放一些提示。」「左侧部分：正常的 IDE 是怎么设计的，你就怎么设计呗，这个不只是正文这个点，其他几个点也是一样的。」

## 0. 现状锚点（先读再动手）

- **蓝框**：`next-shell.css` `.editor-area:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px }`——写作面聚焦即套蓝圈。
- **双层头**：CarrierPaneHost 编辑面头部＝`pane-sub`（「正文」）＋`演示之书 · novel` 一层，再叠「章节名＋路径·版·字」一行。条目/资料/剧本阅读面同构（标题＋meta 行＋编辑钮）。
- **左栏**（IndexWindow，全部树同构）：常驻「新章节标题＋新建」输入排；行＝`{{ index + 1 }}. 标题`＋常驻「第 N 版」meta＋常驻历史 icon（章节 138 行 chapterNumber、outline 389 行数字前缀；330/454/585/613/641 行的常驻 meta）。
- **先例**：批次31 的大纲区头「＋」hover 显形（outline-append-node）与右键菜单；批次31 的 `.doc-title`/`.doc-field` 文档原语。

## 1. 任务一：编辑面文档头归一（CarrierPaneHost 全部 viewKind）

- **头部只剩一行标题**：`.doc-title` 展示体（章节名／条目名／资料名／剧本名／规则名）。「正文／演示之书 · novel」面板头整块删除——载体身份在竖条上，项目名在标题栏，都不该在文档头里再念一遍。
- **meta 沉底**：路径 · 第 N 版 · N 字（条目加 关键词）收成正文之下的**一行底部 hint**（`.doc-meta-hint`，muted 小字，token 刻度）。头部不放 meta。
- **蓝框拆除**：`.editor-area:focus-visible` 的 outline 规则删除（含 -offset）；写作面的焦点指示就是光标。视觉合同补 needle：`.editor-area` 样式块不得出现 `outline:`。
- **编辑钮／取消**：维持头部右端 quiet（现状），不新增常驻件。
- **提案审阅**：两版对照豁免去框，但头部同样归一（一行标题「提案审阅 · 文件名」，meta 沉底）。

## 2. 任务二：索引窗 IDE 化（IndexWindow，七棵树全部适用）

- **行＝名字**：删 `{{ index + 1 }}. ` 数字前缀（章节与大纲都要；顺序由文件名与排序自明）；「第 N 版」「N 字」从可见 meta 改为**行 title tooltip**（`文件名 · 第 N 版 · N 字`）。
- **动作 hover 显形**：历史 icon 从常驻改 hover 显形（CSS opacity 0→1，`prefers-reduced-motion` 不动画；键盘 focus 同样显形——无鼠标可达）。
- **新建改区头 ＋**：常驻「新标题＋新建」输入排全拆；区头右侧一枚 hover 显形「＋」（照 outline-append-node 先例），点击**变临时行内输入**：Enter 建档、Esc／失焦取消不建档。章节/剧本/资料/规则/条目五棵树统一此交互（outline 已有，补一致样式即可）。
- **区头保留**：`workspace-nav-section` 已是安静小字，不动。

## 3. 断言（进 visual-contract / shell-ui）

- `.editor-area` 样式块无 `outline:` needle（反转现有规则若有）；
- 模板无 `{{ index + 1 }}. ` 数字前缀 needle；「第 {{ item.revision }} 版」不再作为可见 meta（进 title 属性）；
- 「新章节标题」常驻输入不存在；区头 ＋ → 临时输入 → Enter 建档 → Esc 取消，用例各一条；
- 编辑面：`.doc-title` 在场、`.doc-meta-hint` 在场、`pane-sub` 双层头不在场。

**允许文件**：`next/shell/CarrierPaneHost.vue`、`next/shell/IndexWindow.vue`、`next/shell/styles/next-shell.css`、`next/shell/useBoardData.mjs`（新建动作接线如需）、`next/tests/shell-ui.spec.mjs`、`next/tests/carrier-pane.spec.mjs`、`next/tests/visual-contract.test.mjs`。**不许改**：内核/工具/fileService、package.json、AssistantDialog（对话面板豁免）。

## 4. 门禁

`npm run verify:next` 五段全绿（基线：内核 402、界面 107、打包 a–l）。

## 5. 边界

- **标题不可编辑**（改名＝文件改名，行内重命名后续批）；新建仍走「先起名再建档」。
- 悬浮钮（工单C）、树行右键菜单（批次31）、表/列切换（批次28）不动。
- P18 合同继续有效并叠加：本批是 P18 的「头归一」细则化。
- 只动位置与样式，不删功能：被拆的常驻输入/ meta / 历史入口，能力必须在新位置可达——评审员按此逐条对照。
- 新 CSS 全走 token；执行方不 commit/push、不启停 electron。
