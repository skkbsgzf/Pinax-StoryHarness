# OpenStory 开发规划 v1（总体路线 · 2026-11-14）

> 定位：**跑在浏览器 / DSH 里的小说工作台**——OpenDesign 形态的小说版。
> 已有 v1 模板：`D:\Pinax-e2e\openstory\index.html`（作者已验收前端方向）。
> 核心原则（作者 2026-11-14 确立）：后端只提供**固定的本地文件绑定 API**；前端＝**模板化框架层＋模块化业务页**；运行时可插拔（先通用端点，后 DSH/CLI 嫁接）。

---

## 一、目标架构

```
┌─ 浏览器 / DSH webview ──────────────────────────┐
│  OpenStory 工作台（单页，无构建依赖）              │
│  框架层（模板化）：顶栏 / Agent 左列 / 页签 / 色板  │
│  业务页（模块化）：正文 / 条目 / wiki / 推演稿 /    │
│                    漫画 / 跑团 / 库 —— 每页一个模块 │
└──────────────┬───────────────────────────────┘
               │ HTTP（127.0.0.1，JSON + SSE）
┌──────────────▼───────────────────────────────┐
│  OpenStory daemon（轻 Node 服务）                 │
│  ├ 静态托管工作台本体                              │
│  ├ 文件绑定 API（唯一后端契约）                     │
│  │   库 / 条目 / 正文 / wiki —— 复用 S1/S2 模块    │
│  │   （factFileStore / writeFactFile / wikiDerive）│
│  └ Agent 通道（SSE 流式；运行时可插拔）             │
│      v1 OpenAI 兼容端点 → v2 DSH 原生 → v3 CLI     │
└───────────────────────────────────────────────┘
```

三条边界：
1. **daemon 是唯一有磁盘能力的层**（127.0.0.1 only，不监外网——对齐 OpenDesign sidecar）。
2. **契约先行**：API 的请求/响应定成纯契约模块（`contracts.mjs`），daemon 与工作台共享；改契约＝改一处。
3. **数据真源在磁盘**：库＝文件夹（`.pinax` 兼容形态），条目/正文/wiki 全是文件——OpenStory 不自建数据库。

---

## 二、功能路线（按批次，每批「界面上能看到新东西」）

### 第一批 · OS-1/2/3 数据真通（daemon＋核心读写）
| 项 | 内容 |
|---|---|
| OS-1 daemon | 轻 Node HTTP 服务：静态托管 `index.html` ＋ 文件绑定 API；127.0.0.1 only；启动即打印端口 |
| OS-2 契约 | `contracts.mjs`：全部端点的请求/响应形状＋错误码（照 @open-design/contracts 模式，纯数据零依赖） |
| OS-3 接线 | 库列表/条目列表/条目详情/正文读写全部换真数据（复用 S1 `factFileStore`＋S2 `writeFactFile`——纯 Node 模块直接 import）；v1 模板的 demo 数据退役 |

**验收**：打开工作台 → 看到真实库列表 → 打开大梦库 → 291 条拆解条目与真实正文上屏 → 改正文落盘。

### 第二批 · OS-4 Agent 通道（真对话）
| 项 | 内容 |
|---|---|
| 通道 | `POST /api/agent/chat`（SSE 流式）：运行时 v1＝OpenAI 兼容端点（模型/凭据在设置里配，凭据存本机 daemon 配置，不上工作台） |
| 能力 | 流式回答；**待确认卡**（Agent 产出正文片段→工作台采纳=写正文文件，走 writeFactFile 同款 revision 闸）；停止 |
| 左列 | 会话列表（会话=JSONL 存 daemon 侧，照 DSH 口径）；新会话/切换/重命名 |
| 边界 | v1 不做工具循环（Agent 只能读文件+产出文本+待确认写）——工具循环按需后续开 |

**验收**：在 Agent 面板真实提问 → 流式回答 → 待确认卡采纳后正文文件真实变化。

