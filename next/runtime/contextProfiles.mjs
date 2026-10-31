import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { AGENT_CONTEXT_PROFILES } from '../../shared/agentContextProfiles.js'
import {
  buildAgentContextEnvelope,
  clipAgentContextEnvelope,
  createAgentContextLedger,
  validateAgentContextEnvelope
} from '../../shared/agentContextContract.js'
import { getCanonicalAgentTask, listCanonicalAgentTaskIds } from '../../shared/agentCapabilityContract.js'
import { fail, ok } from '../kernel/errors.mjs'

/**
 * 运行时的上下文档案（M2 · WP3 的装配侧）。
 * 这里刻意不做「自己造一个任务」的事：档案名 → 任务号 的映射只认既有只读档
 * （effectPolicy ∈ review-only / ephemeral / metrics-only），映射不到就拒答。
 * 理由很实在：换一个有写盘副作用的任务去答作者的提问，等于运行时替作者做了他没点的决定。
 * 块从哪来也只认载体：impl.blocks() 里声明了这个 kind 才取得到，没提供者就是一条记账，
 * 运行时不越过去自己开文件——那两个目录的读权限在载体的清单上，不在运行时手上。
 */
export const READ_ONLY_EFFECT_POLICIES = Object.freeze(['review-only', 'ephemeral', 'metrics-only'])
export const MAX_BLOCKS_PER_ENVELOPE = 60
/** 载体 AGENT.md 进信封时的上限（字）：作者须知太长会把内容块挤出去。 */
export const AGENT_MD_MAX_CHARS = 1200
/**
 * 全部载体的 AGENT.md 合计上限（字）。
 * 单份上限管不住「十二栏都开着」：须知一起涌进来会把内容块的预算吃光，
 * 结果是一封信里全是写作须知、没有一句这本书的内容。所以再加一道总量闸——
 * 超出的按主载体优先的顺序截掉，并在记账里留名。
 *
 * 上限取「今天的十二份合计（约 7000 字）」与「信封预算的三分之一」里的小者：
 * 十二栏全开时须知一份不丢，小预算时又不会把内容块饿死。
 */
export const AGENT_MD_TOTAL_MAX_CHARS = 8000
/** 须知合计最多占信封预算的几成（剩下的留给这本书的内容本身）。 */
export const AGENT_MD_BUDGET_SHARE = 0.34

const taskByProfile = new Map()

/** 只读任务里按 contextProfile 反查任务号；同一档案有多个只读档时取 id 最小者（稳定、可复核）。 */
export function readOnlyTaskForProfile(profile) {
  const name = String(profile || '').trim()
  if (!name) return null
  if (taskByProfile.has(name)) return taskByProfile.get(name)
  const matches = listCanonicalAgentTaskIds()
    .map((id) => getCanonicalAgentTask(id))
    .filter((definition) => definition && READ_ONLY_EFFECT_POLICIES.includes(definition.effectPolicy) && definition.contextProfile === name)
    .sort((a, b) => a.id.localeCompare(b.id))
  const found = matches[0] ?? null
  taskByProfile.set(name, found)
  return found
}

/** 启用集合 → 块提供者表（主载体优先，同名 kind 后者不覆盖前者）。 */
export function collectBlockProviders({ registry, view, fileService, allowedKinds = [] }) {
  const byKind = new Map()
  const warnings = []
  const enabled = orderedEnabled(view)
  for (const pluginId of enabled) {
    const manifest = registry?.get?.(pluginId)
    if (!manifest) continue
    const impl = registry?.impl?.(pluginId)
    if (typeof impl?.blocks !== 'function') continue
    const declared = manifest.context?.providers ?? []
    const provided = impl.blocks({ pluginId, manifest, fileService, root: fileService?.root ?? null, view, registry }) ?? {}
    for (const [kind, build] of Object.entries(provided)) {
      if (typeof build !== 'function') continue
      if (!allowedKinds.includes(kind)) {
        warnings.push(`${manifest.title} 提供了「${kind}」块，但档案不认这个种类，已忽略。`)
        continue
      }
      if (!declared.includes(kind)) {
        warnings.push(`${manifest.title} 提供了「${kind}」块却没在 context.providers 里声明，按未授权处理。`)
        continue
      }
      if (byKind.has(kind)) {
        warnings.push(`「${kind}」块有两个提供者，保留 ${byKind.get(kind).pluginId}，忽略 ${pluginId}（一块素材只有一个来源才对得上账）。`)
        continue
      }
      byKind.set(kind, { pluginId, title: manifest.title, build })
    }
  }
  return { byKind, warnings }
}

/**
 * 协议 v3 的 `agentMd` 面：载体自己的 AGENT.md（作者须知）并进上下文信封。
 *
 * 读的是**插件目录**里的那份文件（不是项目里的），路径只认清单声明的那一条相对路径；
 * 越界、读不到、内容为空都只记一条 warning，不把整条信封拖垮——须知是加料，不是主菜。
 * 优先级排在内容块之前（1100 > 1000）：它是「怎么读这块内容」，不是内容本身。
 */
