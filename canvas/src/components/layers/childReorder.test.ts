import { describe, it, expect } from 'vitest'
import { computeChildDragReorder } from './childReorder'
import type { AnyChild } from '@/store/types'

function child(id: string, childType: AnyChild['childType']): AnyChild {
  return { id, childType } as unknown as AnyChild
}

describe('computeChildDragReorder', () => {
  it('dragging a child up in the visual list moves it later in the array (drawn on top)', () => {
    // Array order c0,c1,c2 → visual (panel-top first) order c2,c1,c0.
    // Dragging c0 up past c1 in the visual list (active=c0, over=c1) should
    // land c0 later in the array than c1, i.e. drawn above it.
    const children = [child('c0', 'asset'), child('c1', 'asset'), child('c2', 'asset')]
    const result = computeChildDragReorder(children, 'c0', 'c1')
    expect(result).toEqual({ fromIndex: 0, toIndex: 1 })
  })

  it('dragging a child down in the visual list moves it earlier in the array (drawn below)', () => {
    const children = [child('c0', 'asset'), child('c1', 'asset'), child('c2', 'asset')]
    const result = computeChildDragReorder(children, 'c2', 'c1')
    expect(result).toEqual({ fromIndex: 2, toIndex: 1 })
  })

  it('returns null for a no-op drag onto itself', () => {
    const children = [child('c0', 'asset'), child('c1', 'asset')]
    expect(computeChildDragReorder(children, 'c0', 'c0')).toBeNull()
  })

  it('returns null when active or over is not found', () => {
    const children = [child('c0', 'asset')]
    expect(computeChildDragReorder(children, 'missing', 'c0')).toBeNull()
    expect(computeChildDragReorder(children, 'c0', 'missing')).toBeNull()
  })

  it('returns null for a cross-childType move — reorder only draws differently for assets/text', () => {
    const children = [child('a1', 'asset'), child('d1', 'door')]
    expect(computeChildDragReorder(children, 'a1', 'd1')).toBeNull()
    expect(computeChildDragReorder(children, 'd1', 'a1')).toBeNull()
  })

  it('allows reordering within the same childType (text)', () => {
    const children = [child('t0', 'text'), child('t1', 'text')]
    expect(computeChildDragReorder(children, 't0', 't1')).toEqual({ fromIndex: 0, toIndex: 1 })
  })
})
