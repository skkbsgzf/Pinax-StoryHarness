/* 批次65a 探针：这个文件若被 import，顶层副作用立即现形。
 * 声明型装载器必须按形态拒装、绝不走到这里——测试同时核 skipped stage 与计数器。 */
globalThis.__pinaxImplProbe = (globalThis.__pinaxImplProbe ?? 0) + 1
throw new Error('第三方 impl 被执行了：批次65a 的红线破防')
