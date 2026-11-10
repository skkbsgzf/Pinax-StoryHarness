/**
 * Next 主进程 bundle 的唯一入口（WP3）。
 * 只 import 内核、运行时与项目层；渲染层（Electron 外壳）从 next/shell 走自己的入口。
 * 打包侧两条硬规矩由 next/testing/bundleAssertions.mjs 断言，不靠人记：
 *   1) 必须 SSR/node 平台构建（否则 node:crypto 被换成浏览器 stub，构建即炸）；
 *   2) 必须 ssr.noExternal:true（否则 npm 依赖外置，packager 不放行 node_modules，装机后裸导入必断）。
 */
export { createNextSession, KERNEL_INFO, NEXT_VERSION } from './index.mjs'
export { createRegistry } from './kernel/pluginRegistry.mjs'
export { createAgentRuntime, RUNTIME_CONTRACT } from './runtime/agentRuntime.mjs'
export { createMcpSurface, kernelToolNames } from './runtime/mcpSurface.mjs'
export { connectInProcess } from './runtime/transportInProcess.mjs'
export { createProject, initBareProject } from './project/createProject.mjs'
export { openProject } from './project/openProject.mjs'
export { PROJECT_KINDS } from './kernel/projectSkeleton.mjs'
