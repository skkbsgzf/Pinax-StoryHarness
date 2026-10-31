# 批次58 记录：三独立体接入底座——画布承载＋提交闸收口（2026-10-31）

> 作者架构裁定（纠正批次48 时的过渡设计）：toonflow／ComfyUI／资产管理载体**三个独立运行体各自接入底座**；CF2TF 是过渡参考不是目标形态，其 SPEC 十条红线是将来底座自建出图管线的设计输入。执行：Qoder CLI（DeepSeek-Flash，73 轮/约 12 分钟，退出码 0）。工单：[v2](./pinax-electron-next-m2-batch58-ticket-20261031.md)。

## 交付

1. **画布承载**：comic manifest 加 `comic.canvas` app 档 pane（`pinax.view.app`/`external-app`，回环 `http://127.0.0.1:3010`，四形态 dock/split/fullscreen/immersive）；ExternalAppHost 承载（批次44 iframe＋人话失败文案现成）；应用面底部加 quiet「复制地址单开」。
2. **提交闸收口（CF2TF 红线1）**：`mcp[comfy].allow` 收为 `['comfy_status','comfy_result']`——`comfy_submit` 摘出工具面（第二个直连 ComfyUI 的提交方不再存在）；桥代码保留（改 allow 即恢复，AGENT.md 写明恢复条件＝底座提交闸落地）。
3. **AGENT.md 重写**：三独立体与各自接入面、comfy_submit 停用理由与恢复条件、CF2TF 过渡定位一句话、批次52 adopt／底座出图管线两个登记项。
4. 调度方验收补刀一处（评审 low）：「复制地址单开」在剪贴板 API 整体缺席时 optional-call resolve(undefined) 会假报已复制——加 API 存在性守卫，缺席走失败分支。

## 调度方验收

- 门禁独立复跑 exit 0；内核/界面/eslint/打包全绿；真实改动 11 文件全在允许清单（评审临时索引核实，95 个漂移文件再证与执行方无关——blob 反查命中 10-25 主线提交）。
- **真窗口**（dameng-px，`next-batch58-shots/png/106`）：**工具面 46**＝47−1（comfy_submit 摘除实锤）；漫画绿点在；画布 pane 已进清单与校验（测试钉住），**但中栏双 pane（comic.editor＋comic.canvas）的切换呈现无入口**——菜单只有形态子项。这不是缺陷，是「一块载体多中栏 pane 怎么呈现」的槽语义空白，正是批次52 @4 `multiplicity/scope` 要回答的问题——实拍证据直接喂给 52。

## 已知边界

1. toonflow 未运行时画布 pane 的人话态在 jsdom 层验证（真窗未起 toonflow，作者起后即见 iframe）。
2. ComfyUI 8188 的端口管理维持批次49 池链路（探活/记账），**不代启不代杀**；adopt 模式（只监控不 spawn 的协议正身）归批次52。
3. CF2TF MCP 未预声明（过渡参考不进协议）；其 M3 上线后如需接入另评。

## 复现

```bash
cd D:/Pinax-main/Pinax-main && npm run next:build:main && npm run next:build:shell && npm run verify:next
```
