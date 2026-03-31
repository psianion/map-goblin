import type { Segment } from './raycaster'

interface QuadNode {
  minX: number; minY: number; maxX: number; maxY: number
  children: QuadNode[] | null
  segments: Segment[]
}

export class SegmentQuadtree {
  private root: QuadNode | null = null
  private maxDepth: number
  private maxItems: number

  constructor(maxDepth = 8, maxItems = 8) {
    this.maxDepth = maxDepth
    this.maxItems = maxItems
  }

  build(segments: Segment[]): void {
    if (segments.length === 0) {
      this.root = null
      return
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const s of segments) {
      const sMinX = Math.min(s.x1, s.x2)
      const sMinY = Math.min(s.y1, s.y2)
      const sMaxX = Math.max(s.x1, s.x2)
      const sMaxY = Math.max(s.y1, s.y2)
      if (sMinX < minX) minX = sMinX
      if (sMinY < minY) minY = sMinY
      if (sMaxX > maxX) maxX = sMaxX
      if (sMaxY > maxY) maxY = sMaxY
    }
    const pad = 1
    this.root = this.createNode(minX - pad, minY - pad, maxX + pad, maxY + pad)
    for (const seg of segments) {
      this.insert(this.root, seg, 0)
    }
  }

  query(minX: number, minY: number, maxX: number, maxY: number): Segment[] {
    if (!this.root) return []
    const seen = new Set<Segment>()
    const result: Segment[] = []
    this.queryNode(this.root, minX, minY, maxX, maxY, seen, result)
    return result
  }

  private createNode(minX: number, minY: number, maxX: number, maxY: number): QuadNode {
    return { minX, minY, maxX, maxY, children: null, segments: [] }
  }

  private insert(node: QuadNode, seg: Segment, depth: number): void {
    const sMinX = Math.min(seg.x1, seg.x2)
    const sMinY = Math.min(seg.y1, seg.y2)
    const sMaxX = Math.max(seg.x1, seg.x2)
    const sMaxY = Math.max(seg.y1, seg.y2)

    if (sMaxX < node.minX || sMinX > node.maxX || sMaxY < node.minY || sMinY > node.maxY) return

    if (node.children) {
      for (const child of node.children) {
        this.insert(child, seg, depth + 1)
      }
      return
    }

    node.segments.push(seg)
    if (node.segments.length > this.maxItems && depth < this.maxDepth) {
      this.subdivide(node, depth)
    }
  }

  private subdivide(node: QuadNode, depth: number): void {
    const mx = (node.minX + node.maxX) / 2
    const my = (node.minY + node.maxY) / 2
    node.children = [
      this.createNode(node.minX, node.minY, mx, my),
      this.createNode(mx, node.minY, node.maxX, my),
      this.createNode(node.minX, my, mx, node.maxY),
      this.createNode(mx, my, node.maxX, node.maxY),
    ]
    const segs = node.segments
    node.segments = []
    for (const seg of segs) {
      for (const child of node.children) {
        this.insert(child, seg, depth + 1)
      }
    }
  }

  private queryNode(
    node: QuadNode, minX: number, minY: number, maxX: number, maxY: number,
    seen: Set<Segment>, result: Segment[],
  ): void {
    if (maxX < node.minX || minX > node.maxX || maxY < node.minY || minY > node.maxY) return

    if (node.children) {
      for (const child of node.children) {
        this.queryNode(child, minX, minY, maxX, maxY, seen, result)
      }
    } else {
      for (const seg of node.segments) {
        if (!seen.has(seg)) {
          const sMinX = Math.min(seg.x1, seg.x2)
          const sMinY = Math.min(seg.y1, seg.y2)
          const sMaxX = Math.max(seg.x1, seg.x2)
          const sMaxY = Math.max(seg.y1, seg.y2)
          if (sMaxX >= minX && sMinX <= maxX && sMaxY >= minY && sMinY <= maxY) {
            seen.add(seg)
            result.push(seg)
          }
        }
      }
    }
  }
}
