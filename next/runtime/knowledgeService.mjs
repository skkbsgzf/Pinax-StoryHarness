import { resolve } from 'node:path'
import { collectKnowledgeSources } from '../../server/services/knowledgeProjectIndex.js'
import { readProjectDocument } from '../project/projectManifest.mjs'

/**
 * 知识服务 all-in-one（工单H2）。
 *
 * 作者裁定：所有服务尽可能集成在一个底座里，不走 HTTP。这里就是那个底座——
 * 它直接包住 server/services/knowledgeRuntime.js 的 createKnowledgeRuntime()：
 *   - search()                → runtime.run(verb, args, entry)，worker 线程执行 kb_search／kb_read／
 *                               worldbook_search；不开端口、不 fetch Express；
 *   - exportProjectKnowledge()→ collectKnowledgeSources(root)：同一份 RAG 输入集与 revision，
 *                               纯读盘盘点，不建索引、不写缓存。
 * 上游码（KNOWLEDGE_RUNTIME_MISSING／KNOWLEDGE_BUSY／KNOWLEDGE_TIMEOUT／KNOWLEDGE_CHANGED 等）
 * 一律原样透传，外壳据此给作者「知识内核未安装／服务忙」这类人话。
 *
 * entry 的形状与 server/mcp/knowledgeIndex.js:snapshotKnowledge 的调用方一致
 * （collectKnowledgeSources 本身住在 server/services/knowledgeProjectIndex.js）：
 *   { projectId, rootPath }，rootPath = 项目根（不是 .pinax/，也不是资料目录）。
 * projectId 从 <root>/.pinax/project.json 读；不做全局知识面——entry 恒传当前项目。
 *
 * 单例：主进程启动时 createKnowledgeService() 一次，setSharedKnowledgeService() 交给
 * 资料载体的 pinax_reference_search 与 IPC 的 knowledge:* 两条通道共用；测试可显式传 runtime。
 */
export const KNOWLEDGE_READ_VERBS = Object.freeze(['kb_search', 'kb_read', 'worldbook_search'])

const PROJECT_ID_PATTERN = /^proj_[A-Za-z0-9_]+$/
const MAX_QUERY_CHARS = 2000
const MAX_RESULTS = 30
const MAX_REF_CHARS = 1000
const MAX_READ_CHARS = 20_000

let sharedKnowledgeService = null

/** 主进程单例的挂载点：IPC 与资料载体工具都从这里取同一个底座。 */
export function setSharedKnowledgeService(service) {
  sharedKnowledgeService = service ?? null
}

export function getSharedKnowledgeService() {
  return sharedKnowledgeService
}

function failure(code, message, details) {
  const error = { code, message: String(message ?? '') }
  if (details && typeof details === 'object') error.details = details
  return { ok: false, error }
}

function fromError(error, fallbackCode) {
  return failure(error?.code || fallbackCode, error?.message || String(error || '知识服务执行失败'), error?.details)
}

function normalizeRoot(root) {
  const value = String(root ?? '').trim()
  return value ? resolve(value) : null
}

/**
 * 读当前项目的 projectId（<root>/.pinax/project.json），并做形状校验。
 * projectId 会进 <cacheRoot>/<projectId> 的缓存目录名，必须挡住 ../ 这类路径字符。
 */
async function projectOf(root) {
  const projectRoot = normalizeRoot(root)
  if (!projectRoot) return failure('PINAX_INVALID_INPUT', '知识检索需要项目根 root（entry 恒传当前项目，不做全局知识面）')
  const document = await readProjectDocument(projectRoot)
  if (!document.ok) return document
  const projectId = String(document.value.projectId ?? '').trim()
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    return failure('KNOWLEDGE_PROJECT_INVALID', `项目 ${projectRoot} 的 projectId 形状不受支持：${projectId || '(空)'}`)
  }
  return { ok: true, value: { root: projectRoot, projectId } }
}

function boundedInt(value, { min, max, name }) {
  if (!Number.isSafeInteger(value) || value < min) return failure('PINAX_INVALID_INPUT', `${name} 须是 ≥${min} 的整数`, { got: value })
  return { ok: true, value: Math.min(value, max) }
}