### 第三批 · OS-5/6 风格包＋wiki HTML
| 项 | 内容 |
|---|---|
| OS-5 风格包 | 色板从「内置三套」变「目录加载」：`styles/` 下每包一个文件（token＋名称＋对标说明）；用户/社区可加；Agent 可生成 |
| OS-6 wiki HTML | `wikiDerive` 追加 HTML 输出；wiki 页签改 **iframe 装载派生 HTML**（沙箱）——Vue 五页签退役为对照 |
| 顺带 | 看板栅格令牌跟随风格包（不同风格包可带不同栅格密度） |

**验收**：往 styles/ 丢一个新包文件 → 色板出现第四套 → 切换全屏生效。wiki 页签显示派生 HTML。

### 第四批 · OS-7 库管理写操作
| 项 | 内容 |
|---|---|
| 新建库 | 写 API：建目录＋`.pinax/project.json`＋标准目录骨架（复用 createProject 逻辑） |
| 导入 | 现有导入流逻辑（四步：位置→主模块→选稿→预览）搬到 OpenStory 整页 |
| 打开失败修复 | A-5 四类失败人话＋修复入口（空目录→新建／有稿→导入／缺主模块→去选） |

**验收**：全程无命令行建库/导库/开库。

### 第五批 · OS-8 业务页扩展（按 DSH 8 板原型交互规格）
| 页 | 内容 |
|---|---|
| 推演稿 | 前提/变量/分支三段；推演产出经待确认卡落正文 |
| 漫画 | 漫画页 index＋canvas/records（Toonflow/ComfyUI 面板经 services 通道挂） |
| 跑团（体验） | 体验会话 index＋runner/场景中心 |
| 大纲/素材/设定与资料 | 按载体清单逐页补 |

**验收**：载体横排点哪个板，业务页就出哪个板的完整工作面。

---

## 三、Agent 运行时可插拔（路线图，v1 先不做）

| 阶段 | 运行时 | 说明 |
|---|---|---|
| v1 | OpenAI 兼容端点 | 通用；作者任意 key 即可用 |
| v2 | **DSH 原生** | DSH Desktop 在 127.0.0.1:9230 有 inspector；对接其会话/流式协议（已探明端口，协议细节待逆向） |
| v3 | CLI 嫁接 | CodeBuddy/Claude/Qoder CLI（派单管线已验证三家进程接法；node-pty 同 OpenDesign sidecar） |
| v4 | 多运行时并存 | 不同会话绑不同运行时；运行时选择器 UI |

---

## 四、与 Pinax 主仓的关系

- OpenStory 的 daemon **直接复用** Pinax-next 的 S1/S2 模块（factFileStore/writeFactFile/wikiDerive——纯 Node，零改动 import）。
- 两边是**同一契约的两个消费者**：Pinax Electron 壳走 IPC，OpenStory daemon 走 HTTP。
- Pinax 主仓继续按 P 系迭代（Electron 深度形态），OpenStory 按 OS 系迭代（浏览器轻形态）——**同一份文件资产，两个壳**。
- 模块清单（ carriers）保持同源：两边都读同一份载体/模块定义。

---

## 五、风险与边界

- **凭据安全**：模型 key 只存 daemon 侧本机配置；工作台/网络层永不接触。
- **127.0.0.1 only**：daemon 不监听外网（对齐 OpenDesign sidecar）；远程访问= DSH Desktop 的隧道机制（frp 已有先例）另议。
- **Windows 路径**：全部经 daemon 的路径安全化（S2 已有路径逃逸拒收）。
- **v1 模板的技术债**：index.html 单文件会随功能长大——第二批起拆 `app.js`/`views/*.js`（daemon 静态托管多文件，无构建依赖不变）。
- **OpenDesign 协议细节**（agui-adapter 的流式帧格式）未逆向完——v2 DSH 原生对接时补。

---

## 六、完成定义（每批通用）

- 界面上能看到新东西；demo 数据退役一批、真数据上位一批。
- daemon API 变更必须先改 `contracts.mjs` 再改实现（契约先行）。
- 每批结束：真窗截图＋逐屏讲解（截图规矩）＋ daemon API 用 curl 级证据。
