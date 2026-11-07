<script setup>
import { computed } from 'vue'

/**
 * 底栏常驻状态栏（批次63 任务1，框架计划 §6 桩1⑤）。
 *
 * 一句话：回答「我现在处于什么状态」——四要素从左到右固定：
 *   ① 服务灯 ② 当前载体／页组（〔批次76-R2 任务4〕末尾可挂一段网址：应用面顶部那行常驻 URL 撤了，
 *      读数搬进这条已有的栏，不新开第五项） ③「1＋N 的 N」＝在册窗数 ④ 焦点文档字数。
 *
 * 三条边界写死在这里：
 * · **只读**：组件不认识桥、载体与文件系统，四个数全由宿主（AppNext）现取后传进来——
 *   状态栏不许成为第二份真相（工作区 v3、serviceLogPool、页数据面各自是唯一的来源）。
 * · **不做死按钮**（作者裁定③）：唯一的可点件是服务灯，语义也是既有的那一条——
 *   点开设置里的「服务与通知」节（与右栏／竖条上的状态点同一个落点），不新增任何动作。
 * · 可点件 ≥24×24、文本对比 ≥4.5:1（外部审计 H／OD craft 判据）：度量与色值就在本组件的
 *   样式段里（工单只允许新建 StatusBar.vue，不许改 next-shell.css，所以这一段随组件走）。
 *   文本一律走 --text-secondary：明亮档 #575b62 压在 #f3f3f2 上实测≈6.15:1、深色档≈7.4:1；
 *   --text-muted 那一档只有≈4.49:1，卡在线下，除灰色灯的空心描边（非文本）外一处不用。
 */
const props = defineProps({
  /** 服务灯：[{ id, title, color, notices }]。color 沿用 serviceLogPool 的四色词汇（green／orange／red／gray）。 */
  lights: { type: Array, default: () => [] },
  /** 当前载体／板块标题（竖条那一格的标题；没有项目就是空）。 */
  carrier: { type: String, default: '' },
  /** 此刻那一页所在的页组（主组／侧组；没有页就空着）。 */
  pageGroup: { type: String, default: '' },
  /** 「1＋N 的 N」：此刻在册的窗数，从工作区 v3 现取（四种形态都算在册）。 */
  windows: { type: Number, default: 0 },
  /** 焦点文档：标题与字数（字数为 null＝这一页没装可计字的文档，如实留空）。 */
  docTitle: { type: String, default: '' },
  docChars: { type: Number, default: null },
  /**
   * 〔批次76-R2 任务4〕此刻那一页若是内嵌浏览器（应用面），这里带它正在跑的地址。
   * 应用面顶部那行常驻网址撤了，读数不消失、只是搬进这条**已有**的状态栏——所以它是「载体」
   * 那一项里多出来的一段，不是第五项。宿主现取后传进来，本组件依旧不认识桥（只读）。
   */
  address: { type: String, default: '' },
  /** 地址来源的说法（插件自带／本机改过），只进悬浮提示。 */
  addressNote: { type: String, default: '' }
})

/** 服务灯唯一的可点语义：交回宿主打开既有的「服务与通知」节，这里不自己弹窗。 */
const emit = defineEmits(['open-services'])

const COLOR_LABELS = { green: '就绪', orange: '待确认', red: '异常', gray: '未运行' }
const anyNotice = computed(() => props.lights.some((light) => Number(light?.notices) > 0))
function colorLabel(color) {
  return COLOR_LABELS[String(color ?? '')] ?? '未知'
}
function lightTitle(light) {
  const notices = Number(light?.notices) > 0 ? ` · ${light.notices} 条未确认通知` : ''
  return `${light?.title ?? light?.id}：${colorLabel(light?.color)}${notices}（点开通知与日志）`
}
const charsText = computed(() => (Number.isFinite(props.docChars) ? `${props.docChars} 字` : '—'))
/** 「载体」那一项的悬浮提示：带上网址与来源层，作者不必把省略号后的地址再点开一处看。 */
const carrierTitle = computed(() => {
  const base = `当前载体：${props.carrier || '无'}｜页组：${props.pageGroup || '无'}`
  if (!props.address) return base
  return `${base}｜内嵌浏览器地址：${props.address}${props.addressNote ? `（${props.addressNote}）` : ''}`
})
</script>

