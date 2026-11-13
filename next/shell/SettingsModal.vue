<script setup>
import { computed, nextTick, ref, watch, onBeforeUnmount } from 'vue'
import WorkbenchModal from './WorkbenchModal.vue'
import CarrierSettingsGeneric from './settings/CarrierSettingsGeneric.vue'
import SkillsSection from './settings/SkillsSection.vue'
import OverviewSection from './settings/OverviewSection.vue'
import AppearanceSection from './settings/AppearanceSection.vue'
import WritingSection from './settings/WritingSection.vue'
import HotkeysSection from './settings/HotkeysSection.vue'

/**
 * SettingsModal（工单C0 · U13 作者裁定）：统一的二级页面。
 * 设置／配置类功能不再各开各的弹窗，一律收进这一枚：左栏是设置分区目录（索引），
 * 右栏是当前节的设置项面板——解剖照 IDE/ZCode 设置页与老前端 SettingsPopup
 * （src/components/workbench/SettingsPopup.vue：左栏 nav.settings-navigation，
 * 右栏 section.settings-section，.modal-fade-* 过渡）。
 *
 * 工单B（作者裁定：参照 Obsidian 设置页）：目录按 group 分组渲染（应用／项目／文档，
 * 载体声明的设置节归「载体」组），组标题只用 token；目录顶部一枚搜索框，按
 * 目录项标题＋注册表里的已知关键词做浅匹配（v1 不做渲染文本深搜）。
 *
 * 底座是 WorkbenchModal（遮罩／圆角／Esc／过渡原样沿用，props open/dismissable/title 透传）。
 * 目录表 props.sections = [{ id, title, group?, keywords?, component, props? }] 注册——分三组：
 * 「应用」偏好与模型／备份与恢复；「项目」载体管理／导入既有稿／新建项目／主载体选择；
 * 「文档」文档历史／提案审阅（后者是工单B1：协议 v1.1-B 把提案审阅从小说板索引窗迁来这里，
 * 目录项与内容组件由 AppNext 的 settingsSections 注册，本组件只按 group 归组渲染，不写死节名）。
 * 载体设置（协议 P14 第二步）：props.carriers 的每块载体按它清单里真声明的设置节
 * （settings: [{ id, title }]）在目录里出目录项（「载体」组，文案照声明的 title）；
 * 声明为空数组的载体不占目录格（批次20 按载体标题伪造的占位节已删）。
 * P14 第三步（工单B）：内容组件由外壳经 props.carrierSectionComponents 注入——
 * 以「声明 id」为键查表（{ component, props }），查到就渲染真内容，查不到仍出空态；
 * 合并逻辑放在这里（声明 → 目录项）而不是 AppNext：目录本来就从载体清单现算，
 * 组件表只是同一个键上的附加物；AppNext 只负责提供组件与当前偏好 props。
 * 未登记的功能不许开弹窗（门禁：next/tests/visual-contract.test.mjs「目录外弹窗不允许存在」的机器版）。
 * 分组标签和目录项同在 tablist 里：标签是 <p>，不是 tab，不参与 roving tabindex；搜索框在 tablist 之外。
 * 〔批次68-R4 任务1〕只有一节的组不再出标签（技能／载体拍平，见 declaredGroupSize）。
 *
 * 键盘语义取老版 tablist 的那半：目录 roving tabindex＋方向键换节（SettingsPopup.vue:489-501）。
 * 焦点陷阱（批次15 B · 差异表 #10；取代批次13 记账里「trapFocusWithin 不在 Next 落地、Tab 走浏览器默认顺序」
 * 那句旧说法）：打开时由底座 WorkbenchModal 对面板根起 next/shell/focusTrap.mjs 的陷阱——
 * 焦点先收进面板、Tab 在面板内可聚焦元素之间循环、关闭/卸载时摘监听并归还打开前的焦点；
 * Esc 仍归 WorkbenchModal。老版 src/ 的 trapFocusWithin 是 composable，薄渲染层门禁不许引，
 * 这里是 next/ 内的纯 DOM 重写（同一行为，不引旧轨）。
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  dismissable: { type: Boolean, default: true },
  title: { type: String, default: '设置' },
  activeSection: { type: String, default: '' },
  /** 目录表：[{ id, title, group?, keywords?, component, props? }]。 */
  sections: { type: Array, default: () => [] },
  /** 载体声明节的内容组件表（P14 第三步）：{ [声明 id]: { component, props } }。 */
  carrierSectionComponents: { type: Object, default: () => ({}) },
  /** 视图里的载体清单：[{ id, title, dataDirs?, settings? }]——settings 是清单里真声明的设置节（P14）。 */
  carriers: { type: Array, default: () => [] },
  /** IPC 桥：通用渲染器要经 settings:load／settings:save 读写项目级配置。 */
  bridge: { type: Object, default: null }
})
const emit = defineEmits(['close', 'changed', 'theme', 'set-enabled', 'set-primary', 'toggle-companion', 'writing-prefs', 'update:activeSection'])

