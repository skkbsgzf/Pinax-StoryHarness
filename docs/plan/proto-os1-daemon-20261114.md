# 工单 OS-1/2/3 · OpenStory daemon＋契约＋真数据接线（OpenStory 开发规划第一批）

> 规划总纲：`docs/plan/openstory-roadmap-20261114.md`（本文是第一批执行合同）
> v1 模板：`D:\Pinax-e2e\openstory\index.html`（作者已验收前端方向；本单把它迁入仓库并接真数据）
> 复用地基：`next/kernel/factFileStore.mjs`（S1）／`writeFactFile`（S2）／`next/kernel/wikiDerive.mjs`（S4）——纯 Node 模块，daemon 直接 import，**一字不改**。

## 0. 硬约束

1. `npm run verify:next` EXIT=0 五段全绿。
2. **daemon 只监听 127.0.0.1**；路径全部过安全化（root 白名单＝库清单内的路径；文件路径 resolve 后必须落在 root 内——照 S2 的路径逃逸拒收写法）。
3. **零新 npm 依赖**（Node 内置 http/fs/crypto 够用）；`next/fact/**`、`next/kernel/**` 既有模块一字不改。
4. 契约先行：API 形状先落 `contracts.mjs`（纯数据，daemon 与工作台共享），再写实现。
5. 不执行 git；不启停 electron（daemon 是独立进程，与 Electron 互不影响）。
6. 不执行 git；本单不许改 `next/shell/**`（OpenStory 与 Electron 壳是两个消费者，互不碰）。

## 1. OS-1 · daemon（`openstory/daemon.mjs`，新建）

- Node 内置 `http` 服务：**只绑 127.0.0.1**，端口默认 8807（`--port` 可覆盖），启动打印 `OpenStory daemon → http://127.0.0.1:8807`。
- 静态托管：`openstory/public/`（index.html＋app.js 等多文件，v1 的单文件拆分随本单落）。
- 库清单来源：读 `%LOCALAPPDATA%/PinaxNext/next-preferences.json` 的 `recentProjects`（`{path,name,kind,count,at}`）——**与 Electron 库管理器同一份数据**，作者的真实库立刻上屏；文件不存在/损坏按空清单＋warning。
- 启动参数：`--root=<库路径>` 可选（指定时跳过库选择直接进该库工作台）。

## 2. OS-2 · 契约（`openstory/contracts.mjs`，新建，纯数据零依赖）

每端点一组：`{ method, path, request, response, errors }`（形状描述对象，供 daemon 校验与工作台参考）。错误码词表：`NO_LIBRARY`（root 不在清单）、`PATH_ESCAPE`、`NOT_FOUND`、`INVALID_ENTRY`、`REVISION_MISMATCH`、`WRITE_PROTOCOL_*`（透传 S2）。

| 端点 | 请求 | 成功响应 |
|---|---|---|
| `GET /api/libraries` | — | `{ok, libraries:[{path,name,kind,count,at}], warnings[]}` |
| `GET /api/entries` | `?root=&layer=&offset=&limit=` | `{ok, entries[], total, warnings[]}`（fact:list 同构，经 factFileStore） |
| `GET /api/entry` | `?root=&id=` | `{ok, entry, revision}` |
| `GET /api/chapter` | `?root=&file=` | `{ok, name, text, chars}`（正文 md 原文读） |
| `PUT /api/chapter` | `{root, file, text}` | `{ok, chars, savedAt}`（原子写：tmp＋rename；**不做 revision 闸**——v1 边界见 §5） |
| `GET /api/wiki` | `?root=&bookId=` | `{ok, wiki, derivedFrom}`（readFactWiki 两代兼容） |
| `POST /api/wiki/derive` | `{root, bookId, operationId}` | `{ok, wiki, derivedFrom}`（wikiDerive＋writeFactFile 落 wiki.json） |
| `POST /api/agent/chat` | `{messages[], model?, endpoint?, apiKey?}` | SSE 流式（v1 OpenAI 兼容透传） |

- 安全：`root` 必须命中库清单（recentProjects 的 path）；文件路径 resolve 后必须落在 root 内（`PATH_ESCAPE` 拒收——照 S2 写法）。
- `PUT /api/chapter` 写前自动备份：原内容写 `<file>.bak-<时间戳>`（同目录 `.history/` 隐藏目录）——OpenStory 与 Electron 同时开时的粗保护，注释写明边界。

## 3. OS-3 · 工作台接线（`openstory/public/`，index.html 迁入＋拆分）

- v1 模板迁入：`index.html`（壳）＋`app.js`（数据与路由，从内联 script 拆出）。**不再单文件**——daemon 静态托管多文件（规划 §五 已预告）。
- 接线：
  - 库列表 → `GET /api/libraries`（v1 内置 5 张假卡退役）。
  - 点库卡 → 记 `currentRoot` → 世界书板条目走 `GET /api/entries`（291 条真实拆解条目上屏，S4 的 wiki 页签同源）；正文页签走 `GET /api/chapter`。
  - 正文编辑：textarea 加「保存」→ `PUT /api/chapter` → 「已保存」chip。