<template>
  <footer class="nx-statusbar" aria-label="状态栏" data-test="status-bar">
    <!-- ① 服务灯：一载体一盏（只有声明了服务／外部 MCP 的才在表里）。整组是一个可点件——
         点开的是同一节，逐盏再各点一次没有第二种语义，就不做成一排假按钮。
         每一盏自己带 aria-label 与 title，读数仍是文本级（非色盲只靠颜色）。 -->
    <button
      type="button"
      class="control-quiet nx-status-lights"
      :class="{ 'has-notice': anyNotice }"
      data-test="status-services"
      :aria-label="lights.length ? `服务状态：共 ${lights.length} 项，打开通知与日志` : '服务状态：当前没有外部服务'"
      @click="emit('open-services')"
    >
      <span v-if="!lights.length" class="nx-status-plain">无外部服务</span>
      <span v-else class="nx-status-line">
        <span v-for="light in lights" :key="light.id" class="nx-status-light-unit" :title="lightTitle(light)">
          <span class="nx-status-light" :class="`is-${light.color || 'gray'}`" :data-status="light.color || 'gray'" aria-hidden="true" />
          <span class="nx-status-light-name">{{ light.title }}</span>
          <span v-if="Number(light.notices) > 0" class="nx-status-light-notice">{{ light.notices }}</span>
        </span>
      </span>
    </button>

    <!-- ② 当前载体／页组：作者此刻站在哪块板、哪一组。
         〔批次76-R2 任务4〕这一项末尾可以挂一段网址——只有此刻那一页是内嵌浏览器时才出。 -->
    <span
      class="nx-status-item is-carrier"
      data-test="status-carrier"
      :title="carrierTitle"
    >
      <span class="nx-status-key">载体</span>
      <span class="nx-status-value">{{ carrier || '—' }}</span>
      <span v-if="pageGroup" class="nx-status-value nx-status-group">{{ pageGroup }}</span>
      <span v-if="address" class="nx-status-value nx-status-address" data-test="status-address">{{ address }}</span>
    </span>

    <!-- ③「1＋N 的 N」：在册窗数（工作区 v3 现取）。数字本身是读数，不是钮。 -->
    <span class="nx-status-item" data-test="status-windows" title="在册窗数（1＋N 的 N，含页／浮窗／收进悬浮球的）">
      <span class="nx-status-key">在册</span>
      <span class="nx-status-value">{{ windows }}</span>
    </span>

    <!-- ④ 焦点文档字数：没有可计字的文档就如实留一道破折号，不摆 0 字冒充读数。 -->
    <span class="nx-status-item is-end" data-test="status-chars" :title="docTitle ? `${docTitle} 的字数` : '焦点文档没有可计字的正文'">
      <span class="nx-status-key">字数</span>
      <span class="nx-status-value">{{ charsText }}</span>
    </span>
  </footer>
</template>

<style scoped>
/* —— 状态栏（批次63 任务1 · 框架计划 §6 桩1⑤）——————————————————————————
   底栏常驻一条，四要素从左到右固定：服务灯 → 当前载体／页组 → 「1＋N 的 N」（在册窗数）→ 焦点文档字数。
   两条判据是硬的下限（外部工具审计 H／OD craft）：
   · 文本对比 ≥4.5:1 → 全部文本走 --text-secondary（明亮档实测≈6.15:1，深色≈7.4:1）；
   · 可点件 ≥24×24 → 服务灯那枚钮 min-width/min-height 都是 24px
     （--control-hit-min 是 36px 的工具栏档，底栏 26px 高放不下，取判据下限）。
   高度不抽成本地 --nx-* 变量：视觉合同门禁只认 next-shell.css 里的定义，
   组件自定义的 token 在它眼里等于没定义，所以这一条度量就地写死。 */
.nx-statusbar {
  display: flex;
  align-items: stretch;
  gap: 14px;
  flex: 0 0 26px;
  height: 26px;
  padding-inline: 10px;
  border-top: 1px solid var(--hairline-soft);
  background: var(--surface-workbench-muted);
  color: var(--text-secondary);
  font-size: var(--nx-fs-md);
  line-height: 26px;
  overflow: hidden;
}

/* 唯一的可点件：整组服务灯是一个钮（点开的是同一节，逐盏各点一次没有第二种语义）。 */
.nx-status-lights {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 24px;
  min-height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--nx-fs-md);
  line-height: 1.4;
  white-space: nowrap;
}
.nx-status-lights:hover {
  background: var(--workbench-selected);
}
.nx-status-lights.has-notice {
  font-weight: 600;
}
.nx-status-line,
.nx-status-light-unit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.nx-status-light {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
}
.nx-status-light.is-green { background: var(--success); }
.nx-status-light.is-orange { background: var(--signal-warm); }
.nx-status-light.is-red { background: var(--control-danger); }
.nx-status-light.is-gray {
  background: transparent;
  border: 1px solid var(--text-muted);
}
.nx-status-light-name {
  color: var(--text-secondary);
}
.nx-status-light-notice {
  min-width: 14px;
  text-align: inline-start;
}
.nx-status-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nx-status-item.is-end {
  margin-inline-start: auto;
  padding-inline-end: 2px;
}
/* 引导词（载体／在册／字数）用小一档刻度，读数保持正档：一眼扫过去先看数。 */
.nx-status-key {
  font-size: var(--nx-fs-2xs);
  color: var(--text-secondary);
}
.nx-status-value {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
/* 〔批次76-R2 任务4〕网址：应用面顶部那行 URL 撤了，读数落在这条已有状态栏的「载体」项末尾。
   颜色仍走 --text-secondary（对比那条判据不因少一行 chrome 而松动）；长度钳住、超了省略——
   完整地址在同一项的悬浮提示里，抄出去走页签右键菜单。 */
.nx-status-address {
  min-width: 0;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nx-status-plain {
  color: var(--text-secondary);
}
@media (max-width: 860px) {
  /* 窄屏（与手机侧同一档断点）：先舍读数最长的载体那一项，服务灯与字数留下——
     「有没有出事」和「写了多少字」是作者在手机上最想看的那两个。 */
  .nx-status-item.is-carrier {
    display: none;
  }
}
</style>
