/**
 * 错误人话层（P9 · 作者 2026-11-13 UX 审计裁定）——**只翻渲染层，不动内核错误结构**。
 *
 * 工单钉死的三件事：
 *   1) 主文案不摆错误码与工具 id：`MCP error -32602`、`pinax_proposal_list` 这类原文只进
 *      「技术详情／过程」折叠，给作者看的是「这个功能还没接上当前库」；
 *   2) 归因要说对：E1 的根因是**没打开库**，不是工具丢了；E2 的根因是**连不上模型服务**，
 *      不是外壳自己的执行坏了；
 *   3) 零信息量的那行字（`已处理（不足 0.1 秒）`）不摆——展示点自己按耗时读数决定（E3）。
 *
 * 纯函数：node:test 直测（next/tests/error-words.test.mjs），组件只取 `{ title, hint, detail }` 摆位置。
 */

/** 阶段名的人话映射（RuntimeDock 报「断在：X」时用的是这几个词）。 */
export const ERROR_STAGE_WORDS = Object.freeze({
  组装上下文: '准备写作资料',
  调用模型: '生成回复',
  落盘: '写入'
})

/** MCP 码只认「MCP error -N」这一层；同前缀重复多少遍都折成一层（E1 上游叠了两层）。 */
const MCP_CODE_PATTERN = /MCP error -?\d+/u
const DUPLICATE_MCP_PATTERN = /(MCP error -?\d+:[ \t]*)(?:MCP error -?\d+:[ \t]*)+/gu
const NETWORK_PATTERN = /fetch failed|ECONNREFUSED|UND_ERR_CONNECT_FAILED/u
const STAGE_PATTERN = /断在\s*[:：]\s*([^）)\n]+)/u

/** 含中日韩文字或全角标点——用来判断一段话是不是「已经是人话」。 */
const CJK_PATTERN = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/u

/**
 * 只折叠 MCP 码的重复前缀，其余一个字符都不动。
 * `MCP error -32602: MCP error -32602: Tool ...` → `MCP error -32602: Tool ...`
 */
export function dedupeMcpCodes(text) {
  return String(text ?? '').replace(DUPLICATE_MCP_PATTERN, '$1')
}

/** 断在那一步：原文里的「断在：X」优先；宿主把阶段单独递进来时用 context.stageLabel。 */
function stageOf(raw, context) {
  const matched = raw.match(STAGE_PATTERN)
  if (matched) return matched[1].trim()
  return String(context?.stageLabel ?? '').trim()
}

/**
 * rule 4 的标题：去掉内部阶段括注与结尾的纯英文错误原文，留住作者看得懂的那半句。
 * 全是英文（或拆完什么都不剩）时给一句兜底，不把英文原文端上主文案。
 */
function plainTitle(raw) {
  let title = raw.replace(/[（(]\s*断在\s*[:：][^）)]*[）)]/gu, '').trim()
  const colon = Math.max(title.lastIndexOf('：'), title.lastIndexOf(':'))
  if (colon > 0) {
    const tail = title.slice(colon + 1)
    if (tail.trim() && /[A-Za-z]/u.test(tail) && !CJK_PATTERN.test(tail)) {
      title = title.slice(0, colon).trim()
    }
  }
  return title && CJK_PATTERN.test(title) ? title : '这一步没跑完'
}

/**
 * 原文 → `{ title, hint, detail }`。按工单顺序匹配，命中即停：
 *   ① MCP + not found → 没接上当前库（归因纠正：缺的是库，不是工具）
 *   ② 网络失败       → 连不上模型服务
 *   ③ 其余 MCP 码    → 参数没对上
 *   ④ 其余「断在：X」 → 阶段人话化
 *   ⑤ 都不命中       → 原样退回（不硬翻）
 * `detail` 恒留原文（只折叠 MCP 重复前缀），供反馈开发者与进「技术详情／过程」折叠。
 */
export function humanizeError(rawText, context = {}) {
  const raw = String(rawText ?? '').trim()
  if (!raw) return { title: '', hint: '', detail: '' }

  const detail = dedupeMcpCodes(raw)

  if (MCP_CODE_PATTERN.test(raw) && /not found/iu.test(raw)) {
    return {
      title: '这个功能还没接上当前库',
      hint: '先新建或打开一个库，再回到这一节。',
      detail
    }
  }

  if (NETWORK_PATTERN.test(raw)) {
    return {
      title: '连不上模型服务',
      hint: '到 设置·应用·偏好与模型 检查模型端点，或确认模型服务已启动。',
      detail
    }
  }

  if (MCP_CODE_PATTERN.test(raw)) {
    return {
      title: '参数没对上，这一步没执行',
      hint: '把这条错误反馈给开发者。',
      detail
    }
  }

  const stage = stageOf(raw, context)
  if (stage) {
    const mapped = ERROR_STAGE_WORDS[stage]
    // 已经是人话的阶段名（如「模型第 1 轮」）不再扣「内部阶段」的帽子；只有 ASCII 标识符才标。
    const hint = mapped
      ? `卡在「${mapped}」这一步，可以重试一次。`
      : CJK_PATTERN.test(stage)
        ? `卡在「${stage}」这一步，可以重试一次。`
        : `卡在「${stage}」这一步（内部阶段），可以重试一次。`
    return { title: plainTitle(raw), hint, detail }
  }

  return { title: raw, hint: '', detail }
}