export async function collectAgentMdBlocks({ registry, view, read = readFile, maxChars = AGENT_MD_MAX_CHARS, totalMaxChars = AGENT_MD_TOTAL_MAX_CHARS } = {}) {
  const blocks = []
  const warnings = []
  for (const pluginId of orderedEnabled(view)) {
    const manifest = registry?.get?.(pluginId)
    const relativePath = manifest?.agentMd
    if (!relativePath) continue
    const dir = registry?.dirOf?.(pluginId)
    if (!dir) {
      warnings.push(`${manifest.title} 声明了 AGENT.md，但宿主没登记它的插件目录，这段作者须知没进上下文。`)
      continue
    }
    const base = resolve(dir)
    const file = resolve(base, relativePath)
    const inside = relative(base, file)
    if (inside.startsWith('..') || isAbsolute(inside)) {
      warnings.push(`${manifest.title} 的 AGENT.md 路径越出了插件目录，没进上下文。`)
      continue
    }
    let text
    try {
      text = await read(file)
    } catch (error) {
      warnings.push(`${manifest.title} 的 AGENT.md 读不出来：${String(error?.message || error)}`)
      continue
    }
    const content = String(text ?? '').trim()
    if (!content) {
      warnings.push(`${manifest.title} 的 AGENT.md 是空的，跳过。`)
      continue
    }
    blocks.push({
      kind: 'agent-md',
      content: content.slice(0, maxChars),
      priority: 1100,
      sourceRefs: [`agentmd:${pluginId}/${relativePath}`]
    })
  }
  return { blocks: clipAgentMdBlocks(blocks, { totalMaxChars, warnings }), warnings }
}

/**
 * 总量闸：各载体的须知合计不许超过 totalMaxChars。
 * 截断按主载体优先的顺序（blocks 进来时已经排好序），截掉的与截短的都记一条账——
 * 作者得知道「有几栏的须知没进上下文」，而不是看见模型漏了规矩。
 */
function clipAgentMdBlocks(blocks, { totalMaxChars, warnings }) {
  let total = 0
  const kept = []
  for (const block of blocks) {
    const room = totalMaxChars - total
    if (room <= 0) {
      warnings.push(`各载体的 AGENT.md 合计超过 ${totalMaxChars} 字，${block.sourceRefs?.[0] ?? '后面那份'} 没进上下文。`)
      continue
    }
    if (block.content.length <= room) {
      kept.push(block)
      total += block.content.length
      continue
    }
    kept.push({ ...block, content: block.content.slice(0, room) })
    total += room
    warnings.push(`各载体的 AGENT.md 合计超过 ${totalMaxChars} 字，${block.sourceRefs?.[0] ?? '有一份'}被截短。`)
  }
  return kept
}

/**
 * 组装一次提问的上下文信封。
 * 返回 ok(payload) 时 payload = { envelope, taskType, capability, profile, providerKinds, missingKinds, warnings, ledger, dropped }。
 */
