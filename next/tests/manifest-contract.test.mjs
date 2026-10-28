import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import { FIXTURE_NOVEL, withMutation } from '../testing/fixtures.mjs'

const cases = [
  ['C1 逻辑名与物理目录解耦：缺 dataDirs 即拒', (m) => { delete m.dataDirs }, 'INVALID_MANIFEST'],
  ['C1 逻辑名必须小写驼峰', (m) => { m.dataDirs = { '正文': '正文' } }, 'INVALID_MANIFEST'],
  ['C2 物理目录不得含路径分隔', (m) => { m.dataDirs = { manuscript: '../逃逸' } }, 'INVALID_MANIFEST'],
  ['C2 物理目录不得是 .pinax', (m) => { m.dataDirs = { manuscript: '.pinax' } }, 'INVALID_MANIFEST'],
  ['C3 只能为自己的 dataDirs 申请文件权限', (m) => { m.scopes = ['file:正文:rw', 'file:世界书:rw'] }, 'SCOPE_OUTSIDE_OWNER'],
  ['C5 槽位 right 是保留字（右栏归运行时）', (m) => { m.panes.push({ slot: 'right', id: 'chat', title: '聊天' }) }, 'RESERVED_SLOT'],
  ['C5 顶层菜单不得由插件注入', (m) => { m.panes.push({ slot: 'top-menu', id: 'file', title: '文件' }) }, 'RESERVED_SLOT'],
  ['C5 未知槽位拒绝', (m) => { m.panes = [{ slot: 'bottom', id: 'x', title: '底栏' }] }, 'INVALID_MANIFEST'],
  ['C6 依赖只按能力声明，词表外即拒', (m) => { m.requires = [{ capability: 'unknown.thing', min: 1, fix: '装它' }] }, 'UNKNOWN_CAPABILITY'],
  ['C6 对外提供的能力也必须在词表内', (m) => { m.capabilities = ['made.up'] }, 'UNKNOWN_CAPABILITY'],
  ['D4 缺口必须带修复路径文案', (m) => { m.requires = [{ capability: 'setting.entries', min: 1 }] }, 'INVALID_MANIFEST'],
  ['D4 修复路径为空串同样拒绝', (m) => { m.requires = [{ capability: 'setting.entries', min: 1, fix: '  ' }] }, 'INVALID_MANIFEST'],
  ['D1/C7 必须声明 primary', (m) => { delete m.primary }, 'INVALID_MANIFEST'],
  ['D2 primary.projectKind 必须是已登记类型（不许自造）', (m) => { m.primary.projectKind = 'mystery' }, 'INVALID_MANIFEST'],
  ['C8 minKernel 高于内核即拒装', (m) => { m.minKernel = '2' }, 'KERNEL_INCOMPATIBLE'],
  ['tier 固定 carrier（运行时不走这份合同）', (m) => { m.tier = 'runtime' }, 'INVALID_MANIFEST'],
  ['spec 必须是 pinax-carrier@1', (m) => { m.spec = 'pinax-carrier@2' }, 'INVALID_MANIFEST'],
  ['id 命名规则', (m) => { m.id = '小说' }, 'INVALID_MANIFEST'],
  ['工具名命名规则（C8 命名空间隔离的前半）', (m) => { m.tools = ['Chapter Read'] }, 'TOOL_CONFLICT'],
  ['未声明 scopes 即拒绝（第 7 节：白名单不是默认放行）', (m) => { delete m.scopes }, 'INVALID_MANIFEST'],
  ['agent 作用域只认 agent:ask', (m) => { m.scopes = ['file:正文:rw', 'agent:write'] }, 'INVALID_MANIFEST'],
  ['context.budgetChars 越界拒绝', (m) => { m.context = { providers: ['chapter'], budgetChars: 9_999_999 } }, 'INVALID_MANIFEST'],
  // 载体设置节（协议 P14 第二步）：声明了就必须是 [{ id, title }]，非法整份清单拒装（与其他字段同口径）。
  ['settings 声明了就必须是数组', (m) => { m.settings = { id: 'novel.writing', title: '写作偏好' } }, 'INVALID_INPUT'],
  ['settings.title 不得为空串', (m) => { m.settings = [{ id: 'novel.writing', title: '   ' }] }, 'INVALID_INPUT'],
  ['settings.title 上限 40 字', (m) => { m.settings = [{ id: 'novel.writing', title: '写'.repeat(41) }] }, 'INVALID_INPUT'],
  ['settings.id 须是载体命名空间内的小写名', (m) => { m.settings = [{ id: 'Novel Writing', title: '写作偏好' }] }, 'INVALID_INPUT'],
  ['settings.id 在同一载体内不得重复', (m) => { m.settings = [{ id: 'novel.writing', title: '写作偏好' }, { id: 'novel.writing', title: '写作偏好二' }] }, 'INVALID_INPUT'],
  ['settings 项不得多写字段（声明了却不生效的静默丢弃一律拒绝）', (m) => { m.settings = [{ id: 'novel.writing', title: '写作偏好', group: '载体' }] }, 'INVALID_INPUT']
]

for (const [title, mutate, code] of cases) {
  test(title, () => {
    const result = validateCarrierManifest(withMutation(FIXTURE_NOVEL, mutate))
    assert.equal(result.ok, false, `应当拒绝：${title}`)
    assert.equal(result.error.code, `PINAX_${code}`, result.error.message)
  })
}

test('合规清单通过并保留声明顺序', () => {
  const result = validateCarrierManifest(FIXTURE_NOVEL)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.deepEqual(result.value.dataDirs, { manuscript: '正文', outline: '大纲', notes: '构思' })
  assert.equal(result.value.panes.length, 2)
  assert.deepEqual(result.value.scopes, ['file:正文:rw', 'file:大纲:rw', 'file:构思:rw', 'agent:ask'])
})

test('缺省可选项：未声明 requires 视作无依赖', () => {
  const result = validateCarrierManifest(withMutation(FIXTURE_NOVEL, (m) => { delete m.requires }))
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.deepEqual(result.value.requires, [])
})

test('settings 声明合法即原样透传（P14：载体设置进统一目录的唯一数据源）', () => {
  // 边界一并钉住：title 恰好 40 字仍合法；第二条声明证明多条按声明顺序保留。
  const declared = [
    { id: 'novel.writing', title: '写作偏好' },
    { id: 'novel.export', title: '写'.repeat(40) }
  ]
  const result = validateCarrierManifest(withMutation(FIXTURE_NOVEL, (m) => { m.settings = declared }))
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.deepEqual(result.value.settings, declared)
})

test('settings 缺省＝空数组：没声明的载体在设置页不出目录项', () => {
  const result = validateCarrierManifest(FIXTURE_NOVEL)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.deepEqual(result.value.settings, [])
})
