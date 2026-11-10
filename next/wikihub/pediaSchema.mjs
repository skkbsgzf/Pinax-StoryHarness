/**
 * 兼容薄壳：fact.data/v2 真源已迁到 `next/fact/domain/`（本文件只剩转发）。
 *
 * 保留这个路径是为了「wikihub 对外导出不变」：测试与外部调用方仍可从 `./pediaSchema.mjs`
 * 取同一组常量与纯函数；实现与校验规则只在 `next/fact/domain/` 维护一份。
 */

export * from '../fact/domain/pediaSchema.js'
