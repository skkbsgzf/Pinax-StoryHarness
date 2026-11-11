/**
 * fact 域的导出总口（Core-shape）。
 *
 * 平移方式＝整目录复制进 `core/src/pedia/`：domain/ports/usecases/adapters 都不含宿主依赖
 * （无 node 内置、无 shell/runtime/kernel/carriers 引用），复制后只换 import 路径即可。
 *
 * 分层用途：
 *   domain    纯规则（词表/稳定 id/状态机/时间轴/schema/视角/分段/别名）；
 *   ports     宿主接口（FactStore/VectorPort/LlmPort 的契约与形状校验）；
 *   usecases  事实包、假设回灌、一致性预检、S3 hook 引擎；
 *   adapters  memoryPediaStore（参考实现，接 core 事务服务前先顶上）。
 */

export * from './domain/pediaSchema.js'
export * from './domain/segment.js'
export * from './domain/aliases.js'
export * from './ports/pediaStore.js'
export * from './ports/vectorPort.js'
export * from './ports/llmPort.js'
export * from './usecases/factPack.js'
export * from './usecases/hypothesis.js'
export * from './usecases/precheck.js'
export * from './usecases/hookEngine.js'
export * from './usecases/hookWiring.js'
export * from './usecases/pipeline/prompts.mjs'
export * from './usecases/pipeline/extract.js'
export * from './usecases/pipeline/extractionChain.js'
export * from './usecases/pipeline/leanEntries.js'
export * from './usecases/pipeline/consolidate.js'
export * from './usecases/pipeline/mine.js'
export * from './usecases/pipeline/cluster.js'
export * from './usecases/migrateLegacy.js'
export * from './usecases/skillContract.js'
export * from './usecases/gate.js'
export * from './usecases/consistency.js'
export * from './usecases/deduce/opening.js'
export * from './usecases/deduce/sessionState.js'
export * from './usecases/deduce/sceneContext.js'
export * from './usecases/deduce/fronts.js'
export * from './usecases/deduce/candidates.js'
export * from './usecases/deduce/settle.js'
export * from './usecases/deduce/turn.js'
export * from './usecases/deduce/sessionStore.js'
export * from './usecases/render/alignGranularity.js'
export * from './usecases/render/styleProfile.js'
export * from './usecases/render/styleProfileDoc.js'
export { createMemoryFactStore } from './adapters/memoryPediaStore.mjs'
