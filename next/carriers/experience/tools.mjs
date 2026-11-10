import { randomUUID } from 'node:crypto'
import { createFileRecordToolsModule } from '@pinax/core/usecases/fileRecordTools'
import { fail, ok } from '../../kernel/errors.mjs'
import { EXPERIENCE_CARRIER_ID } from './manifest.mjs'

/** 体验记录集：本子／会话／一次跑团／备注；状态机快照、骰子记录等私有字段放 meta。 */
export const EXPERIENCE_RECORD_CONFIG = Object.freeze({
  prefix: 'pinax_experience',
  dir: '体验',
  file: '体验.json',
  label: '体验会话',
  typeHint: '可用：scenario（本子）／session（会话）／run（一次跑团记录）／note（备注）。',
  statusHint: '可用：draft／running／ended／archived。'
})

export const EXPERIENCE_TOOL_NAMES = Object.freeze([
  'pinax_experience_list',
  'pinax_experience_read',
  'pinax_experience_save',
  'pinax_experience_remove'
])

/**
 * T9（experience 接 core）：只接记录文献语义——文档形状（{ schemaVersion:1, records }）、
 * 修订号闸、未传字段保留、id 形制与四条工具描述，一律由 `@pinax/core` 的 fileRecordTools 决定，
 * 本文件只剩载体配置与宿主端口注入。
 *
 * 为什么不是 core 的 experience 运行时（domain/experience、roleplay/*、run/*）：
 * core 0.16 的 experience 是完整跑团运行时（回合事务、骰点结算、会话/分支恢复、场景/资源/同伴/主持），
 * 而本载体的工具面是四把记录存取（list／read／save／remove），没有回合入口，也没有 live session
 * 对象可交给 createScenarioRun／applyScenarioOutcome 一类函数。会话记录形状（messages／chatHistory／
 * runtimeState／worldState／turnRecords／roleplay）与记录文献的扁平形状（id／title／type／status／…）
 * 对不上，硬套会改写作者可见 JSON 与 status 词表；这几块按 limitations 记录，不硬凑。
 *
 * 错误码：core 模块通过注入的宿主 fail／ok 出结果，回执天生是 PINAX_*，不存在 CORE_ERROR_CODES
 * 需要翻译的中间态，也就没有第二个翻译点可能漏码。
 */
const recordTools = createFileRecordToolsModule({ randomUUID, fail, ok })

export function createExperienceTools(context = {}) {
  return recordTools.createRecordTools(
    { ...context, pluginId: context.pluginId ?? EXPERIENCE_CARRIER_ID },
    EXPERIENCE_RECORD_CONFIG
  )
}

export default createExperienceTools
