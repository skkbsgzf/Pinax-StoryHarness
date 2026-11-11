/**
 * 抽取实跑日志（P-LLM 落地的「中途留好日志」基础设施，作者 2026-11-11 要求）。
 *
 * 为什么单开一层：跑 10 章真实抽取时，出问题时最需要的是「每一段到底发生了什么」——
 * 发了什么 prompt、模型回了什么、多少 token、耗时多久、哪个字段校验失败。
 * 这些不能只看最终统计，必须逐轮留痕，而且要能在跑完之后离线复盘。
 *
 * 三种日志（同一目录，按用途分文件）：
 *   calls.jsonl    每次模型调用一行：{seq, at, stage, sourceId, segmentIndex, ms, promptChars,
 *                                    ok, usage, error, attempt}
 *   prompts/<id>.txt  该次调用的完整 prompt（原文，便于复现；与 calls.jsonl 的 seq 对应）
 *   replies/<id>.txt  该次调用的完整回包（校验失败的原始 JSON 尤其重要——能看出模型错在哪）
 *   events.jsonl   阶段级事件：prepare/finish/flush/prune/checkpoint 的读数快照
 *
 * 纪律：
 *   1) **追加写 + 原子**：单行 JSON 追加（appendFile），不做「读-改-写」，进程被杀也不毁历史；
 *   2) **不截断**：prompt/回包存全文，不在日志层做任何 clip（clip 是传输层的事）；
 *   3) **可离线复盘**：run 结束后只靠这个目录就能重建「每段怎么抽的」；
 *   4) **失败如实**：错误对象原样序列化（code/message/details），不吞不美化。
 *
 * 宿主层模块（用 node:fs），不进 fact 域——域内只认 LlmPort。
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const EXTRACTION_LOG_VERSION = 'extraction-log@1'

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function pad(value, width = 4) {
  return String(value).padStart(width, '0')
}

/**
 * @param {Object} options
 * @param {string} options.root     日志根目录（调用方给，通常是 <project>/.pinax/logs/extract-<runId>）
 * @param {boolean} [options.capturePrompt] 是否存 prompt 全文（默认 true；关闭后只存字数）
 * @param {boolean} [options.captureReply]  是否存回包全文（默认 true）
 * @param {() => Date} [options.now]
 */
export function createExtractionLog({ root, capturePrompt = true, captureReply = true, now = () => new Date() } = {}) {
  if (!root) throw new TypeError('createExtractionLog 需要 root（日志根目录）')
  let seq = 0
  let ready = null

  async function ensure() {
    if (!ready) {
      ready = (async () => {
        await mkdir(root, { recursive: true })
        if (capturePrompt) await mkdir(join(root, 'prompts'), { recursive: true })
        if (captureReply) await mkdir(join(root, 'replies'), { recursive: true })
      })()
    }
    return ready
  }

  async function append(file, row) {
    await ensure()
    await appendFile(join(root, file), `${JSON.stringify(row)}\n`, 'utf8')
  }

  /**
   * 记一次模型调用（成功或失败都记）。
   * @param {Object} input
   *   stage        'extract'|'mine-character'|'mine-setting'|'render'|...
   *   sourceId/segmentIndex  定位到段
   *   prompt       完整 prompt（capturePrompt 时落盘）
   *   reply        完整回包（captureReply 时落盘）
   *   ms           耗时
   *   usage        {promptTokens, completionTokens} 或 null
   *   ok/error     成功标志与错误对象
   *   attempt      第几次尝试（重试时 >1）
   */
  async function call(input = {}) {
    const source = isPlainObject(input) ? input : {}
    const id = `${pad(++seq)}`
    const at = now().toISOString()
    const prompt = str(source.prompt)
    let promptFile = null
    let replyFile = null
    if (capturePrompt && prompt) {
      promptFile = `prompts/${id}.txt`
      await ensure()
      await writeFile(join(root, promptFile), prompt, 'utf8')
    }
    const reply = str(source.reply)
    if (captureReply && reply) {
      replyFile = `replies/${id}.txt`
      await ensure()
      await writeFile(join(root, replyFile), reply, 'utf8')
    }
    const row = {
      seq,
      at,
      stage: str(source.stage) || 'extract',
      sourceId: str(source.sourceId) || null,
      segmentIndex: Number.isInteger(source.segmentIndex) ? source.segmentIndex : null,
      attempt: Number.isInteger(source.attempt) ? source.attempt : 1,
      ms: Number.isFinite(source.ms) ? source.ms : null,
      promptChars: prompt.length,
      replyChars: reply.length,
      ok: source.ok === true,
      usage: isPlainObject(source.usage) ? { ...source.usage } : null,
      promptFile,
      replyFile,
      error: source.error
        ? {
            code: str(source.error.code) || null,
            message: str(source.error.message),
            ...(source.error.details !== undefined ? { details: source.error.details } : {})
          }
        : null
    }
    await append('calls.jsonl', row)
    return { id, row }
  }

  /** 阶段级事件（prepare/finish/flush/prune/checkpoint 等）。 */
  async function event(kind, data = {}) {
    const row = { at: now().toISOString(), kind: str(kind), ...(isPlainObject(data) ? data : {}) }
    await append('events.jsonl', row)
    return row
  }

  /** 汇总读数（跑完后一眼看全局：调用数/成功率/tokens/耗时分布）。 */
  async function summarize() {
    const { readFile } = await import('node:fs/promises')
    let text = ''
    try { text = await readFile(join(root, 'calls.jsonl'), 'utf8') } catch { return null }
    const rows = text.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
    const ok = rows.filter((row) => row.ok)
    const fail = rows.filter((row) => !row.ok)
    const sum = (pick) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0)
    const byCode = {}
    for (const row of fail) {
      const code = row.error?.code ?? 'UNKNOWN'
      byCode[code] = (byCode[code] ?? 0) + 1
    }
    return {
      version: EXTRACTION_LOG_VERSION,
      root,
      calls: rows.length,
      ok: ok.length,
      failed: fail.length,
      successRate: rows.length ? Number((ok.length / rows.length).toFixed(3)) : null,
      promptTokens: sum((row) => row.usage?.promptTokens),
      completionTokens: sum((row) => row.usage?.completionTokens),
      totalMs: sum((row) => row.ms),
      avgMs: rows.length ? Math.round(sum((row) => row.ms) / rows.length) : null,
      slowest: rows.slice().sort((left, right) => (right.ms ?? 0) - (left.ms ?? 0))[0]?.ms ?? null,
      errorCodes: byCode,
      firstFailure: fail[0] ?? null
    }
  }

  return { root, call, event, summarize, get seq() { return seq } }
}
