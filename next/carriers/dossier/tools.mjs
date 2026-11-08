import { createFileDossierToolsModule } from '@pinax/core/usecases/fileDossierTools'
import { fail, ok } from '../../kernel/errors.mjs'
import { isSameProjectRoot, normalizeProjectRoot } from '../../fs/projectPath.mjs'
import { getSharedKnowledgeService } from '../../runtime/knowledgeService.mjs'
import { DOSSIER_CARRIER, DOSSIER_CARRIER_ID } from './manifest.mjs'

/**
 * T21（dossier 接 core）：设定与资料载体的六把工具（约束 list／save、资料 list／read／save、
 * pinax_reference_search）整份由 `@pinax/core` 的 fileDossierTools 决定——工具名与语义一字不改，
 * 目录归属（约束/ 与 资料/ 互不串门）、列表随篇带回前 20000 字并截断标注、只认 .md／.txt、
 * 修订号闸、标题／路径定位、projectPath 归一比较、资料检索只覆盖 资料/ 的边界，都在 core 那份里，
 * 与仓内旧内联实现逐字同源。
 *
 * 宿主只注入端口：
 *   - fail／ok：回执天生 PINAX_*，不建第二层错误码翻译；
 *   - isSameProjectRoot／normalizeProjectRoot：与文件服务写族闸同一份路径规矩；
 *   - getSharedKnowledgeService：知识内核单例仍由运行时提供（显式注入仍优先）；
 *   - DOSSIER_CARRIER／DOSSIER_CARRIER_ID：目录与载体 id 仍以本载体清单为准。
 */
const dossierTools = createFileDossierToolsModule({
  fail,
  ok,
  isSameProjectRoot,
  normalizeProjectRoot,
  getSharedKnowledgeService,
  DOSSIER_CARRIER,
  DOSSIER_CARRIER_ID
})

/** 载体自有的六把工具名（约束对＋资料三把＋检索），供门禁核「认领面只增不减」。 */
export const DOSSIER_TOOL_NAMES = dossierTools.DOSSIER_TOOL_NAMES

export function createDossierTools(context = {}) {
  return dossierTools.createDossierTools(context)
}

export default createDossierTools