export function createKnowledgeService({ runtime = null, runtimeRoot, cacheRoot } = {}) {
  if (runtime && typeof runtime.run !== 'function') {
    throw new TypeError('createKnowledgeService 需要 runtime.run(verb, args, entry)（不传则用 createKnowledgeRuntime 建一个）')
  }

  /**
   * 默认运行时按源码路径懒加载，不静态 import。原因很具体：shell 是 Vite SSR bundle，
   * 静态 import 会把 knowledgeRuntime.js 里那句
   *   new Worker(new URL('./knowledgeKernelWorker.js', import.meta.url))
   * 打进 next/.build，而 worker 文件不会被拷到 bundle 旁边（实测 npm run next:build:shell 后 .build
   * 里没有 knowledgeKernelWorker.js）。改为按源码 URL 动态加载后，knowledgeRuntime.js 自己的
   * import.meta.url 仍指向 server/services/，worker 路径正确，且 worker 线程/零 HTTP 的口径不变。
   * 打包应用如果不带 server/ 源码树，这里会如实失败（KNOWLEDGE_RUNTIME_MISSING），不冒充检索结果。
   */
  let lazyEngine = null
  function engineOf() {
    if (runtime) return Promise.resolve(runtime)
    if (!lazyEngine) {
      const moduleUrl = new URL('../../server/services/knowledgeRuntime.js', import.meta.url).href
      lazyEngine = import(/* @vite-ignore */ moduleUrl)
        .then((mod) => {
          if (typeof mod.createKnowledgeRuntime !== 'function') throw new Error('server/services/knowledgeRuntime.js 没有导出 createKnowledgeRuntime')
          return mod.createKnowledgeRuntime({ runtimeRoot, cacheRoot })
        })
        .catch((error) => {
          lazyEngine = null
          throw Object.assign(new Error(`知识运行时空载失败：${String(error?.message || error)}`), { code: 'KNOWLEDGE_RUNTIME_MISSING' })
        })
    }
    return lazyEngine
  }

  /**
   * RAG 输入集盘点（只读）：文件数、字节、按一级目录的覆盖，以及 revision。
   * 与 server/mcp/knowledgeIndex.js:snapshotKnowledge 同一形状；substrate 是 collectKnowledgeSources，
   * 不是 Express。大目录会慢——调用方负责 busy 态，服务本身不阻塞事件循环（fs 异步 I/O）。
   */
  async function exportProjectKnowledge({ root, signal } = {}) {
    const projectRoot = normalizeRoot(root)
    if (!projectRoot) return failure('PINAX_INVALID_INPUT', '资料盘点需要项目根 root')
    try {
      const collected = await collectKnowledgeSources(projectRoot, signal)
      let bytes = 0
      const byDir = {}
      for (const file of collected.files) {
        bytes += Buffer.byteLength(file.text, 'utf8')
        const top = String(file.relative).split('/')[0] || '(根)'
        byDir[top] = (byDir[top] || 0) + 1
      }
      const files = collected.files.length
      return {
        ok: true,
        value: {
          root: collected.root ?? projectRoot,
          revision: collected.revision,
          files,
          bytes,
          byDir,
          // 「输入集覆盖」也收成一格：后续界面/Agent 只看 coverage 也能读全。
          coverage: { files, bytes, byDir }
        }
      }
    } catch (error) {
      return fromError(error, 'KNOWLEDGE_SCAN_FAILED')
    }
  }

  /**
   * 只读检索：projectId＋rootPath 组成 entry，args 按动词白名单收窄后原样交给 runtime.run。
   * 项目档的检索由知识内核在 worker 里完成（kb_search 的 project 参数即 projectId）；
   * 任何上游错误码都不改写，外壳按码给人话。
   */
  async function search({ root, verb = 'kb_search', q, k, dir, ref, maxChars, cat, cluster } = {}) {
    const project = await projectOf(root)
    if (!project.ok) return project
    const wanted = String(verb ?? 'kb_search').trim().toLowerCase()
    if (!KNOWLEDGE_READ_VERBS.includes(wanted)) {
      return failure('KNOWLEDGE_VERB_INVALID', `verb 只能是 ${KNOWLEDGE_READ_VERBS.join(' / ')}；收到 ${verb}`)
    }

    const args = { project: project.value.projectId }
    if (wanted === 'kb_read') {
      const reference = String(ref ?? '').trim()
      if (!reference) return failure('PINAX_INVALID_INPUT', 'kb_read 需要 ref（kb_search 结果里的 readRef）')
      if (reference.length > MAX_REF_CHARS) return failure('PINAX_INVALID_INPUT', `ref 过长（上限 ${MAX_REF_CHARS} 字符）`, { got: reference.length })
      if (/^(?:[A-Za-z]:|[/\\])/u.test(reference) || reference.split(/[/\\]/).includes('..')) {
        return failure('KNOWLEDGE_REF_INVALID', 'ref 必须是知识库内的相对路径或卡片 ID，不接受绝对路径或 ..')
      }
      args.ref = reference
      if (maxChars !== undefined) {
        const chars = boundedInt(maxChars, { min: 1, max: MAX_READ_CHARS, name: 'maxChars' })
        if (!chars.ok) return chars
        args.max_chars = chars.value
      }
    } else {
      const query = String(q ?? '').trim()
      if (!query) return failure('PINAX_INVALID_INPUT', `${wanted} 需要检索词 q`)
      args.q = query.slice(0, MAX_QUERY_CHARS)
      if (k !== undefined) {
        const size = boundedInt(k, { min: 1, max: MAX_RESULTS, name: 'k' })
        if (!size.ok) return size
        args.k = size.value
      }
      if (dir !== undefined && String(dir).trim()) args.dir = String(dir).trim().slice(0, 100)
      if (wanted === 'kb_search' && cluster !== undefined && String(cluster).trim()) args.cluster = String(cluster).trim().slice(0, 100)
      if (wanted === 'worldbook_search' && cat !== undefined && String(cat).trim()) args.cat = String(cat).trim().slice(0, 100)
    }

    const entry = { projectId: project.value.projectId, rootPath: project.value.root }
    try {
      const engine = await engineOf()
      const result = await engine.run(wanted, args, entry)
      return { ok: true, value: result }
    } catch (error) {
      return fromError(error, 'KNOWLEDGE_SEARCH_FAILED')
    }
  }

  return { search, exportProjectKnowledge }
}
