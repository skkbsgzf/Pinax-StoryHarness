import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  SNAP_EDGE_RATIO,
  SNAP_ORB_EDGE,
  SNAP_TARGETS,
  SNAP_TOP_RATIO,
  snapPlan,
  snapPreviewBox,
  snapTargetAt
} from '../shell/paneSnap.mjs'

/**
 * 拖拽吸附的判定（批次76 · 〔裁定A〕「相关的页面形态转换按钮，用拖拽的形式去做，例如拖到侧边可以吸附」）。
 *
 * 这一层只验纯函数：给定「窗口层矩形＋指针」，命中哪一块圈、要去哪个形态、预览画在哪。
 * 真指针序列在 shell-ui.spec.mjs 里驱动（拖到右缘→group 变 side、拖进球→进悬浮球、阈值外只改矩形）。
 *
 * 命中圈尺寸（12%／14%／96px）是**规范口径的度量**，不是质量阈值：这里断言的是「边界在哪」，
 * 不是「吸附成功率」——后者属记账项，见工单「记账指标」，不进闸。
 */

const LAYER = { x: 0, y: 0, width: 1000, height: 800 }
// 左缘圈＝x≤120，右缘圈＝x≥880，顶缘圈＝y≤112，球角＝x≥904 且 y≥704。

describe('批次76 · 命中圈判定（paneSnap.snapTargetAt）', () => {
  test('词表四块圈＋无命中：值域是闭集，宿主与窗体共用这一张表', () => {
    assert.deepEqual([...SNAP_TARGETS], ['orb', 'top', 'left', 'right'])
    assert.equal(SNAP_EDGE_RATIO, 0.12)
    assert.equal(SNAP_TOP_RATIO, 0.14)
    assert.equal(SNAP_ORB_EDGE, 96)
  })

  test('左右缘各 12%、顶缘 14%：圈里算，圈外不算', () => {
    assert.equal(snapTargetAt({ x: 10, y: 400 }, LAYER), 'left')
    assert.equal(snapTargetAt({ clientX: 120, clientY: 400 }, LAYER), 'left')
    assert.equal(snapTargetAt({ x: 121, y: 400 }, LAYER), null)
    assert.equal(snapTargetAt({ x: 900, y: 400 }, LAYER), 'right')
    assert.equal(snapTargetAt({ x: 879, y: 400 }, LAYER), null)
    assert.equal(snapTargetAt({ x: 500, y: 100 }, LAYER), 'top')
    assert.equal(snapTargetAt({ x: 500, y: 113 }, LAYER), null)
    assert.equal(snapTargetAt({ x: 500, y: 400 }, LAYER), null)
  })

  test('球角优先于右缘与顶缘：落点重叠时先赢的是「收进球」', () => {
    assert.equal(snapTargetAt({ x: 950, y: 750 }, LAYER), 'orb')
    // 同一点若只看 x，它会先被判成右缘；角区先判，才不会出现「想收进球却搬去侧页组」。
    assert.equal(snapTargetAt({ x: 950, y: 600 }, LAYER), 'right')
    assert.equal(snapTargetAt({ x: 20, y: 20 }, LAYER), 'top')
  })

  test('页态拖到顶缘没有那一档：返回 null（v3 里 maximized 只属于浮窗）', () => {
    assert.equal(snapTargetAt({ x: 500, y: 60 }, LAYER, { form: 'page' }), null)
    assert.equal(snapTargetAt({ x: 500, y: 60 }, LAYER, { form: 'floating' }), 'top')
  })

  test('指针在层外／矩形缺／坐标缺一律不吸附（不拿 undefined 去猜落点）', () => {
    assert.equal(snapTargetAt({ x: -5, y: 400 }, LAYER), null)
    assert.equal(snapTargetAt({ x: 1200, y: 400 }, LAYER), null)
    assert.equal(snapTargetAt({ x: 500, y: 900 }, LAYER), null)
    assert.equal(snapTargetAt({ x: 500, y: 400 }, { x: 0, y: 0, width: 0, height: 0 }), null)
    assert.equal(snapTargetAt(null, LAYER), null)
    assert.equal(snapTargetAt({ x: Number.NaN, y: 400 }, LAYER), null)
  })

  test('层矩形带偏移：分界线跟着这块板走，不是跟着屏幕走', () => {
    const offset = { x: 200, y: 100, width: 1000, height: 800 }
    assert.equal(snapTargetAt({ x: 210, y: 500 }, offset), 'left')
    assert.equal(snapTargetAt({ x: 100, y: 500 }, offset), null, '层外的左不算左缘')
    assert.equal(snapTargetAt({ x: 1190, y: 890 }, offset), 'orb')
  })
})

describe('批次76 · 落点表（paneSnap.snapPlan）', () => {
  test('四块圈各自的落点：球＝收起、顶＝浮窗最大化、左右＝页态换组', () => {
    assert.deepEqual(snapPlan('orb', { form: 'floating', group: 'main' }), { form: 'tab', group: 'main', maximized: false })
    assert.deepEqual(snapPlan('top', { form: 'floating', group: 'side' }), { form: 'floating', group: 'side', maximized: true })
    assert.deepEqual(snapPlan('left', { form: 'floating', group: 'side' }), { form: 'page', group: 'main', maximized: false })
    assert.deepEqual(snapPlan('right', { form: 'page', group: 'main' }), { form: 'page', group: 'side', maximized: false })
  })

  test('无预览不落位（工单守卫④）：陌生目标与页态拖顶一律 null', () => {
    assert.equal(snapPlan(null, { form: 'floating', group: 'main' }), null)
    assert.equal(snapPlan('bottom', { form: 'floating', group: 'main' }), null)
    assert.equal(snapPlan('top', { form: 'page', group: 'main' }), null)
  })

  test('页态拖到左／右缘仍是页态：吸附不新造形态，只换页组', () => {
    for (const target of ['left', 'right']) {
      const plan = snapPlan(target, { form: 'page', group: 'main' })
      assert.equal(plan.form, 'page')
      assert.equal(plan.maximized, false)
    }
  })
})

describe('批次76 · 预览矩形（paneSnap.snapPreviewBox）', () => {
  test('左右各半、顶为整层、球角一小块（百分比矩形归 CSS，宿主不写像素）', () => {
    assert.deepEqual(snapPreviewBox('left'), { left: '0%', top: '0%', width: '50%', height: '100%' })
    assert.deepEqual(snapPreviewBox('right'), { left: '50%', top: '0%', width: '50%', height: '100%' })
    assert.deepEqual(snapPreviewBox('top'), { left: '0%', top: '0%', width: '100%', height: '100%' })
    assert.deepEqual(snapPreviewBox('orb'), { right: '24px', bottom: '24px', width: '48px', height: '48px' })
    assert.equal(snapPreviewBox(null), null)
    assert.equal(snapPreviewBox('nope'), null)
  })

  test('每个可落位的目标都有预览可画：无预览不落位这条判据在数据层就成立', () => {
    for (const target of SNAP_TARGETS) {
      assert.ok(snapPreviewBox(target), `${target} 没有预览矩形，却是个落点`)
    }
  })
})
