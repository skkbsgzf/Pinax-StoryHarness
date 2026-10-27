/**
 * 测试夹具（fixture.*）——只给 next/tests 用，不是随包插件。
 * 真实载体从 M2 起进 next/carriers/，届时这里的用例应被真实清单替换而不是复制一份。
 */
export const FIXTURE_NOVEL = {
  spec: 'pinax-carrier@1',
  id: 'fixture.novel',
  title: '小说（夹具）',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',
  primary: { projectKind: 'novel', defaultPane: 'editor', contextProfile: 'authoring' },
  dataDirs: { manuscript: '正文', outline: '大纲', notes: '构思' },
  panes: [
    { slot: 'left-dock', id: 'chapters', title: '书稿', icon: 'outline' },
    { slot: 'center', id: 'editor', title: '正文', icon: 'book' }
  ],
  capabilities: ['text.chapters', 'outline.tree', 'notes.ideas'],
  requires: [],
  tools: ['chapter.read', 'chapter.write', 'outline.read'],
  context: { providers: ['chapter', 'outline'], budgetChars: 60000 },
  scopes: ['file:正文:rw', 'file:大纲:rw', 'file:构思:rw', 'agent:ask']
}

export const FIXTURE_WORLDBOOK = {
  spec: 'pinax-carrier@1',
  id: 'fixture.worldbook',
  title: '设定（夹具）',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',
  primary: { projectKind: 'generic', defaultPane: 'entries', contextProfile: 'worldbook' },
  dataDirs: { entries: '世界书' },
  panes: [{ slot: 'center', id: 'entries', title: '条目', icon: 'library' }],
  capabilities: ['setting.entries'],
  requires: [],
  tools: ['worldbook.list', 'worldbook.write'],
  context: { providers: ['worldbook'], budgetChars: 30000 },
  scopes: ['file:世界书:rw']
}

export const FIXTURE_SCRIPT = {
  spec: 'pinax-carrier@1',
  id: 'fixture.script',
  title: '剧本（夹具）',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',
  primary: { projectKind: 'screenplay', defaultPane: 'scenes', contextProfile: 'screenplay' },
  dataDirs: { scenes: '剧本', cast: '人物', stage: '场景' },
  panes: [{ slot: 'center', id: 'scenes', title: '场次', icon: 'clapper' }],
  capabilities: ['script.scenes', 'character.roster', 'location.board'],
  requires: [],
  tools: ['scene.read'],
  context: { providers: ['scene'], budgetChars: 40000 },
  scopes: ['file:剧本:rw', 'file:人物:rw', 'file:场景:rw']
}

/** D4 的靶子：体验板块要剧本场景，缺了就必须有出路。 */
export const FIXTURE_EXPERIENCE = {
  spec: 'pinax-carrier@1',
  id: 'fixture.experience',
  title: '体验（夹具）',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',
  primary: { projectKind: 'generic', defaultPane: 'runs', contextProfile: 'experience' },
  dataDirs: { runs: '会话' },
  panes: [{ slot: 'center', id: 'runs', title: '跑团会话', icon: 'play' }],
  capabilities: ['session.runs'],
  requires: [
    {
      capability: 'script.scenes',
      min: 1,
      fix: '启用「剧本」板块，或让运行时的既有正文出一版场景提案（写进 .pinax/proposals/）'
    }
  ],
  tools: ['session.run'],
  context: { providers: ['scene'], budgetChars: 20000 },
  scopes: ['file:会话:rw', 'agent:ask']
}

export function clone(manifest) {
  return JSON.parse(JSON.stringify(manifest))
}

export function withMutation(manifest, mutate) {
  const copy = clone(manifest)
  mutate(copy)
  return copy
}