/* —— 键盘与焦点（前端工单 B-4）——————————————————————————————————————
 * Esc 三级：搜索框有词先清空（stopImmediatePropagation，底座 WorkbenchModal 收不到就不会关弹窗）；
 * 没词放行给底座（它 emit close）。
 * 监听挂 window 的 capture 阶段：底座的 Esc 监听也挂在 window（WorkbenchModal.vue:58-61），
 * 同一目标上 capture 先于 bubble，所以这里能先一步拦下带词的 Esc。
 * （挂在面板根上的 @keydown.capture 收不到「事件直接派发到 window」的键盘——焦点不在面板里时
 *  比如刚打开那一拍，事件目标是 body/window，走不到元素路径，那条实现曾因此整案不生效。）
 * 焦点：打开时落当前节标题（落不到就落目录第一项），关闭后归还给打开前的元素。 */
const panelRoot = ref(null)
let lastFocused = null
function onGlobalKeydown(event) {
  if (event.key !== 'Escape' || !props.open) return
  if (!searchQuery.value.trim()) return
  event.stopImmediatePropagation()
  event.preventDefault()
  clearSearch()
}
watch(() => props.open, (open) => {
  if (open) {
    lastFocused = document.activeElement
    window.addEventListener('keydown', onGlobalKeydown, true)
    void nextTick(() => {
      const title = panelRoot.value?.querySelector('[data-test-panel-title]')
      if (title) { title.focus?.(); return }
      panelRoot.value?.querySelector('input, button')?.focus()
    })
  } else {
    window.removeEventListener('keydown', onGlobalKeydown, true)
    if (lastFocused && document.contains(lastFocused)) {
      lastFocused.focus?.()
      lastFocused = null
    }
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown, true))

/** 目录搜索（工单B）：左栏按词表滤；右栏同进同退（见下面 panelSection 那条〔批次76 任务4-2〕）。 */
const searchQuery = ref('')

/**
 * 载体设置节（协议 P14 第二步＋第三步）：目录格完全由清单里的 settings 声明决定——
 * 一条声明出的一格，文案照声明的 title；settings 为空数组（或没声明）的载体不出格。
 * 节 id 拼成 `carrier:<载体 id>:<声明 id>`：声明 id 只在载体自己的命名空间里唯一，跨载体可能同名，
 * 拼上载体前缀才能当全局目录键（DOM id／activeSection／搜索命中都用这一份）。
 * 内容组件按「声明 id」查 props.carrierSectionComponents（工单B：novel.writing → WritingPrefsSection）：
 * 查到就是 kind:'carrier-settings-content'（右栏渲染真内容），查不到仍是空态（不伪造设置项）。
 * 〔工单 P8 · B-7，作者 2026-11-13 设置图谱裁定〕写作排版迁应用级「写作」节（builtInSections），
 * SUPPRESSED_CARRIER_SETTING_IDS 里的声明虽然保留在载体清单里，但不再从载体组发目录项——
 * 同一项设置只留一个入口，不让目录里出现两格同名内容。
 *
 * 批次45：没有专属组件、但声明了受支持类型的（section／string／number／boolean／enum），
 * 走通用渲染器 CarrierSettingsGeneric，值读写当前项目的 .pinax/settings.json；
 * 连类型都没声明的（老测试里的裸 { id, title }）仍是空态——注册制不为它编造控件。
 */
const GENERIC_SETTING_TYPES = new Set(['section', 'string', 'number', 'boolean', 'enum'])

/** 迁移后不再由载体组发出的声明 id（见上方 B-7 注）；声明本身留在载体的 settings 清单里。 */
const SUPPRESSED_CARRIER_SETTING_IDS = new Set(['novel.writing'])

const carrierSections = computed(() => props.carriers.flatMap((carrier) => {
  if (!carrier?.id || !carrier?.title) return []
  const declared = Array.isArray(carrier.settings) ? carrier.settings : []
  return declared
    .filter((setting) => setting?.id && setting?.title && !SUPPRESSED_CARRIER_SETTING_IDS.has(setting.id))
    .map((setting) => {
      const mapped = props.carrierSectionComponents?.[setting.id] ?? null
      const generic = !mapped?.component && GENERIC_SETTING_TYPES.has(setting.type)
      const section = {
        id: `carrier:${carrier.id}:${setting.id}`,
        title: setting.title,
        group: '载体',
        kind: mapped?.component || generic ? 'carrier-settings-content' : 'carrier-settings',
        carrierId: carrier.id,
        settingId: setting.id,
        // 浅匹配只用已知字段：载体标题／声明标题／「设置」／它认领的数据目录名，
        // 再加上内容组件自己报上来的字段标签（〔批次76 任务4-2〕mapped.keywords）——仍不做渲染文本深搜。
        keywords: [carrier.title, setting.title, '设置', ...(Array.isArray(mapped?.keywords) ? mapped.keywords : []), ...(Array.isArray(carrier.dataDirs) ? carrier.dataDirs : [])]
      }
      if (mapped?.component) {
        section.component = mapped.component
        section.props = mapped.props ?? {}
      } else if (generic) {
        section.component = CarrierSettingsGeneric
        section.props = { bridge: props.bridge, carrierId: carrier.id, carrierTitle: carrier.title, setting }
      }
      return section
    })
}))

/**
 * 外壳自己的内置节（批次77 任务5 · 技能库）。
 *
 * 注册点为什么在弹窗这一层：AppNext 那份 <code>settingsSections</code> 是「应用／项目／文档」三组的宿主，
 * 工单没把它划进允许文件；本节又不该只能从菜单命令进设置。目录表本来就是 <code>[props.sections, 载体声明节]</code>
 * 两段拼出来的，中间插一段内置节是这一层已有的形状（载体节的 group 也是在这里现算的，不在 AppNext 写死）。
 * 分组给「技能」而不是塞进「项目」：组序按首次出现算，插进 项目 会把既有目录的节序整体推后一格——
 * 那条节序是 shell-ui 用例钉着的规格，不是可以顺手挪的排版。
 * 〔批次68-R4 任务1〕这一组只有一节，组头随之拍平（目录里只出「技能库」这一格，不多一行不能点的「技能」）。
 *
 * 〔工单 P2-4〕设置总览也在这里注册（只读：层/文件/当前值一张表＋「复制为 JSON」）。
 * 它挂在「应用」组最底部——组已由宿主注册过，追加到该组尾部即可，不会把别的组整体推后。
 * 前提判据取「宿主到底注册了应用级节没有」：settingsSections 为空的用法是单节预览
 * （skills-section／载体设置节的直挂用例），那种场合凭空造一个「应用」组会把目录说错，
 * 所以此时不挂这一节；真外壳（AppNext）永远有应用级节，总览照常出现。
 * 不新增设置项：这一节只读 prefs:get 的结果，自身不写任何东西。
 */
const hostHasAppSections = computed(() => props.sections.some((section) => section?.group === '应用'))

/**
 * 〔工单 P8 · B-6／B-7／B-8，作者 2026-11-13 设置图谱裁定〕三个新节也在这里注册：
 *   · 外观（应用组，紧随意「偏好与模型」之后）——主题＋界面缩放；
 *   · 写作（应用组，紧随外观）——六项排版偏好（从载体声明的 novel.writing 迁来）；
 *   · 快捷键（项目组，紧随「库设置（模块管理）」）——键位存在当前库里，随库走。
 * 注册点为什么在弹窗这一层：宿主 AppNext 的 settingsSections 不在本工单允许文件里；
 * 目录表本来就是「宿主节＋内置节＋载体声明节」三段拼的，中间插内置节是这一层已有的形状。
 * 三节都自己经 bridge 读数据（不依赖宿主灌 props），所以这里只需要一枚桥。
 * 插入位置按锚点 id 现算（见 allSections）：组的顺序与节序都是 shell-ui 钉着的规格。
 */
const builtInSections = computed(() => {
  const list = [{
    id: 'skills',
    title: '技能库',
    group: '技能',
    // 浅匹配词表（批次76 任务4-2 口径：字段标签进词表）。技能域的名字都在这一列，作者搜「编剧」也该找到这格。
    keywords: ['技能', '技能库', 'skill', '启停', '停用', '导入技能', '方法说明书', '适用任务域', '正文写作', '编剧', '世界书整理', '审阅验收', '未分域', '风格'],
    component: SkillsSection,
    props: { bridge: props.bridge }
  }]
  if (hostHasAppSections.value) {
    list.push({
      id: 'appearance',
      title: '外观',
      group: '应用',
      keywords: ['外观', '主题', '明暗', '浅色', '深色', '界面缩放', '缩放', '换肤'],
      component: AppearanceSection,
      props: { bridge: props.bridge }
    })
    list.push({
      id: 'writing',
      title: '写作',
      group: '应用',
      keywords: ['写作', '写作偏好', '排版', '正文字号', '字号', '正文行高', '行高', '段落间距', '首行缩进', '打字机滚动', '段落聚焦'],
      component: WritingSection,
      props: { bridge: props.bridge }
    })
    list.push({
      id: 'hotkeys',
      title: '快捷键',
      group: '项目',
      keywords: ['快捷键', '键位', '组合键', '按键', '录入', '恢复默认', '冲突', '库设置'],
      component: HotkeysSection,
      props: { bridge: props.bridge }
    })
    list.push({
      id: 'overview',
      title: '设置总览',
      group: '应用',
      keywords: ['设置总览', '总览', '只读', '排查', '迁移', '当前值', '复制为 JSON', '配置清单'],
      component: OverviewSection,
      props: { bridge: props.bridge }
    })
  }
  return list
})

/** 新内置节的锚点：注册表本身不保证宿主节的顺序，插入位置按锚点 id 现算。 */
const ANCHORED_SECTION_IDS = new Set(['appearance', 'writing', 'hotkeys'])

/**
 * 目录全表：宿主节 → 内置节（外观／写作插在「偏好与模型」后，快捷键插在「库设置（模块管理）」后，
 * 其余内置节追加在宿主节之后）→ 载体声明节。
 * 锚点缺失时新节仍追加在后面（不吞入口）；锚点存在时不重复插入。
 */
const allSections = computed(() => {
  const builtIns = builtInSections.value
  const inserted = new Set()
  const merged = []
  for (const section of props.sections) {
    merged.push(section)
    if (section.id === 'prefs') {
      for (const extra of builtIns) {
        if (extra.id !== 'appearance' && extra.id !== 'writing') continue
        merged.push(extra)
        inserted.add(extra.id)
      }
    } else if (section.id === 'carriers') {
      for (const extra of builtIns) {
        if (extra.id !== 'hotkeys') continue
        merged.push(extra)
        inserted.add(extra.id)
      }
    }
  }
  for (const extra of builtIns) {
    if (ANCHORED_SECTION_IDS.has(extra.id) && !inserted.has(extra.id)) merged.push(extra)
  }
  const tail = builtIns.filter((section) => !ANCHORED_SECTION_IDS.has(section.id))
  return [...merged, ...tail, ...carrierSections.value]
})

/** 当前节：目录里没有的 id 回落第一节，右栏不出现空窗。 */
const current = computed(() => allSections.value.find((section) => section.id === props.activeSection) ?? allSections.value[0] ?? null)
const currentProps = computed(() => current.value?.props ?? {})

const normalizedQuery = computed(() => searchQuery.value.trim().toLowerCase())

/**
 * 〔批次76 任务4-2〕右栏那一节到底给不给看，跟着搜索走。
 * 原判据自陈「搜索不过滤当前节（右栏不跟着空）」，实测就是作者点出来的自相矛盾：
 * 输「字号」时左目录空了，右栏却还挂着含「正文字号」的那一节——目录说没有，内容说有。
 * 现在两栏同进同退：查询把当前节滤出去了，右栏就换成一问一答的空态（带「清除搜索」的退路），
 * 不再让一栏装聋。D1 硬闸（needsPrimary 落 primary 且不可关）不受影响：那是「没有查询词」的那一档。
 */
const panelSection = computed(() => {
  const section = current.value
  if (!section) return null
  if (normalizedQuery.value && !matchesQuery(section)) return null
  return section
})

/** 浅匹配（v1）：目录项标题＋注册表里的已知标题/描述关键词；不读挂载后的渲染文本。 */
function matchesQuery(section) {
  if (!normalizedQuery.value) return true
  const fields = [section.title, ...(section.keywords ?? [])]
  return fields.some((text) => String(text ?? '').toLowerCase().includes(normalizedQuery.value))
}

const visibleSections = computed(() => allSections.value.filter(matchesQuery))

/**
 * 〔批次68-R4 任务1〕组头的去留看「这一组声明里真有几节」，且判据取静态结构而不是搜索过滤后的可见数。
 * 为什么不能用可见数：搜「备份」时「应用」组只剩一格可见，那是查询滤出来的临时形状，
 * 组头跟着消失会让作者以为应用类设置真的只剩备份这一项（shell-ui 用例把「搜『备份』仍出『应用』」钉成规格）。
 * 单节组拍平（技能→技能库、载体→写作偏好）：组头与那一格同义，留着的是一行不能点、也说不清话的字。
 * 「应用」组头保留：它底下是三节（偏好与模型／备份与恢复／服务与通知），与任何单节都不同义，
 * 不是排版上的赘物——这一条判据按工单任务1 的「同义才删」执行。
 */
const declaredGroupSize = computed(() => {
  const sizes = new Map()
  for (const section of allSections.value) {
    const name = section.group ?? '设置'
    sizes.set(name, (sizes.get(name) ?? 0) + 1)
  }
  return sizes
})

/** 按 group 归组（同组只出一个标题；组序取首次出现顺序，不要求注册表里连续）。 */
const groupedSections = computed(() => {
  const order = []
  const groups = new Map()
  for (const section of visibleSections.value) {
    const name = section.group ?? '设置'
    if (!groups.has(name)) {
      groups.set(name, [])
      order.push(name)
    }
    groups.get(name).push(section)
  }
  return order.map((name) => ({ name, items: groups.get(name), labeled: (declaredGroupSize.value.get(name) ?? 0) >= 2 }))
})

const visibleIds = computed(() => visibleSections.value.map((section) => section.id))

/** roving tabindex 的 0 位：当前节被搜索滤掉时落到第一个可见项（右栏同进同退，见 panelSection）。 */
const focusId = computed(() => (visibleIds.value.includes(current.value?.id) ? current.value.id : visibleIds.value[0] ?? null))

function select(id) {
  if (id !== props.activeSection) emit('update:activeSection', id)
}

/** 空态那条退路：清掉查询词，两栏一起回到「没在搜」的样子。 */
function clearSearch() {
  searchQuery.value = ''
}

/** 方向键在目录上换节（roving tabindex，抄老版 SettingsPopup.vue:489-501）——只走可见项。 */
function onTablistKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const ids = visibleIds.value
  if (!ids.length) return
  const index = ids.indexOf(focusId.value ?? '')
  let next = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % ids.length
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + ids.length) % ids.length
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = ids.length - 1
  if (next === index || next < 0) return
  event.preventDefault()
  select(ids[next])
  void nextTick(() => document.getElementById(`settings-tab-${ids[next]}`)?.focus())
}
</script>