export async function buildRuntimeEnvelope({ registry, view, fileService, question, context = {}, maxChars } = {}) {
  if (!view) return fail('INVALID_INPUT', '还没有打开项目：上下文信封需要项目视图（主载体＋启用板块）才能组装')
  const asked = String(question || '').trim()
  if (!asked) return fail('INVALID_INPUT', '提问内容不能为空')

  const profileName = String(view.contextProfile || '').trim()
  const definition = readOnlyTaskForProfile(profileName)
  if (!definition) {
    return fail('DEPENDENCY_UNMET', `主载体的上下文档案「${profileName || '(未声明)'}」在只读任务表里没有对应任务。运行时不会自行换一个有写盘副作用的任务来回答——请先给这块载体指一个只读档（M2 口径）。`, {
      profile: profileName,
      primary: view.primary,
      readOnlyProfiles: readOnlyProfiles()
    })
  }
  const profile = AGENT_CONTEXT_PROFILES[definition.contextProfile]
  if (!profile) return fail('DEPENDENCY_UNMET', `任务 ${definition.id} 的档案「${definition.contextProfile}」在 shared/agentContextProfiles.js 里不存在`, { taskType: definition.id })

  const allowedKinds = profile.blocks
  const omitted = new Set((Array.isArray(context.omit) ? context.omit : []).map((item) => String(item)))
  const { byKind, warnings } = collectBlockProviders({ registry, view, fileService, allowedKinds })
  const collected = []
  const missingKinds = []
  let target = null

  for (const kind of allowedKinds) {
    if (omitted.has(kind)) {
      warnings.push(`按提问要求跳过「${kind}」块（context.omit）。`)
      continue
    }
    const provider = byKind.get(kind)
    if (!provider) {
      missingKinds.push(kind)
      warnings.push(`「${kind}」块没有提供者：启用集合里没有板块声明它（这块素材缺席，回答里若涉及它属于模型的常识而非本书设定）。`)
      continue
    }
    let material
    try {
      material = await provider.build({ question: asked, context, kind, profile: profileName, view })
    } catch (error) {
      warnings.push(`「${kind}」块构建抛错：${String(error?.message || error)}（${provider.title}）`)
      continue
    }
    const blocks = Array.isArray(material?.blocks) ? material.blocks : []
    warnings.push(...(Array.isArray(material?.warnings) ? material.warnings : []))
    if (!target && material?.target) target = material.target
    for (const block of blocks) {
      if (!block || typeof block.content !== 'string' || !block.content.trim()) continue
      collected.push({
        kind: block.kind ?? kind,
        content: block.content,
        priority: 1000 - allowedKinds.indexOf(kind) * 10,
        sourceRefs: (Array.isArray(block.sourceRefs) ? block.sourceRefs : []).slice(0, 32).map((ref) => String(ref).slice(0, 200))
      })
    }
  }

  if (collected.length > MAX_BLOCKS_PER_ENVELOPE) {
    warnings.push(`块数超过 ${MAX_BLOCKS_PER_ENVELOPE}，只保留前 ${MAX_BLOCKS_PER_ENVELOPE} 个（其余 ${collected.length - MAX_BLOCKS_PER_ENVELOPE} 个未进信封）。`)
    collected.length = MAX_BLOCKS_PER_ENVELOPE
  }
  // 协议 v3 的 agentMd 面：载体自己的作者须知排在内容块前面并进同一份信封。
  // 先按原来的口径判「有没有内容块」——须知是加料，单独一份须知撑不起一次回答。
  if (!collected.length) {
    return fail('DEPENDENCY_UNMET', `本次提问组装不出任何上下文块：档案「${profileName}」要的 ${allowedKinds.join('/')} 里，有内容的块是 0 个。${warnings[0] ? `最近一条记账：${warnings[0]}` : ''}`, {
      profile: profileName,
      taskType: definition.id,
      missingKinds,
      warnings: warnings.slice(0, 12)
    })
  }
  const budget = resolveBudget({ profile, definition, view, maxChars })
  const agentMd = await collectAgentMdBlocks({ registry, view, totalMaxChars: agentMdCapFor(budget) })
  warnings.push(...agentMd.warnings)
  collected.unshift(...agentMd.blocks)

  const envelope = clipAgentContextEnvelope(
    buildAgentContextEnvelope({
      surface: definition.owner,
      target: {
        type: target?.type ?? 'project',
        id: target?.id != null ? String(target.id) : null,
        revision: String(target?.revision ?? `next-project:${view.primary}:${view.revision ?? 0}`)
      },
      budget: { maxChars: budget },
      blocks: collected
    }),
    budget
  )

  const validation = validateAgentContextEnvelope(envelope, definition)
  if (!validation.valid) {
    return fail('INVALID_INPUT', `上下文信封未通过既有合同校验：${validation.reason}`, {
      code: validation.code,
      taskType: definition.id,
      blockCount: envelope.blocks?.length ?? 0
    })
  }

  return ok({
    envelope,
    taskType: definition.id,
    capability: definition.capability ?? 'text',
    profile: profileName,
    providerKinds: [...byKind.keys()],
    missingKinds,
    warnings: [...new Set(warnings)],
    ledger: createAgentContextLedger(envelope),
    dropped: envelope.dropReport?.dropped ?? [],
    target: envelope.target
  })
}

export function readOnlyProfiles() {
  const set = new Set()
  for (const id of listCanonicalAgentTaskIds()) {
    const definition = getCanonicalAgentTask(id)
    if (definition && READ_ONLY_EFFECT_POLICIES.includes(definition.effectPolicy)) set.add(definition.contextProfile)
  }
  return [...set].sort()
}

function resolveBudget({ profile, definition, view, maxChars }) {
  const caps = [Number(profile.maxChars) || 16000, Number(definition.maxContextChars) || Number.POSITIVE_INFINITY]
  const requested = Number(maxChars ?? contextBudgetOf(view))
  if (Number.isSafeInteger(requested) && requested > 0) caps.push(requested)
  return Math.max(2000, Math.min(...caps))
}

/**
 * 须知合计闸按信封预算走：上限取固定天花板与「预算的三成几」的较小者。
 * 小预算时须知只能占三分之一，剩下的留给这本书的内容——须知再多也不许把正文挤出去。
 */
function agentMdCapFor(budget) {
  const byBudget = Math.floor(Number(budget ?? 0) * AGENT_MD_BUDGET_SHARE)
  return Math.max(AGENT_MD_MAX_CHARS, Math.min(AGENT_MD_TOTAL_MAX_CHARS, byBudget))
}

/** 取块预算时尊重板块自己的声明（主载体的那条优先）。 */
function contextBudgetOf(view) {
  const entries = Array.isArray(view?.context) ? view.context : []
  const primary = entries.find((item) => item.pluginId === view?.primary) ?? entries[0]
  return Number(primary?.budgetChars) || null
}

function orderedEnabled(view) {
  const enabled = Array.isArray(view?.enabled) ? view.enabled : []
  const primary = view?.primary
  return [...enabled].sort((a, b) => (Number(b === primary) - Number(a === primary)) || a.localeCompare(b))
}
