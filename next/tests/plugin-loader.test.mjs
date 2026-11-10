import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
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

test('⑤ 守卫：pluginLoader 三个装载器同文件 ≤360 行，acceptance 的「装载原型」记账条在链上', async () => {
  const loaderSource = await readFile(new URL('../kernel/pluginLoader.mjs', import.meta.url), 'utf-8')
  assert.ok(loaderSource.includes('export async function loadCarriersFromDir'))
  // 计数变化理由（批次65a）：60 行是桩2 打桩的上限；正式化把「声明型装载器」放进了同一文件——
  // 两个装载器共用 readdir/JSON/@4 校验的骨架，只差形态闸一步，拆成第二个文件会立起第二份真相。
  // 上限放到 150 行，并钉住声明型装载器与「绝不执行第三方 JS」的形态拒装段都在。
  assert.ok(loaderSource.includes('export async function loadDeclarativeFromDir'))
  assert.ok(loaderSource.includes("stage: 'form'"), '带 impl.mjs 的目录必须按形态拒装，不许静默忽略')
  // 计数变化理由（批次65b · 框架计划 J2）：第三个装载器（随包 .mjs 载体）也落进同一文件——
  // 它复用的正是前两个的 readdir 骨架与 registry.install 合同，只多一段「双轨货架定位」与
  // 「按约定挑导出」；拆出去会让「装载」这件事有两个家。上限 150 → 360 行。
  assert.ok(loaderSource.includes('export async function loadBuiltInCarriersFromDir'), '随包载体装载器必须在同一个文件里')
  assert.ok(loaderSource.includes('export async function resolveBuiltInCarriersDir'), '双轨定位只许这一个函数')
  assert.ok(loaderSource.trimEnd().split('\n').length <= 360, '批次65b 上限 360 行（三个装载器同文件）')
  const acceptanceSource = await readFile(new URL('../testing/acceptance.mjs', import.meta.url), 'utf-8')
  assert.match(acceptanceSource, /装载原型：fixture 装入→registry 可见→卸载干净/u, '本批只记账不打回：acceptance 必须有这条 record')
})

/**
 * 批次65b 新增守卫（框架计划 J2：一切从磁盘装载，内置只是「随包已安装」）。
 * 三条都是「防止改回去」的钉：静态 import 复活、装载路径长出第二个家、id 清单与货架脱节。
 */
test('⑥ 守卫：载体实现（manifest/tools/context）不再被装载链路静态 import', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  // 排除：货架自己（载体目录内部互 import 是它的常态）、装载器与测试/验收轨。
  const skipDirs = new Set(['.build', 'node_modules', 'dist', 'carriers', 'tests', 'testing'])
  const pattern = /from\s+['"][^'"]*\/carriers\/[^'"]+\/(?:manifest|tools|context)\.mjs['"]/gu
  const found = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) await walk(join(dir, entry.name))
        continue
      }
      if (!entry.name.endsWith('.mjs')) continue
      const path = join(dir, entry.name)
      const source = await readFile(path, 'utf-8')
      if (pattern.test(source)) found.push(relative(root, path).replace(/\\/g, '/'))
      pattern.lastIndex = 0
    }
  }
  await walk(root)
  // 已知残留（批次65b 范围外，工单未授权改这两份文件）：它们 import 的是**清单常量**
  // （DOSSIER_LEGACY_IDS／OUTLINE_CARRIER_ID），不是工具实现，装载链路不经过它们。
  // 这条断言判的是「不许再多一个」：新出现的名字必须先把这两份一起清掉。
  const KNOWN_RESIDUALS = ['project/openProject.mjs', 'runtime/outlineImportService.mjs']
  assert.deepEqual(found.sort(), [...KNOWN_RESIDUALS].sort(), `静态 import 载体清单文件的文件数不许增加（J2：加一块载体不改 9 个文件）：${JSON.stringify(found)}`)
  const shellSource = await readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8')
  assert.doesNotMatch(shellSource, /^\s*import\s.+\bfrom\s+['"][^'"]*carriers\//mu, 'DoD 的 grep -rn "from \'../carriers/" 归零常驻化：主进程不碰 carriers')
})

test('⑦ 守卫：装载路径单一函数；随包 id 清单与盘上货架一致', async () => {
  // 双轨定位只有一个家：货架清单文件自己不许拼路径、不许读 env，只调用 resolveBuiltInCarriersDir。
  const indexSource = await readFile(new URL('../carriers/index.mjs', import.meta.url), 'utf-8')
  assert.doesNotMatch(indexSource, /PINAX_NEXT_CARRIERS_DIR/u, 'env 覆盖的读取只在 resolveBuiltInCarriersDir 里')
  assert.doesNotMatch(indexSource, /from\s+'node:path'/u, '货架清单不许自己拼装载路径（定位只认装载器那一个函数）')
  const { resolveBuiltInCarriersDir } = await import('../kernel/pluginLoader.mjs')
  const { BUILT_IN_CARRIER_IDS, loadBuiltInCarriers } = await import('../carriers/index.mjs')
  const shelf = await resolveBuiltInCarriersDir()
  const onDisk = []
  for (const entry of await readdir(shelf, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const hasManifest = await readFile(join(shelf, entry.name, 'manifest.mjs'), 'utf-8').then(() => true, () => false)
    if (hasManifest) onDisk.push(entry.name)
  }
  assert.equal(onDisk.length, BUILT_IN_CARRIER_IDS.length, `货架目录数 ${onDisk.length} 与随包 id 清单 ${BUILT_IN_CARRIER_IDS.length} 必须一致：${JSON.stringify(onDisk)}`)
  const { loaded, skipped } = await loadBuiltInCarriers()
  assert.deepEqual(skipped, [], JSON.stringify(skipped))
  assert.deepEqual(loaded.map((item) => item.manifest.id), [...BUILT_IN_CARRIER_IDS], '装载顺序＝随包 id 清单顺序（竖条顺序＝注册顺序）')
})