<template>
  <WorkbenchModal
    :open="open"
    :dismissable="dismissable"
    :title="title"
    @close="emit('close')"
  >
    <div ref="panelRoot" class="settings-layout">
      <!-- legacy-copied：左栏目录照抄 src/components/workbench/SettingsPopup.vue:15-30
           （settings-tabs／settings-navigation 词汇、tablist／tab 角色与 roving tabindex）；
           按钮本体落 .nx-row（Next 行按钮 primitive），激活态与配色按老版原件重刷。
           工单B：目录顶部加搜索框（照 Obsidian 设置页），分组标题按 group 现算。 -->
      <div class="settings-sidebar">
        <input
          v-model="searchQuery"
          class="nx-field settings-search"
          type="search"
          placeholder="搜索设置"
          aria-label="搜索设置"
          data-test="settings-search"
        >
        <nav class="settings-tabs settings-navigation" role="tablist" aria-label="设置分区" @keydown="onTablistKeydown">
          <template v-for="group in groupedSections" :key="group.name">
            <!-- 分组标题：同一 tablist 里的静态标题，不是 tab、不可聚焦、不参与方向键换节；
                 单节组已拍平，不再出这一行（〔批次68-R4 任务1〕）。 -->
            <p v-if="group.labeled" class="settings-group-label" aria-hidden="true" data-test="settings-group-label">{{ group.name }}</p>
            <button
              v-for="section in group.items"
              :id="`settings-tab-${section.id}`"
              :key="section.id"
              class="settings-tab nx-row"
              :class="{ active: section.id === current?.id, 'is-standalone': !group.labeled }"
              :data-test="`settings-tab-${section.id}`"
              role="tab"
              :aria-selected="(section.id === current?.id).toString()"
              :aria-controls="`settings-panel-${section.id}`"
              :tabindex="section.id === focusId ? 0 : -1"
              type="button"
              @click="select(section.id)"
            >{{ section.title }}</button>
          </template>
        </nav>
        <!-- 搜索无命中（工单B）：目录给一句话，不留白。空查询不报「无匹配」；不放进 tablist 里。 -->
        <p v-if="!visibleSections.length && normalizedQuery" class="pane-hint settings-empty" data-test="settings-empty">无匹配设置</p>
      </div>

      <div class="settings-modal__body">
        <section
          v-if="panelSection"
          :id="`settings-panel-${panelSection.id}`"
          class="settings-section"
          role="tabpanel"
          :aria-label="panelSection.title"
          :data-test="`settings-panel-${panelSection.id}`"
        >
          <!-- 载体设置节：查到内容组件（P14 第三步）就渲染真内容；没查到的声明仍是空态（当前真实现）。 -->
          <p
            v-if="panelSection.kind === 'carrier-settings'"
            class="pane-hint"
            data-test="carrier-settings-empty"
          >该载体的设置项还没有内容</p>
          <component
            v-else
            :is="panelSection.component"
            v-bind="currentProps"
            @close="emit('close')"
            @changed="emit('changed')"
            @theme="(value) => emit('theme', value)"
            @writing-prefs="(value) => emit('writing-prefs', value)"
            @set-enabled="(carrier) => emit('set-enabled', carrier)"
            @set-primary="(pluginId) => emit('set-primary', pluginId)"
            @toggle-companion="(pluginId) => emit('toggle-companion', pluginId)"
          />
        </section>
        <!-- 〔批次76 任务4-2〕搜索把当前节也滤掉了：右栏同步收，给一句人话与一条退路。 -->
        <div v-else class="settings-search-blank" data-test="settings-search-blank">
          <p class="pane-hint">
            没有与「{{ searchQuery.trim() }}」匹配的设置项{{ visibleSections.length ? '，左侧目录里是剩下的那些' : '' }}。
          </p>
          <button type="button" class="control-secondary" data-test="settings-search-clear" @click="clearSearch">清除搜索</button>
        </div>
      </div>
    </div>
  </WorkbenchModal>
