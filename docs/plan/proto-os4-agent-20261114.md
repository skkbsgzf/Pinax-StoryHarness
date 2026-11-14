# 工单 OS-4 · Agent 通道接真（会话 JSONL＋流式对话＋待确认卡采纳）

> 规划总纲：`docs/plan/openstory-roadmap-20261114.md` 第二批（本文是执行合同）。
> 前一批：`docs/plan/proto-os1-daemon-20261114.md`（OS-1/2/3 daemon＋契约＋真数据，已交付）。
> 执行方式（作者 2026-11-14 指示）：**不外派 CLI，仓内直写**。

## 0. 硬约束

1. `npm run verify:next` EXIT=0 五段全绿（openstory/** 不进 Pinax 门禁计数）。
2. daemon 只绑 127.0.0.1；一切文件访问仍过 root 白名单＋路径逃逸拒收。
3. 零新 npm 依赖；`next/kernel/**`、`next/fact/**`、`next/shell/**` 一字不改。
4. 契约先行：先改 `contracts.mjs`，再改 daemon 与工作台。
5. 凭据红线：模型 key 只存 daemon 侧本机配置，**任何响应都不回显完整 key**（只给尾号掩码）。
6. 不伪造回答：上游不可达/非 2xx/中断，一律如实报，写进会话的都标 `partial` 或报错帧。

## 1. 契约新增（10 端点，错误码＋2）

| 端点 | 请求 | 成功响应 |
|---|---|---|
| `GET /api/agent/config` | — | `{ok, configured, endpoint?, model?, apiKeyMasked?, configPath}`（**key 永不回显**） |
| `PUT /api/agent/config` | `{endpoint, model?, apiKey?}` | 同上（apiKey 缺省＝保留原值；空串＝清除） |
| `GET /api/agent/sessions` | `?root=` | `{ok, sessions:[{id,title,createdAt,updatedAt,messageCount}]}` |
| `POST /api/agent/sessions` | `{root, title?}` | `{ok, session}` |
| `GET /api/agent/session` | `?root=&id=` | `{ok, session, items:[msg|card]}` |
| `POST /api/agent/session/rename` | `{root, id, title}` | `{ok, session}` |
| `DELETE /api/agent/session` | `?root=&id=` | `{ok}` |
| `POST /api/agent/chat` | `{root, sessionId?, content, model?}` | **SSE**：`data:{"type":"delta","text"}` → `{"type":"done","sessionId","chars"}`；错误帧 `{"type":"error","error":{code,message}}` |
| `POST /api/agent/cards` | `{root, sessionId, file, text, note?}` | `{ok, card:{id,state:'open',file,text,note?,chars,snapshot,createdAt}}` |
| `POST /api/agent/cards/adopt` | `{root, sessionId, id}` | `{ok, card, chars, savedAt, backup?}`；正文在卡创建后被改过 → `REVISION_MISMATCH` |
| `POST /api/agent/cards/reject` | `{root, sessionId, id}` | `{ok, card}` |

- 新错误码：`AGENT_NOT_CONFIGURED`（没配端点就发对话，400）。
- `agentChat` 请求形状变更：v1 透传版里的 `messages[]/endpoint/apiKey` 全部退役——
  消息由 daemon 从会话 JSONL 组装，endpoint/key 只来自 daemon 本机配置（请求里的 `model?`
  保留为单次覆盖）。旧形状不做兼容（v1 内部软件，两端同仓同改）。

## 2. agentStore（`openstory/agentStore.mjs`，新建）

- **配置**：`%LOCALAPPDATA%/PinaxNext/openstory/agent-config.json`
  （`{endpoint, model, apiKey, updatedAt}`，原子写）。坏档/缺档＝未配置＋warning，不拦启动。
- **会话**：`…/openstory/sessions/<sha1(root)16>-<库名>/s-*.jsonl`，照 DSH 口径按行追加：
  - 首行 `{t:'meta', id, title, createdAt}`；消息行 `{t:'msg', id, role, content, at, partial?}`；
    卡行 `{t:'card', id, state, file, text, note?, chars, snapshot:{exists,chars,sha256}, createdAt, resolvedAt?, backup?}`。
  - 重命名/改卡状态＝整文件重写（tmp＋rename）；删除＝unlink。会话 id 白名单 `[\w-]+`，防路径逃逸。
- **快照闸（writeFactFile 同款思路，正文版）**：卡创建时对目标正文文件取
  `{exists, chars, sha256}`；采纳时重读比对，不一致 → `REVISION_MISMATCH`（409）。
  与 S2 的 revision 门是同一件事的轻量版：OpenStory 与 Electron 同写时宁可拒绝也不静默覆盖。
- **上游 SSE 解析**：`createSseDeltaParser(onDelta)`——逐行剥 `data:`，取
  `choices[0].delta.content`（非流式 JSON 兜底取 `choices[0].message.content`）；
  `[DONE]`/坏行丢弃不伪造。供 daemon 转发与测试复用。

## 3. daemon 接线（`openstory/daemon.mjs`）

- 新路由 10 条；`agentChat` 重写：
  1. 校验 root（白名单）＋ content；没配端点 → `AGENT_NOT_CONFIGURED`。
  2. `sessionId` 缺省＝新建会话（标题取 content 前 24 字）。
  3. 用户消息落 JSONL → 组装上游消息：system（库内写作助手守则）＋最近 24 条、
     总长 48000 字封顶的会话历史 → 上游 `stream:true`。
  4. 上游 delta → 工作台 delta 帧（边收边转）；结束 → 助手消息落 JSONL → `done` 帧。
  5. 工作台断开（停止按钮）→ abort 上游，已收到的部分以 `partial:true` 落档，不装完整。
- 待确认卡：创建时快照、采纳时比对＋复用 `PUT /api/chapter` 同一条原子写＋`.history`
  备份路径（抽公共函数 `writeChapterWithBackup`，两条路由一个实现）。
- 边界（诚实标注）：v1 无工具循环——模型看不到库文件，除非作者粘贴；
  system prompt 只写明这一点与「产出正文要给完整可粘贴文本」。

## 4. 工作台（`openstory/public/`）

- Agent 左列从空态转正：会话条（新会话/切换/双击重命名/删除）、消息流（用户/助手气泡）、
  流式渲染＋停止钮、助手消息「转为待确认卡」、卡块（采纳/拒绝/已写入/已拒绝/修订冲突人话）。
- 设置弹层：endpoint/model/apiKey（password），存后只显示掩码；未配置时 composer 摆提示不摆死。
- 全部走已有 skin token，无新依赖。

## 5. 验收

- [ ] `node --test openstory/test/agent.test.mjs`：配置掩码/会话 CRUD/快照闸/解析器/端到端（夹具上游）≥ 14 例。
- [ ] 夹具上游（本机 http 服务发 SSE）端到端：提问 → delta 帧 → done 帧 → JSONL 落 user+assistant。
- [ ] 待确认卡：创建→采纳→正文真变＋`.history` 备份；中途改文件→`REVISION_MISMATCH`；路径逃逸拒收。
- [ ] 凭据：`GET /api/agent/config` 任何字段不含完整 key。
- [ ] 工作台截图（会话/流式/卡采纳三屏）＋逐屏讲解。
- [ ] `npm run verify:next` EXIT=0。

## 6. 边界（不做）

- 不做工具循环/文件读取工具；不做多运行时（v2 DSH 原生另单）；不做正文跨进程 revision 闸
  （快照闸只护「卡创建→采纳」窗口）；不做会话级并发锁（单作者单机假设）；不做 HTTPS/隧道。

## 7. 实施回填（2026-11-14）

### 7.1 落地文件（commit e56a81d）

```
openstory/contracts.mjs               改 · 8→18 端点；错误码＋AGENT_NOT_CONFIGURED；agentChat 请求形状换新
openstory/agentStore.mjs              新 · 凭据配置＋会话 JSONL＋快照闸＋SSE 解析＋消息组装（纯函数可测）
openstory/daemon.mjs                  改 · 10 条 agent 路由；agentChat 重写（组装→上游→帧转发→落档）；writeChapterWithBackup 抽公共
openstory/public/index.html           改 · Agent 左列转正＋弹层壳＋stop 键 hidden 修正
openstory/public/app.js               改 · 会话/流式/卡/设置全接线（+507 行）
openstory/test/agent.test.mjs         新 · 15 例（含两段 daemon 端到端·夹具上游）
openstory/test/contracts.test.mjs     改 · 端点数与 agentChat 形状断言更新（22 例）
docs/STATUS.md                        改 · OS-4 记账
```

### 7.2 curl 级证据（daemon :8821，夹具上游 `D:\Pinax-e2e\os4-shots\evidence.md`）

- `GET /api/agent/config` → `{configured:true, apiKeyMasked:"••••0000"}`——响应全丈量无完整 key。
- `POST /api/agent/chat` → SSE 帧序 `start → delta×6 → done`（chars=63 与 delta 拼接等长）；
  上游收到的 `authorization: Bearer sk-…`、messages[0]=system、末条=当前用户消息。
- `POST /api/agent/cards`（新文件）→ 快照 `exists:false`；采纳 200（写入＋备份）；
  同卡再采纳 400 `INVALID_ENTRY`；文件被改后采纳 409 `REVISION_MISMATCH`（expected/actual 双 sha256）；
  `../secret.txt` 建卡 403 `PATH_ESCAPE`。
- `GET/POST/DELETE /api/agent/sessions…` → 建会话标题取首句；messageCount 记账；删除即清。

### 7.3 测试与门禁

```
$ node --test openstory/test/contracts.test.mjs openstory/test/agent.test.mjs
ℹ tests 37 / pass 36 / fail 0（1 例环境跳过）

$ npm run verify:next
EXIT=0：验收 42/42 · 内核 1390（1389 过 1 跳）· vitest 界面 309/309 · eslint 0 · 打包全过
（openstory/** 不在 next/ 下，不进门禁计数——确认计数未涨）
```

五屏截图（`D:\Pinax-e2e\os4-shots\shots\`）：①对话（会话条＋流式完成＋转卡入口）②转卡弹层
（快照闸人话＋内容可改）③卡 open（采纳/拒绝＋快照口径）④已写入正文 ⑤正文页签 39 字真落盘。
演示对话的上游是**本机夹具 SSE 端点**（脚本内起、回答带「夹具上游」尾标），不碰任何真实模型端点；
作者在设置里填自己的 OpenAI 兼容端点即接真模型。

### 7.4 limitations

1. 快照闸只护「卡创建→采纳」窗口；OpenStory 与 Electron 直接同写正文仍只有 .history 粗保护。
2. v1 无工具循环：模型读不到库文件（system prompt 明示），上下文靠作者粘贴。
3. 无会话级并发锁（单作者单机假设）；重命名/改卡状态＝整文件重写（会话小，量级无碍）。
4. 上游只认 OpenAI 兼容 `/chat/completions`（含非流式 JSON 兜底）；DSH 原生运行时＝路线图 v2 另单。
5. 设置弹层里清空 key 需填空串＋保存（缺省＝保留）；endpoint 清空即回到未配置。
6. 卡文本上限随请求体上限（16MB），未单独设卡；UI 侧 textarea 无字数闸。
