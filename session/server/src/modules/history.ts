// Undo for the DM (table lobby pass §5): what one recorded command changed, and the two lists
// those changes land on. Pure on purpose — the registry hands it states and puts back what it
// returns, so nothing here persists or broadcasts.
//
// The diff walks plain objects and stops at anything else: an array, a string, a number is one
// leaf, compared by reference. Handlers keep unchanged subtrees by reference, so a token move on
// a 200-token scene walks the scene's keys and one token, not the whole slice.

export type Path = readonly string[]

/** One changed leaf. `undefined` on either side is "absent". */
export interface Change {
  path: Path
  before: unknown
  after: unknown
}

export type Side = 'before' | 'after'

/**
 * A module's own say over where the diff stops and how a leaf lands. `at` names a path the diff
 * hands whole to `apply` (`leaf`), or one it walks into even when one side is absent
 * (`through`), so the leaves `apply` sees are always at the same depth.
 */
export interface MergeRule {
  at(path: Path): 'through' | 'leaf' | undefined
  apply(current: unknown, change: Change, side: Side): unknown
}

export interface StepName {
  module: string
  action: string
}

export interface Step {
  name: StepName
  /** The identity that sent the command; only its own steps of one group merge. */
  seat: string
  group?: string
  /** The scene every frame of an undo or redo is tagged with. */
  sceneId: string | null
  /** By module: the leaves that module's state changed. */
  changes: Record<string, Change[]>
}

export const HISTORY_MAX = 100

const EMPTY: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const has = (o: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key)

/** Counts the nodes a diff visits, for the guard test that keeps a token move cheap. */
export interface DiffStats {
  visited: number
}

/** The leaves that differ between two states. Empty when nothing changed. */
export function diff(before: unknown, after: unknown, rule?: MergeRule, stats?: DiffStats): Change[] {
  const out: Change[] = []
  walk(before, after, [], out, rule, stats)
  return out
}

function walk(a: unknown, b: unknown, path: string[], out: Change[], rule?: MergeRule, stats?: DiffStats): void {
  if (stats) stats.visited++
  if (a === b) return
  const mode = rule?.at(path)
  if (mode !== 'leaf') {
    const through = mode === 'through'
    const oa = isPlain(a) ? a : through && a === undefined ? EMPTY : null
    const ob = isPlain(b) ? b : through && b === undefined ? EMPTY : null
    if (oa && ob) {
      for (const key of Object.keys(oa)) {
        path.push(key)
        walk(oa[key], ob[key], path, out, rule, stats)
        path.pop()
      }
      for (const key of Object.keys(ob)) {
        if (has(oa, key)) continue
        path.push(key)
        walk(undefined, ob[key], path, out, rule, stats)
        path.pop()
      }
      return
    }
  }
  out.push({ path: [...path], before: a, after: b })
}

/** The value at `path`, or undefined where any step of it is missing. */
export function getIn(root: unknown, path: Path): unknown {
  let node = root
  for (const key of path) {
    if (!isPlain(node)) return undefined
    node = node[key]
  }
  return node
}

/**
 * `root` with `value` at `path`, copying only the objects on the way down. `undefined` deletes
 * the key; a missing or non-object parent becomes an object.
 */
export function setIn(root: unknown, path: Path, value: unknown, i = 0): unknown {
  if (i === path.length) return value
  const node = isPlain(root) ? root : {}
  const key = path[i]
  const next = setIn(node[key], path, value, i + 1)
  if (next === undefined) {
    if (!has(node, key)) return node
    const rest = { ...node }
    delete rest[key]
    return rest
  }
  if (node[key] === next && has(node, key)) return node
  return { ...node, [key]: next }
}

/** One side of each change put back onto the current state, leaf by leaf. */
export function applyChanges(state: unknown, changes: readonly Change[], side: Side, rule?: MergeRule): unknown {
  let next = state
  for (const change of changes) {
    const value =
      rule?.at(change.path) === 'leaf' ? rule.apply(getIn(next, change.path), change, side) : change[side]
    next = setIn(next, change.path, value)
  }
  return next
}

const isPrefix = (outer: Path, inner: Path): boolean =>
  outer.length <= inner.length && outer.every((key, i) => inner[i] === key)

/**
 * Two runs of changes as one: the earliest before and the latest after of every leaf. A later
 * change inside an earlier one's subtree folds into its after; a later one over an earlier
 * one's subtree takes the earlier before for that part.
 */
export function mergeChanges(earlier: readonly Change[], later: readonly Change[]): Change[] {
  let out = [...earlier]
  for (const change of later) {
    let merged = change
    out = out.filter((prior) => {
      if (isPrefix(prior.path, merged.path)) {
        merged = {
          path: prior.path,
          before: prior.before,
          after: setIn(prior.after, merged.path.slice(prior.path.length), merged.after),
        }
        return false
      }
      if (isPrefix(merged.path, prior.path)) {
        merged = { ...merged, before: setIn(merged.before, prior.path.slice(merged.path.length), prior.before) }
        return false
      }
      return true
    })
    out.push(merged)
  }
  return out
}

/** One session's undo and redo lists. */
export class History {
  private readonly undos: Step[] = []
  private readonly redos: Step[] = []

  /**
   * A new step on top, or merged into the top one when both carry the same group from the
   * same seat. An empty step records nothing; any other empties the redo list.
   */
  record(step: Step): void {
    if (Object.values(step.changes).every((changes) => changes.length === 0)) return
    this.redos.length = 0
    const top = this.undos.at(-1)
    if (top && step.group !== undefined && top.group === step.group && top.seat === step.seat) {
      const changes = { ...top.changes }
      for (const [module, list] of Object.entries(step.changes)) {
        changes[module] = changes[module] ? mergeChanges(changes[module], list) : list
      }
      this.undos[this.undos.length - 1] = { ...top, changes }
      return
    }
    this.undos.push(step)
    if (this.undos.length > HISTORY_MAX) this.undos.shift()
  }

  /** The step to undo, moved onto the redo list. The caller applies its before values. */
  undo(): Step | undefined {
    const step = this.undos.pop()
    if (step) this.redos.push(step)
    return step
  }

  /** The step to redo, moved back onto the undo list. The caller applies its after values. */
  redo(): Step | undefined {
    const step = this.redos.pop()
    if (step) this.undos.push(step)
    return step
  }

  /** What the DM's buttons name: the top of each list. */
  names(): { undo: StepName | null; redo: StepName | null } {
    return { undo: this.undos.at(-1)?.name ?? null, redo: this.redos.at(-1)?.name ?? null }
  }
}