</template>

<style scoped>
/* legacy-copied：两栏骨架与目录度量逐条抄自 src/components/workbench/SettingsPopup.vue:778-796
   （960×720 的两栏网格、184px 目录栏、muted 底、active 行 --bg-hover、窄屏目录转横条），
   不是另立刻度。弹窗尺寸压过 WorkbenchModal 的单块面板默认值（那是给单节内容用的）。 */
.workbench-modal :deep(.workbench-modal-panel) {
  width: min(960px, 94vw);
  height: min(720px, 88vh);
  max-height: min(88vh, 100%);
  overflow: hidden;
}
.settings-layout {
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr);
  flex: 1 1 auto;
  min-height: 0;
}
/* 目录栏（工单B）：搜索框＋分组目录。muted 底从 nav 提升到这一层，搜索框才有同一块底。 */
.settings-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px 12px;
  background: var(--surface-workbench-muted);
}
.settings-search {
  flex: none;
  margin: 0 0 8px;
  min-height: 32px;
  padding: 6px 10px;
  font-size: var(--nx-fs-md);
}
.settings-navigation {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  overflow-y: auto;
}
.settings-navigation .settings-tab {
  min-height: 40px;
  padding: 10px 12px;
  border: 0;
  text-align: left;
  color: var(--text-secondary);
}
/* 分组标题（应用／项目／文档）：老版设置弹窗的目录分段语义，静态文本不是 tab。
   〔批次68-R4 任务1〕视觉上与页面项拉开：更小一号、muted 色、加字距、明确不可点（cursor: default），
   单节组不再出这行——「技能库」「写作偏好」直接是页面项。 */
