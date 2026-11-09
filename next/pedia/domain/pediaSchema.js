/**
 * pedia/v2 domain 桶（Core 平移件）。
 *
 * 只做 re-export：词表、稳定 id、状态机、双时间轴、信封校验、视角校验各在自己文件里。
 * 旧入口 `wikihub/pediaSchema.mjs` 已改成薄壳转发到本文件，外部导出名保持不变。
 */

export * from './vocabulary.js'
export * from './stableId.js'
export * from './status.js'
export * from './validity.js'
export * from './schema.js'
export * from './perspective.js'
