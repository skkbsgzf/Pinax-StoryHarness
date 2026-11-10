import { fail, ok } from '../kernel/errors.mjs'
import { buildWritingRequest, cleanWritingResult, validateWritingRequest } from '../shell/writingActions.mjs'
import { buildRuntimeEnvelope } from './contextProfiles.mjs'
import { forwardComplete } from '../../server/services/kitModelGateway.js'

/**
 * 正文写作动作的主进程实现（批次41，批次46A 升级参考块）。
 *
 * 为什么放在主进程而不是渲染层直接调模型：模型面只在内核侧（任务面端点、凭据、超时），
 * 渲染层拿不到也不该拿到。渲染层递上来的是「动作＋正文＋选区＋额外要求」，
 * 提示词只在这里由 writingActions 拼——所以这个通道不是一条通用模型管道。
 *
 * 与老前端的分工一致：老版写作页也是「界面收集选区 → 服务组提示词 → 模型面」，
 * 只是当年走的是浏览器内的 fetch。这里换成进程内注入的 complete，接口更窄。
 *
 * 批次46A：五个动作不再裸补全——先按同一条 ask 链的口径（buildRuntimeEnvelope）取本书参考块，
 * 以【本书参考】并入用户提示词。信封组装不出来时降级为批次41 的裸补全，但结果里如实标注
 * 「参考块缺席」；预算与截断全信信封自己的 clip，这里不另造第二套。
 *
 * 旧轨依赖只出现在这一层（与 toolTurn 同一口径）：`server/services/kitModelGateway` 不进外壳源码，
 * next/shell 的「渲染侧依赖必须薄」门禁因此仍然成立。
 */

/** 取参考块时的检索问句上限：信封只用它给块打分，别把整章正文当成检索词。 */
const REFERENCE_QUESTION_MAX_CHARS = 2000

export function createWritingComplete({
  complete = forwardComplete,
  timeoutMs = 90_000,
  buildEnvelope = buildRuntimeEnvelope,
  // 运行时取数面：() => ({ registry, view, fileService })。项目没打开时返回缺项即降级，不抛。
  contextSources = null
} = {}) {
  if (typeof complete !== 'function') throw new TypeError('createWritingComplete 的 complete 必须是函数（默认 forwardComplete）')
  if (typeof buildEnvelope !== 'function') throw new TypeError('createWritingComplete 的 buildEnvelope 必须是函数（默认 buildRuntimeEnvelope）')

  /** 最近一次写作请求的完整提示词（只读预览口）。换了项目不提前清——preview 按根核对，不跨项目给。 */
  let lastPreview = null

  /**
   * @param {object} input { action, text, selection:{start,end}, instruction, root? }
   * @returns {Promise<{ok:true, value:{action,target,text,model,usage,references,degraded,referenceNote,missingKinds}}|{ok:false,...}>}
   */
  async function run(input = {}) {
    const validated = validateWritingRequest(input)
    if (!validated.ok) return fail('INVALID_INPUT', validated.message, { action: input.action ?? null })
    const { action } = validated.value
    const projectRoot = typeof input.root === 'string' && input.root ? input.root : null

    const collected = await collectReferences(validated.value, { buildEnvelope, contextSources })
    const payload = buildWritingRequest(validated.value, { references: collected.blocks })
    lastPreview = {
      action: action.id,
      target: action.target,
      projectRoot,
      at: new Date().toISOString(),
      systemPrompt: payload.systemPrompt,
      userPrompt: String(payload.messages?.[0]?.content ?? ''),
      references: collected.references,
      referenceNote: collected.note
    }

    let answered
    try {
      answered = await complete(payload, { timeoutMs })
    } catch (error) {
      // 上游不可达／超时：如实摊开，不编一段文字冒充模型。
      return fail('IO_FAILED', `写作动作没有拿到模型回应：${String(error?.message || error)}`, {
        action: action.id,
        code: error?.code ?? null
      })
    }
    if (answered && typeof answered === 'object' && answered.ok === false) {
      return fail('IO_FAILED', `写作动作没有拿到模型回应：${String(answered.error?.message ?? answered.message ?? '上游失败')}`, {
        action: action.id,
        code: answered.error?.code ?? null
      })
    }
    const raw = typeof answered === 'string'
      ? answered
      : String(answered?.content ?? answered?.text ?? '')
    const text = cleanWritingResult(raw)
    if (!text) {
      return fail('IO_FAILED', '模型没有返回正文（可能是上下文被截断或上游空补全），这次不往稿子里写任何字', {
        action: action.id,
        finishReason: answered?.finishReason ?? null
      })
    }
    return ok({
      action: action.id,
      target: action.target,
      text,
      model: answered?.model ?? null,
      usage: answered?.usage ?? null,
      references: collected.references,
      degraded: Boolean(collected.note),
      referenceNote: collected.note,
      missingKinds: collected.missingKinds
    })
  }

  /**
   * 只读预览：最近一次写作请求的完整 system＋user。
   * 没发起过、或最近一次属于另一个项目（root 对不上）都如实拒绝——预览不跨项目。
   */
  function preview({ root = null } = {}) {
    if (!lastPreview) {
      return fail('INVALID_INPUT', '这个项目还没有发起过写作请求：先续写或改写一次，才有提示词可看。')
    }
    const askedRoot = typeof root === 'string' && root ? root : null
    if (askedRoot && lastPreview.projectRoot && askedRoot !== lastPreview.projectRoot) {
      return fail('INVALID_INPUT', '最近一次写作请求属于另一个项目：不跨项目展示提示词，先在当前项目里发起一次。')
    }
    return ok({
      action: lastPreview.action,
      target: lastPreview.target,
      projectRoot: lastPreview.projectRoot,
      at: lastPreview.at,
      systemPrompt: lastPreview.systemPrompt,
      userPrompt: lastPreview.userPrompt,
      references: lastPreview.references.map((item) => ({ ...item })),
      referenceNote: lastPreview.referenceNote
    })
  }

  return { run, preview }
}