.settings-navigation .settings-group-label {
  margin: 10px 12px 2px;
  color: var(--text-muted);
  font-size: var(--nx-fs-2xs);
  font-weight: 600;
  letter-spacing: 0.12em;
  cursor: default;
  user-select: none;
}
/* 拍平后的独立页面项：上面没有组头指路，用一段比组内间距（4px）宽的空隙隔开，
   免得读成上一组的尾巴；行本体形状交给 .nx-row，不在这里另刻一档圆角。 */
.settings-navigation .settings-tab.is-standalone {
  margin-top: 12px;
}
.settings-navigation .settings-group-label:first-child,
.settings-navigation .settings-tab:first-child {
  margin-top: 0;
}
.settings-navigation .settings-tab.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  font-weight: 500;
}
.settings-empty {
  margin: 8px 4px 0;
}
.settings-modal__body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
}
@media (max-width: 640px) {
  .settings-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .settings-sidebar { padding: 8px; }
  .settings-navigation { flex-direction: row; flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; }
  .settings-navigation .settings-tab { min-height: 44px; flex: none; }
  .settings-navigation .settings-group-label { display: none; }
  /* 窄屏是一行横条、组头一律不画：此时分组结构本来就不可见，拍平项不再单独给空隙（那会把两个项压下去半格）。 */
  .settings-navigation .settings-tab.is-standalone { margin-top: 0; }
}
</style>
