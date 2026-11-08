import { normalizeComicDisplaySelection } from '@pinax/core/media/comicPanelDisplay'

/**
 * T8：漫画记录的「页／分镜记录语义」切 @pinax/core 媒体域。
 *
 * 分工（这一层不发明规则）：
 *   - 文档形状（{ schemaVersion:1, records }）、修订号闸、未传字段保留、id 形制与四把工具的描述
 *     由 core 的 `usecases/fileRecordTools` 决定（tools.mjs 直接用它生成工具，不再落宿主副本）；
 *   - 漫画格里的「显示选择」与「阶段产物 vs 普通图片候选」由 core 的
 *     `media/comicPanelDisplay`＋页模型的归一规则决定：
 *       · selectedTakeId 只在 imageTakeIds 里才算选中（普通图片候选）；
 *       · production[stage].selectedArtifactId 只在该阶段 artifactIds 里才算选中（阶段产物）；
 *       · displaySelection 只接受 core 认得的 take／stage 形状，其余按 core 的 normalize 归 null。
 *   - 只动作者真的写了的字段：没有这些字段的记录一个字节不改，也不注入 core 页模型的默认值
 *     （schemaVersion 5／panels／visualBible 是 Web 编辑器那一层的页对象形状，不是这份文件真源）。
 *
 * 为什么没有接 createComicPageRepository／createStoryboardRepository：它们以 core 页对象／
 * 分镜文档为存储单元（页级 revision、数字时间戳、sourceRefs 对象、panels 数组在顶层），
 * 与宿主「一条记录一个扁平对象、文档级修订号」没有无损映射；硬接会改写作者可见的 JSON。
 * 生成链路（production／adaptation／script／shotExporter）宿主没有入口，本批不接。
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function uniqueStrings(values) {
  return [...new Set(values.map((item) => String(item ?? '').trim()).filter(Boolean))]
}

/**
 * 一格的媒体语义归一（core 页模型的选中规则，只落在作者已写的字段上）。
 * 未知字段（composition／dialogue／自定义）原样保留。
 */
export function normalizeComicPanelRecord(panel) {
  if (!isPlainObject(panel)) return panel
  const next = { ...panel }

  if (Array.isArray(panel.imageTakeIds)) next.imageTakeIds = uniqueStrings(panel.imageTakeIds)
  if ('selectedTakeId' in panel) {
    next.selectedTakeId = Array.isArray(next.imageTakeIds) && next.imageTakeIds.includes(panel.selectedTakeId)
      ? panel.selectedTakeId
      : null
  }

  if (isPlainObject(panel.production)) {
    next.production = Object.fromEntries(Object.entries(panel.production).map(([stage, state]) => {
      if (!isPlainObject(state)) return [stage, state]
      const normalized = { ...state }
      if (Array.isArray(state.artifactIds)) normalized.artifactIds = uniqueStrings(state.artifactIds)
      if ('selectedArtifactId' in state) {
        normalized.selectedArtifactId = Array.isArray(normalized.artifactIds) && normalized.artifactIds.includes(state.selectedArtifactId)
          ? state.selectedArtifactId
          : null
      }
      return [stage, normalized]
    }))
  }

  if ('displaySelection' in panel) next.displaySelection = normalizeComicDisplaySelection(panel.displaySelection)
  return next
}

/** 记录 meta 的保存前归一：只有真的带了 panels 才走进来，其余 meta 原样交还。 */
export function normalizeComicMetaForSave(meta) {
  if (!isPlainObject(meta) || !Array.isArray(meta.panels)) return meta
  return { ...meta, panels: meta.panels.map((panel) => normalizeComicPanelRecord(panel)) }
}

export default normalizeComicMetaForSave
