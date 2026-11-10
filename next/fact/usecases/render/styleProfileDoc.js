/**
 * 随仓文风档案（P-STYLE）：把 `novel-style-profiles/*.json` 读成 styleSpec。
 *
 * 为什么档案是 JSON 而不是 md：档案里只有**派生量**（统计量、区间推导、短约束短语），
 * 这些是渲染器直接吃的结构化数据；原始蒸馏产物（四份 md）留在作者本机，不入仓。
 * 代表句（samples）也刻意不在仓里——那是第三方作品原句，版权归原作者；
 * 需要语感校准时就地调 `pickStyleSamples` 从本机语料现取，不进版本库。
 *
 * 本模块不读盘：档案由调用方读好传进来（宿主侧 fs 在 runtime/shell 那层），
 * 于是 fact 域仍保持「只 import 域内相对路径」的静态边界。
 */

export const STYLE_PROFILE_SCHEMA = 'pinax-style-profile/v1'

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

/**
 * 校验一份档案（形状 + 版权纪律）。
 * @returns {{ok:boolean, errors:string[], warnings:string[], spec:Object|null}}
 */
export function validateStyleProfileDocument(document) {
  const errors = []
  const warnings = []
  const doc = isPlainObject(document) ? document : {}
  if (str(doc.$schema).trim() !== STYLE_PROFILE_SCHEMA) {
    errors.push(`$schema 必须是 ${STYLE_PROFILE_SCHEMA}，实际「${str(doc.$schema) || '(空)'}」`)
  }
  const profile = isPlainObject(doc.profile) ? doc.profile : null
  if (!profile) {
    errors.push('缺 profile（统计量与约束的载体）')
  } else {
    if (!str(profile.name).trim()) errors.push('profile.name 为空')
    if (!isPlainObject(profile.targets)) errors.push('profile.targets 缺失')
    if (!isPlainObject(profile.constraints)) errors.push('profile.constraints 缺失')
    // 缺项清单是诚实账：档案自己声明哪些抽不到，不能让读者以为全都有
    if (!Array.isArray(profile.missing)) warnings.push('profile.missing 缺失：无法判断这份档案有哪些统计量没抽到')
  }
  const spec = isPlainObject(doc.spec) ? doc.spec : null
  if (!spec) {
    errors.push('缺 spec（渲染器直接吃的 styleSpec）')
  } else {
    if (!str(spec.name).trim()) errors.push('spec.name 为空')
    // 版权红线：档案里不许带代表句
    if (Array.isArray(spec.samples) && spec.samples.length > 0) {
      errors.push(`spec.samples 有 ${spec.samples.length} 条：档案不入仓第三方原文，代表句必须由调用方本地现取`)
    }
    if (!isPlainObject(spec.constraints)) errors.push('spec.constraints 缺失')
  }
  if (isPlainObject(doc.samplePolicy) && doc.samplePolicy.inRepo === true) {
    errors.push('samplePolicy.inRepo=true 与版权纪律冲突：原文代表句不入仓')
  }
  return { ok: errors.length === 0, errors, warnings, spec: spec ?? null }
}

/**
 * 取一份档案的 styleSpec，并按需叠上调用方本地取的 samples。
 *
 * @param {Object} document 档案 JSON
 * @param {{samples?: string[], layers?: string[], name?: string}} [options]
 * @returns {{ok:true, spec:Object}|{ok:false, errors:string[]}}
 */
export function styleSpecFromDocument(document, options = {}) {
  const checked = validateStyleProfileDocument(document)
  if (!checked.ok) return { ok: false, errors: checked.errors }
  const opts = isPlainObject(options) ? options : {}
  const base = checked.spec
  const spec = {
    ...base,
    constraints: {
      forbidden: Array.isArray(base.constraints?.forbidden) ? [...base.constraints.forbidden] : [],
      required: Array.isArray(base.constraints?.required) ? [...base.constraints.required] : []
    },
    targets: isPlainObject(base.targets) ? { ...base.targets } : {},
    // 代表句只从调用方来（本地语料现取），档案里那一条永远是空的。
    samples: (Array.isArray(opts.samples) ? opts.samples : []).map((item) => str(item).trim()).filter(Boolean)
  }
  if (str(opts.name).trim()) spec.name = str(opts.name).trim()
  // 按层裁剪：只挂 L1 时把结构/视角类 required 摘掉（档案里 L1 是 targets＋禁则）。
  if (Array.isArray(opts.layers) && opts.layers.length && opts.layers.length < 3) {
    const keepStructure = opts.layers.includes('L2')
    const keepPerspective = opts.layers.includes('L3-5')
    spec.constraints.required = spec.constraints.required.filter((item) => {
      const isStructure = /^[[〔]|→|章末|场景落位|转场/u.test(item)
      const isPerspective = /视角|POV|限知|读者信息|切入点|情感基调|价值/u.test(item)
      if (isStructure) return keepStructure
      if (isPerspective) return keepPerspective
      return true
    })
    spec.layers = [...opts.layers]
  }
  return { ok: true, spec }
}

/** 档案清单的形状（宿主按文件名列出可选文风用）。 */
export function describeStyleProfileInput({ fileName = '', document = null } = {}) {
  const doc = isPlainObject(document) ? document : {}
  const profile = isPlainObject(doc.profile) ? doc.profile : {}
  const checked = document ? validateStyleProfileDocument(document) : { ok: false, errors: ['未提供档案'] }
  return {
    fileName: str(fileName),
    name: str(profile.name),
    digest: str(profile.digest),
    ok: checked.ok === true,
    errors: checked.errors,
    missing: Array.isArray(profile.missing) ? [...profile.missing] : [],
    metrics: isPlainObject(profile.metrics) ? { ...profile.metrics } : {},
    layers: Array.isArray(doc.layerAdvice?.layers) ? [...doc.layerAdvice.layers] : []
  }
}
