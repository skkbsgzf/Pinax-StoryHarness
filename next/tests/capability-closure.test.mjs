import test from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { resolveClosure } from '../kernel/capabilityGraph.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { FIXTURE_EXPERIENCE, FIXTURE_NOVEL, FIXTURE_SCRIPT, FIXTURE_WORLDBOOK } from '../testing/fixtures.mjs'

function registryWith(...manifests) {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const manifest of manifests) registry.install(manifest)
  return registry
}

test('D4：主载体是小说、剧本未启用时，启用体验必须失败并给两条出路', () => {
  const registry = registryWith(FIXTURE_NOVEL, FIXTURE_SCRIPT, FIXTURE_EXPERIENCE)
  const carriers = { primary: 'fixture.novel', enabled: ['fixture.novel'], revision: 1 }
  const result = registry.setEnabled('fixture.experience', carriers, true)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'PINAX_DEPENDENCY_UNMET')
  const gap = result.error.details.gaps[0]
  assert.equal(gap.capability, 'script.scenes')
  assert.equal(gap.requiredBy, 'fixture.experience')
  assert.match(gap.fix, /剧本/)
  assert.match(gap.fix, /提案/)
  assert.deepEqual(result.error.details.repairs, [gap.fix])
})

test('D3：把剧本一起启用后闭包成立', () => {
  const registry = registryWith(FIXTURE_NOVEL, FIXTURE_SCRIPT, FIXTURE_EXPERIENCE)
  const carriers = { primary: 'fixture.novel', enabled: ['fixture.novel', 'fixture.script'], revision: 2 }
  const result = registry.setEnabled('fixture.experience', carriers, true)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.deepEqual(result.value.enabled.sort(), ['fixture.experience', 'fixture.novel', 'fixture.script'])
})

test('D3 反向：停用会被依赖的板块同样要拦（今天的老代码只查正向）', () => {
  const registry = registryWith(FIXTURE_NOVEL, FIXTURE_SCRIPT, FIXTURE_EXPERIENCE)
  const carriers = {
    primary: 'fixture.novel',
    enabled: ['fixture.novel', 'fixture.script', 'fixture.experience'],
    revision: 3
  }
  const result = registry.setEnabled('fixture.script', carriers, false)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'PINAX_DEPENDENCY_UNMET')
  assert.equal(result.error.details.gaps[0].capability, 'script.scenes')
  assert.match(result.error.message, /停用/)
})

test('C6：闭包按能力找人，第三方顶替官方剧本板块同样能过关', () => {
  const thirdPartyScript = {
    spec: 'pinax-carrier@1',
    id: 'third.script',
    title: '剧本（第三方）',
    version: '2.0.0',
    minKernel: '1',
    tier: 'carrier',
    primary: { projectKind: 'screenplay', defaultPane: 'scenes', contextProfile: 'screenplay' },
    dataDirs: { scenes: '剧本' },
    panes: [{ slot: 'center', id: 'scenes', title: '场次', icon: 'clapper' }],
    capabilities: ['script.scenes'],
    requires: [],
    tools: ['scene.read'],
    context: { providers: ['scene'], budgetChars: 20000 },
    scopes: ['file:剧本:rw']
  }
  const registry = registryWith(FIXTURE_NOVEL, thirdPartyScript, FIXTURE_EXPERIENCE)
  const activation = registry.activate({
    primary: 'fixture.novel',
    enabled: ['fixture.novel', 'third.script', 'fixture.experience'],
    revision: 1
  })
  assert.equal(activation.ok, true, JSON.stringify(activation.error ?? {}))
})

test('R4「装齐」：从体验出发的传递闭包把剧本一起拉进来', () => {
  const registry = registryWith(FIXTURE_NOVEL, FIXTURE_SCRIPT, FIXTURE_WORLDBOOK, FIXTURE_EXPERIENCE)
  const closure = resolveClosure(registry.manifests(), ['fixture.experience'])
  assert.deepEqual(closure.unresolvable, [])
  assert.deepEqual(closure.enabled.sort(), ['fixture.experience', 'fixture.script'])
})

test('R4：缺提供方时闭包给出缺口而不是静默通过', () => {
  const registry = registryWith(FIXTURE_NOVEL, FIXTURE_EXPERIENCE)
  const closure = resolveClosure(registry.manifests(), ['fixture.experience'])
  assert.equal(closure.enabled.includes('fixture.experience'), true)
  assert.equal(closure.unresolvable.length, 1)
  assert.equal(closure.unresolvable[0].capability, 'script.scenes')
  assert.equal(closure.unresolvable[0].requiredBy, 'fixture.experience')
})

test('C7：切主载体要过闭包，且未安装的候选直接拒', () => {
  const registry = registryWith(FIXTURE_NOVEL, FIXTURE_SCRIPT, FIXTURE_EXPERIENCE)
  const carriers = { primary: 'fixture.novel', enabled: ['fixture.novel', 'fixture.script', 'fixture.experience'], revision: 4 }
  const switched = registry.setPrimary('fixture.script', carriers)
  assert.equal(switched.ok, true, JSON.stringify(switched.error ?? {}))
  assert.equal(switched.value.kind, 'screenplay')
  const ghost = registry.setPrimary('fixture.nobody', carriers)
  assert.equal(ghost.ok, false)
  assert.equal(ghost.error.code, 'PINAX_PRIMARY_CARRIER_MISSING')
})