- 无库/库读取失败：空态「还没有库，去 Pinax 里打开一个」＋打开 `next-preferences.json` 路径提示（不摆死钮）。

## 4. 验收

- [ ] `node openstory/daemon.mjs` → curl 证据：`/api/libraries` 返回真实库清单；`/api/entries?root=<夹具库>` 返回 291 条；`/api/chapter` 读写往返；路径逃逸/未登记 root 被拒。
- [ ] 夹具库：临时目录＋`.pinax`＋拷贝一份真实拆解 JSON（env `PINAX_OS_FIXTURE`，不写死绝对路径）。
- [ ] 工作台真窗截图（库列表/条目/正文三屏）由调度方实拍。
- [ ] `verify:next` EXIT=0（openstory/** 不进 Pinax 门禁计数——新目录不在 `next/` 下，确认 lint/打包计数不涨）。
- [ ] 契约/daemon 纯函数用例 ≥10（形状校验/路径安全/坏档容错）。

## 5. 允许改动的文件

```
openstory/daemon.mjs                         （新建，放仓库根 openstory/）
openstory/contracts.mjs                      （新建）
openstory/public/index.html                  （新建，自 v1 模板迁入改造）
openstory/public/app.js                      （新建）
openstory/test/contracts.test.mjs            （新建）
docs/plan/proto-os1-daemon-20261114.md       （本文）
D:/Pinax-e2e/openstory/**                    （v1 模板原样迁入仓库后原目录可留可删，注明）
```

## 6. 边界（不做）

- 不做 Agent 对话（OS-4 另单）；不做写 wiki（readFactWiki 已有，derive 通道本单挂上即可——S4 已实现，透传）。
- 不做正文 revision 闸（OpenStory 与 Electron 同时写同一库的冲突保护＝v1 边界，.bak 备份是粗保护；注释写明）。
- 不改 `next/shell/**`、`next/kernel/**`、`next/fact/**`。
- 不做 HTTPS/隧道/多用户。

## 7. 回填格式

同 P1；另附 curl 级 API 证据（至少 4 条端点）。

---

## 8. 实施回填（2026-11-14）

### 8.1 落地文件

```
openstory/daemon.mjs                  新建 · HTTP＋静态托管＋文件绑定 API（只绑 127.0.0.1）
openstory/contracts.mjs               新建 · 8 端点形状＋错误码＋零依赖纯函数校验
openstory/public/index.html           新建 · v1 壳迁入（样式内联，脚本拆出）
openstory/public/app.js               新建 · 库/条目/正文/wiki 真数据接线
openstory/test/contracts.test.mjs     新建 · 22 例（20 纯函数＋2 端点集成）
```

`D:/Pinax-e2e/openstory/**` 原模板保留未删；仓库内 `openstory/` 为唯一维护点。
`next/kernel/factFileStore.mjs`、`next/kernel/wikiDerive.mjs`、`next/fact/**`、`next/shell/**` 未改。

### 8.2 实现要点

- **启动**：`node openstory/daemon.mjs [--port=8807] [--root=<库路径>] [--preferences=<json>]`；
  打印 `OpenStory daemon → http://127.0.0.1:8807`。`--root` 会把该库补进 `/api/libraries`
  并作为 `defaultRoot`，工作台跳过库选择直接进该库。
- **库清单**：读 `%LOCALAPPDATA%/PinaxNext/next-preferences.json`；缺档/坏档/形状不对 → 空清单＋warning。
  真实记录只有 `path/name/at` 时补 `kind=未分类、count=0`；按路径去重，Windows 大小写与 8.3 短名
  经 `realpathSync.native` 归一。白名单＝库清单＋`--root` 显式授权。
- **路径安全**：绝对路径、`..`、空段、`.pinax/` 全部 `PATH_ESCAPE`；`path.relative` 复核落点。
- **正文写**：`tmp-<uuid>` ＋ `rename`；写前把原内容复制到同目录 `.history/<file>.bak-<时间戳>`；
  **不做 revision 闸**（v1 边界，注释写明）。
- **写协议码**：S2 的 `OPERATION_ID_REQUIRED / VALIDATION_FAILED / REVISION_MISMATCH / NOT_FOUND /
  INVALID_INPUT` 透传成 `WRITE_PROTOCOL_*`，未识别写失败统一 `WRITE_PROTOCOL_IO_FAILED`。
- **wiki**：读走 `store.wikiGet`（两代兼容）；派生走 `store.wikiDerive`（S4 `deriveWiki`＋S2 `writeFactFile`）。
- **工作台**：v1 假库卡/假条目/假 Agent 消息全部退役；库列表、条目（291 条、分层过滤、搜索、分页）、
  条目详情、正文读写、wiki 派生全部真数据；无库空态给 `next-preferences.json` 路径提示，不摆死钮。
- **契约扩展**：`/api/libraries` 增加可选 `preferencesPath`、`defaultRoot`；错误码增加
  `AGENT_UPSTREAM_ERROR`（SSE 上游不可达/非 2xx 如实报，不伪造回答）。

### 8.3 curl 级 API 证据（daemon 8807 · `--root` 指向临时夹具库）

夹具：`$TEMP/openstory-os1-fixture`＝`.pinax/` ＋ 从 `D:/Pinax-e2e/s4-shots/夹具库/拆解/` 拷贝的
`7410224516963503166.json`（291 条）与兄弟 `*.wiki.json` ＋ 一份 `正文/…__脱轨.txt`。

**① `GET /api/libraries`** — 真实作者库 + `--root` 授权库：

```json
{"ok":true,"libraries":[
  {"path":"D:\\Projects\\大梦","name":"大梦","kind":"未分类","count":0,"at":"2026-11-11T16:32:18.039Z"},
  {"path":"C:\\Users\\Administrator\\AppData\\Local\\Temp\\openstory-os1-fixture","name":"openstory-os1-fixture","kind":"未分类","count":0,"at":""}
],"warnings":[],"preferencesPath":"C:\\Users\\Administrator\\AppData\\Local\\PinaxNext\\next-preferences.json",
"defaultRoot":"C:\\Users\\Administrator\\AppData\\Local\\Temp\\openstory-os1-fixture"}
```

**② `GET /api/entries`** — 291 条，warnings 为空：

```json
{"ok":true,"total":291,
 "entries":[{"name":"第1章·正文/7410224516963503166__脱轨.txt·段1","layer":"plot","bookId":"7410224516963503166"}],
 "warnings":[]}
```

**③ `GET`→`PUT`→`GET /api/chapter`** — 读 53 字 → 写 41 字 → 再读回新内容，备份落盘：

```json
{"ok":true,"name":"7410224516963503166__脱轨.txt","text":"第1章 雨停之后\n\n雨到傍晚才停。...","chars":53}
{"ok":true,"chars":41,"savedAt":"2026-11-14T13:02:43.896Z","backup":"正文/.history/7410224516963503166__脱轨.txt.bak-2026-11-14T13-02-43-892Z"}
{"ok":true,"name":"7410224516963503166__脱轨.txt","text":"第1章 雨停之后（OpenStory 已保存）\n\n雨到傍晚才停。雾从水面漫上来。\n","chars":41}
```

**④ 路径逃逸 / 未登记 root** — 均 403：

```json
{"ok":false,"error":{"code":"PATH_ESCAPE","message":"路径不合法或越出库根：../../secret.txt"}}
{"ok":false,"error":{"code":"NO_LIBRARY","message":"root 不在库清单里：D:/不存在/openstory-nolib"}}
```

**⑤ `GET /api/wiki` / `POST /api/wiki/derive`**：

```json
{"ok":true,"derivedFrom":{"factRevision":1,"schema":"pinax-wiki-derived@1"},"wiki":{"book":{"title":"脱轨"},"characters":"9 条","chapters":"38 章"}}
{"ok":true,"revision":3,"duplicate":false,"derivedFrom":{"factRevision":2,"schema":"pinax-wiki-derived@1"},"wiki":{"characters":"9 条","chapters":"38 章"}}
```

**⑥ 静态托管**：`GET /` → `200 text/html`；`GET /app.js` → `200 text/javascript`。

### 8.4 测试与门禁

```
$ PINAX_OS_FIXTURE=D:/Pinax-e2e/s4-shots/夹具库 node --test openstory/test/contracts.test.mjs
ℹ tests 22 / pass 22 / fail 0

$ npm run verify:next
EXIT=0
M1 空框架＋M2 真载体验收：42/42 通过
node --test next/tests：tests 1390 / pass 1389 / fail 0（1 例跳过）
vitest next shell：20 files / 309 tests passed
eslint next --max-warnings 0
打包门禁：全部通过
```

无头 Chromium 行为冒烟：自动进 `--root` 库 → 291 行条目 → 详情 → 正文 41 字 → 保存显示
「已保存 · 刚刚」→ Wiki「人物 · 9 / 章节 · 38」，页面零 JS 错误。真窗截图按验收由调度方实拍。

### 8.5 limitations

1. **不做正文 revision 闸**（合同边界）：OpenStory 与 Electron 同写同一库只有 `.history` 粗保护，
   不检测并发覆盖、不做跨进程锁。
2. **没有独立 chapters 列表端点**：正文候选来自拆解条目 `sources[].sourceId`；无拆解数据的库
   （如真实「大梦」库）需在正文页签手填库内相对路径。补 `GET /api/chapters` 归后续批次。
3. **Agent 仅 SSE 透传**：不存凭据、不做工具循环、不做待确认写入；上游失败报
   `AGENT_UPSTREAM_ERROR`。对话与采纳归 OS-4。
4. **wiki 只读＋派生**：本批不提供写 wiki 端点。
5. `openstory/**` 测试未挂进 `verify:next`（不改 `package.json`），需单独跑。
6. `--root` 是显式 CLI 授权，会把该库补进库清单；未传时仍只认 recentProjects。
7. 真窗截图未由本单落仓库（按工单由调度方实拍）；本单只做无头行为冒烟。

