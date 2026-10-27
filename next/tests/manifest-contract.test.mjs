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
  ['context.budgetChars 越界拒绝', (m) => { m.context = { providers: ['chapter'], budgetChars: 9_999_999 } }, 'INVALID_MANIFEST']
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
