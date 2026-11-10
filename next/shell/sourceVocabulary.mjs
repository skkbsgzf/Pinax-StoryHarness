/**
 * 「这一项的值是从哪儿来的」那一读的**出屏措辞**（批次68-R1 任务3）。
 *
 * 数据层那一读是真值：`next/carrierOverridesStore.mjs` 给每个生效值带上
 * `source`（stored／override／manifest／section）与一句实现口径的 `label`。
 * 那两份都归存储层，诊断输出与 `--dump-settings-schema` 都认它们——**本批一个字都不改它们**。
 *
 * 但把 label 直接摆进设置页就是行话上屏。所以这里做**显示层的一次转写**：
 * 认的是 `source` 那四个稳定标识（不认中文 label——label 改了这里会静默失效），
 * 出去的是作者那句人话。真值不动、旁路不加、也不在界面上编第二个来源。
 *
 * 四档按「作者能做出的动作」说：
 *   · stored    —— 作者在设置界面里存过这一项；
 *   · override  —— 作者改过项目里那个本机文件（`.pinax/carrier-overrides.json`），值以它为准；
 *   · manifest  —— 谁都没动过，插件自己带的那一份；
 *   · section   —— 这一项跟着所在分组走，作者没单独填过。
 * 认不出来的 source 原样透出标识本身：宁可让作者看到一个没转写的词，也不在这里编一句解释糊过去。
 */
export const SOURCE_FACE_WORDS = Object.freeze({
  stored: '项目里存过的值',
  override: '本机改过的值',
  manifest: '插件自带的默认值',
  section: '随分组走'
})

/** 存储没给 source 时的兜底：这一项还没读过生效值，那就是插件自带的那一份。 */
export const DEFAULT_SOURCE = 'manifest'

/** 生效值那一份 → 上屏那一读。 */
export function sourceFaceWord(source) {
  const key = String(source ?? '').trim()
  if (!key) return SOURCE_FACE_WORDS[DEFAULT_SOURCE]
  return SOURCE_FACE_WORDS[key] ?? key
}
