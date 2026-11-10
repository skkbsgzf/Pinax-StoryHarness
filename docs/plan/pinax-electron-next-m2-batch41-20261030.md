# 批次41 · 正文写作动作（续写／改写／扩写／压缩／润色）

> 2026-10-30。承接批次40（M4／M5 记录型载体）。作者口径：「继续推功能，对齐前端」。
> 老前端写作页最核心的那层交互——选中一段让模型改写、或者让它接着写下去——此前在 Next 里完全没有。

## 一、这批判定了什么

老版 `src/pages/Writing.vue` 的写作动作是「界面收集选区 → 服务组提示词 → 模型面」。搬到 Next 时保持这条分工，但把两端都收窄：

1. **动作是闭集**。五个动作写在一张表里（`next/shell/writingActions.mjs`），未登记的动作一律拒，不做近义兜底。
2. **提示词只在内核侧拼**。渲染层递上来的是 `{ action, text, selection, instruction }`，不是自由提示词。
   通道因此不是一条通用模型管道——这是与本仓「渲染层碰不到实现」的口径一致的。
3. **结果不自动落进正文**。先摆出来，作者按「插入光标处／替换选中段」才动稿子。老版就是这个顺序。

## 二、交付

| 文件 | 内容 |
|---|---|
| `next/shell/writingActions.mjs` | 新增。动作闭集、请求校验、选区归一、提示词组装、结果清洗与落位。零依赖纯函数，主进程与渲染层共用同一份。 |
| `next/runtime/writingComplete.mjs` | 新增。`createWritingComplete({ complete, timeoutMs })`：校验 → 组提示词 → 调模型 → 归一结果。默认 `forwardComplete`，失败一律 `PINAX_IO_FAILED` 并带原因，不编字。 |
| `next/shell/ipcContract.mjs` | 新增通道 `pinax:agent:runtime:complete`；载荷只认四个字段；没注入服务／没打开项目各自如实报缺。 |
| `next/shell/main.mjs` | 注入 `writingComplete`（90 秒超时，与老前端一个量级）。 |
| `next/shell/useBoardData.mjs` | 新增 `draftSelection`（选区）、`writingBusy/writingError/writingResult`、`setDraftSelection/requestWriting/applyWriting/discardWriting`；换章作废在飞的请求；生成期间改过稿就拒落位。 |
| `next/shell/CarrierPaneHost.vue` | 正文面加动作带（聚焦浮现）、额外要求输入、结果预览与「插入／替换／丢弃」。按钮 `mousedown.prevent`，不抢焦点。 |
| `next/shell/styles/next-shell.css` | `.nx-writing-*` 一族：贴在正文下方，不画框（P18 第 2 条），结果面板只一条上细线。 |

## 三、两个设计取舍

**续写落在哪儿。** 作者还没点进正文时，`draftSelection` 是 `null`，续写落在文末。这是刻意的：如果初值写成 `{0,0}`，第一次续写会把新段落插到第一章第一句前面——这个坑在自测里真踩到了（见五.2）。

**生成期间改了稿怎么办。** 请求发出时记下 `anchor`（当时的正文＋选区）。落位按 anchor 算；如果此刻草稿与 anchor 不一致，直接拒并提示「位置对不上了」，让作者复制走或重来。不做「按新位置硬塞」——那等于把一段文字插到作者没想放的地方。

## 四、门禁

- `node next/testing/acceptance.mjs`：**20/20**
- `node --test next/tests/*.test.mjs`：**447/447**（＋7 条：动作闭集、校验、选区归一、提示词、落位、主进程服务、通道）
- `vitest next/tests/*.spec.mjs`：**138/138**（＋5 条：动作带浮现、续写插入、改写替换、生成期改稿拒绝、模型面失败如实摊开）
- `eslint next`：**0**
- 打包门禁全过：main 1044.5 kB / shell 1784.8 kB / renderer 918.9 kB / preload 3.8 kB

## 五、踩坑账

1. **`next/shell/main.mjs` 不能直接 import `server/`**。写成 `import { forwardComplete } from '../../server/services/kitModelGateway.js'` 后，「渲染侧依赖必须薄」那条门禁当场红（两条：410 与 636）。收口方式是把这个旧轨依赖挪进 `next/runtime/writingComplete.mjs`——与 `toolTurn.mjs` 同一口径，外壳源码干净。
2. **选区初值不能是 `{0,0}`**。`{0,0}` 的意思是「选在开头且是空选区」，不是「还没选」。用 `null` 表示未知，落位时才回落到文末。这是用测试钉住的：`completeCalls[0].selection` 必须等于文末位置。
3. **`shell-contract` 会扫 `main.mjs` 源码文本**，不只是 import 图。改完必须同时过「偏好接到网关」那条断言（它匹配 `\.\.\/\.\.\/server\/`），否则两次红。

## 六、边界（如实记账）

- **只有正文面接了**。剧本面（`script-editor`）、记录面（`records-editor`）、条目正文都没有动作带。它们的写入面与章节不同（剧本是整份文档、记录是 JSON 字段），要接得各写一份落位语义，本批没做。
- **没有流式输出**。一次请求一次返回，生成期只有「正在写…」；老版的逐字流式没搬。
- **没有撤销栈**。落位后靠 textarea 的原生 Ctrl+Z；跨保存点无法回退（历史引擎能看旧版，但界面没接「从历史恢复」）。
- **选区依赖界面上报**。程序化改正文（比如从提案采纳）之后选区不会自动跟随，作者需要点一下正文；`normalizeSelection` 只负责把越界值钳住。
- **模型面未真机实测**。本批门禁全部用假 `complete`；真任务面要等下一次带凭据的 Electron 手测（与批次5 同一套隔离端口做法）。
