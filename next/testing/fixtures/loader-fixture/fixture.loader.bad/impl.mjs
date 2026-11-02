/** 非法清单的最小 impl：装载器必须在「校验闸」就拦下该载体，setup 一旦被执行这里就炸——这是对「坏清单不触 impl」的反证。 */
export default {
  setup() {
    throw new Error('非法清单的 impl 不该被装载器执行')
  },
  dispose() {}
}
