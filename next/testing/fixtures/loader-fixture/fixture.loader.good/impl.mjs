/**
 * 批次64 装载原型夹具（合法载体的最小 impl）。
 * trace 是本模块的共享记账数组：装载器经动态 import 与测试直引拿到的是同一实例，
 * 「dispose 链跑完」就靠它做可观测证据（不靠「没报错」间接判，同批次51 纪律）。
 */
export const trace = []

export default {
  setup() {
    trace.push('setup')
    return () => trace.push('effect')
  },
  dispose() {
    trace.push('impl')
  },
  onDispose() {
    trace.push('hook')
  }
}