/**
 * 取本书参考块：成功时 blocks 带 content（进提示词），references 只留 kind／chars（给界面）。
 * 取不到／组装失败一律降级成裸补全，并留下人话原因；不硬失败——作者要的那一段文字比参考更重要。
 */
async function collectReferences(validated, { buildEnvelope, contextSources }) {
  const sources = typeof contextSources === 'function' ? contextSources() : null
  if (!sources?.registry || !sources?.view || !sources?.fileService) {
    return {
      blocks: [],
      references: [],
      missingKinds: [],
      note: '参考块缺席：运行时当前没有打开可组装上下文的项目，这次是裸补全。'
    }
  }
  const question = referenceQuestion(validated)
  let built
  try {
    built = await buildEnvelope({
      registry: sources.registry,
      view: sources.view,
      fileService: sources.fileService,
      question,
      context: {}
    })
  } catch (error) {
    return {
      blocks: [],
      references: [],
      missingKinds: [],
      note: `参考块缺席：上下文信封组装抛错（${String(error?.message || error)}），这次是裸补全。`
    }
  }
  if (!built?.ok) {
    return {
      blocks: [],
      references: [],
      missingKinds: [],
      note: `参考块缺席：${String(built?.error?.message ?? '上下文信封没有组装出来')}这次是裸补全。`
    }
  }
  const blocks = (Array.isArray(built.value?.envelope?.blocks) ? built.value.envelope.blocks : [])
    .filter((block) => block && typeof block.content === 'string' && block.content.trim())
    .map((block) => ({ kind: String(block.kind ?? ''), content: block.content }))
  if (!blocks.length) {
    return {
      blocks: [],
      references: [],
      missingKinds: Array.isArray(built.value?.missingKinds) ? [...built.value.missingKinds] : [],
      note: '参考块缺席：信封组装成功但没有可用的正文块，这次是裸补全。'
    }
  }
  return {
    blocks,
    references: blocks.map((block) => ({ kind: block.kind, chars: block.content.length })),
    missingKinds: Array.isArray(built.value?.missingKinds) ? [...built.value.missingKinds] : [],
    note: null
  }
}

/** 检索问句：优先作者这次的要求，其次是选中的段落／光标附近的近文；都没有才用动作本身。 */
function referenceQuestion(validated) {
  const { action, text, selection, instruction } = validated
  const focus = selection.end > selection.start
    ? text.slice(selection.start, selection.end)
    : text.slice(Math.max(0, selection.end - 400))
  const asked = [instruction, focus]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, REFERENCE_QUESTION_MAX_CHARS)
  return asked || `${action.label}：${action.brief}`
}
