import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { loadCarriersFromDir } from '../kernel/pluginLoader.mjs'
import { trace } from '../testing/fixtures/loader-fixture/fixture.loader.good/impl.mjs'

/**
 * 批次64 · 装载原型可行性打桩（桩2 前置）。
 * 只在 node --test 里跑：不起 Electron、不碰内置 11 块——判的是「目录发现装载 + 既有
 * registry.install/dispose/registerEffect 合同」这条路对外部 JSON 清单走不走得通。
 */

const FIXTURE_DIR = fileURLToPath(new URL('../testing/fixtures/loader-fixture', import.meta.url))
const GOOD_ID = 'fixture.loader.good'

test('① 合法 @4 清单装入：registry 可见、安装目录登记（registry.install 吃外部 JSON 清单没有硬障碍）', async () => {
  const registry = createRegistry()
  const result = await loadCarriersFromDir(FIXTURE_DIR, { registry })
  assert.equal(result.loaded.length, 1, JSON.stringify(result.skipped))
  assert.equal(result.loaded[0].carrierId, GOOD_ID)
  const manifest = registry.get(GOOD_ID)
  assert.ok(manifest, 'registry 应读到装载进来的归一清单')
  assert.equal(manifest.spec, 'pinax-carrier@4')
  assert.deepEqual(manifest.tools, [], 'tools 空数组照装')
  assert.equal(registry.dirOf(GOOD_ID), join(FIXTURE_DIR, 'fixture.loader.good'), 'meta.dir 要落进 registry（v3 相对路径解析基准）')
})

test('② 非法清单跳过且记账：skipped 带 stage/code，整批不垮，合法载体照常装入；坏清单的 impl 从不被执行', async () => {
  const registry = createRegistry()
  trace.length = 0
  const result = await loadCarriersFromDir(FIXTURE_DIR, { registry })
  const bad = result.skipped.find((entry) => entry.carrierId === 'fixture.loader.bad')
  assert.ok(bad, '坏清单必须被记账而不是静默丢')
  assert.equal(bad.stage, 'manifest')
  assert.equal(bad.code, 'PINAX_INVALID_MANIFEST')
  assert.equal(result.loaded.length, 1, '一份坏清单不拖垮整批')
  assert.equal(registry.get('BAD-UPPER'), null)
  assert.equal(registry.rejected.length, 0, '校验闸在 loader 前置：坏清单根本不该走到 install')
  assert.deepEqual(trace, ['setup'], '只有合法载体的 impl.setup 被执行过（坏清单的 impl 不许被 import）')
})

test('③ 空目录／不存在的目录 → 空结果不炸；registry 不注入时只返回装载结果', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'pinax-loader-empty-'))
  const result = await loadCarriersFromDir(empty, { registry: createRegistry() })
  assert.deepEqual(result, { loaded: [], skipped: [] })
  const missing = await loadCarriersFromDir(join(empty, '根本没有这个目录'), { registry: createRegistry() })
  assert.deepEqual(missing, { loaded: [], skipped: [] })
  const bare = await loadCarriersFromDir(FIXTURE_DIR)
  assert.equal(bare.loaded.length, 1, '不注入 registry：校验通过的清单照样出装载结果')
  assert.equal(bare.loaded[0].manifest.id, GOOD_ID)
  assert.equal(typeof bare.loaded[0].impl.setup, 'function', '无 registry 时 impl 句柄随结果返回')
  assert.equal(bare.skipped.length, 1, '坏清单在无 registry 路径上同样被跳过并记账')
})

test('④ 卸载 → dispose 链跑完：impl.dispose → onDispose 钩子 → 效应逆序回卷（批次51 registerEffect 语义），卸后 registry 干净', async () => {
  const registry = createRegistry()
  trace.length = 0
  await loadCarriersFromDir(FIXTURE_DIR, { registry })
  assert.deepEqual(trace, ['setup'], '装载期 setup 经 registerEffect 立即执行')
  assert.equal(registry.effectCount(GOOD_ID), 1, 'impl.setup 交回的 disposer 要进效应栈')

  const removed = registry.uninstall(GOOD_ID)
  assert.equal(removed.ok, true)
  assert.deepEqual(trace, ['setup', 'impl', 'hook', 'effect'], 'dispose 链三段齐跑：impl.dispose → onDispose 钩子 → 效应回卷')
  assert.equal(registry.get(GOOD_ID), null, '卸载后清单不再可见')
  assert.equal(registry.effectCount(GOOD_ID), 0, '效应栈不许留残')
})

test('⑤ 守卫：pluginLoader 存在且 ≤150 行，acceptance 的「装载原型」记账条在链上', async () => {
  const loaderSource = await readFile(new URL('../kernel/pluginLoader.mjs', import.meta.url), 'utf-8')
  assert.ok(loaderSource.includes('export async function loadCarriersFromDir'))
  // 计数变化理由（批次65a）：60 行是桩2 打桩的上限；正式化把「声明型装载器」放进了同一文件——
  // 两个装载器共用 readdir/JSON/@4 校验的骨架，只差形态闸一步，拆成第二个文件会立起第二份真相。
  // 上限放到 150 行，并钉住声明型装载器与「绝不执行第三方 JS」的形态拒装段都在。
  assert.ok(loaderSource.includes('export async function loadDeclarativeFromDir'))
  assert.ok(loaderSource.includes("stage: 'form'"), '带 impl.mjs 的目录必须按形态拒装，不许静默忽略')
  assert.ok(loaderSource.trimEnd().split('\n').length <= 150, '批次65a 上限 150 行（两个装载器同文件）')
  const acceptanceSource = await readFile(new URL('../testing/acceptance.mjs', import.meta.url), 'utf-8')
  assert.match(acceptanceSource, /装载原型：fixture 装入→registry 可见→卸载干净/u, '本批只记账不打回：acceptance 必须有这条 record')
})
