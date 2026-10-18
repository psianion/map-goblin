# Good Goblin — building with this design system

A dark-first design system for a tabletop map editor. React 19 + Tailwind utilities,
variants via `class-variance-authority`, primitives from `@base-ui/react`.

## Setup: the root must carry `class="dark"`

**Put `dark` on the root element of every design.** The app ships
`<html lang="en" class="dark">` hardcoded and has no theme toggle, so the night
palette is the only one it ever renders.

This is not optional styling sugar. `:root` defines the semantic tokens as
indirections (`--background: var(--surface-0)`), while `.dark` overrides only the
**raw** tokens (`--surface-0`, `--text-primary`, …). A custom property resolves on
the element that declares it, so `.dark` only works when it sits on the *same*
element as `:root` — i.e. `<html>`. Measured on this bundle:

| `.dark` placement | `bg-background` | raw `--surface-0` |
|---|---|---|
| absent | `223 227 222` (light) | `223 227 222` |
| on a wrapper `<div>` | **`223 227 222` (light)** | **`15 16 14` (dark)** — half-themed |
| on `<html>` | `15 16 14` | `15 16 14` |

A wrapper `<div class="dark">` produces the broken middle row: dark raw tokens
under light semantic ones. Set it on the root, and paint the page with
`bg-background text-foreground`.

## The styling idiom

Tailwind utility classes over semantic tokens. There is no prop-based styling
system — components take `className`, and layout glue is written as utilities.

| Family | Real class names |
|---|---|
| Surfaces | `bg-background` `bg-surface-0` `bg-surface-1` `bg-surface-2` `bg-surface-3` `bg-muted` |
| Text | `text-foreground` `text-muted-foreground` `text-text-primary` `text-text-secondary` `text-text-muted` `text-text-dim` |
| Brand / state | `bg-primary` `text-primary-foreground` `bg-accent` `bg-accent-active` `text-on-accent` `bg-secondary` `bg-destructive` `bg-danger` `text-destructive` |
| Borders | `border-border` `border-border-default` `border-border-subtle` `border-border-focus` |
| Numerics | `font-mono` `tabular-nums` — used for coordinates, sizes and shortcut keys |

**The accent is a state colour, not a surface tint.** It marks the active tool,
the selected preset, the primary action and focus rings. Never wash a panel in it —
surfaces stay neutral and the accent is the only saturated thing on screen.

Component variants come from CVA props, not classes: `Button` takes
`variant` (`default | outline | secondary | ghost | destructive | link`) and
`size` (`default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`).

## Where the truth lives

- `_ds/<folder>/styles.css` and everything it `@import`s — the compiled tokens and
  component CSS. Read it before inventing a colour.
- `components/<group>/<Name>/<Name>.d.ts` — the component's real props.
- `components/<group>/<Name>/<Name>.prompt.md` — usage and examples.

## A composition that renders

```jsx
<div className="dark">            {/* in a real app this class is on <html> */}
  <div className="min-h-screen bg-background p-6 text-foreground">
    <div className="w-[320px] rounded-lg border border-border bg-surface-1 p-3">
      <PropertyField label="Grid size">
        <NumberInput value={64} onChange={setSize} aria-label="Grid size" />
      </PropertyField>
      <PropertyField label="Snap to grid">
        <ToggleSwitch checked={snap} onChange={setSnap} label="Snap to grid" />
      </PropertyField>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost">Cancel</Button>
        <Button>Publish map</Button>
      </div>
    </div>
  </div>
</div>
```

Two things that bite: `ToggleSwitch`'s `label` is **aria-label only** and renders no
visible text — always pair it with your own copy or a `PropertyField`. And panel
sections (`CollapsibleSection` and every `*Properties` panel) are keyed by id
strings — `grid`, `layer`, `sublayers`, `colors`, `walls`, `rooms`, `transform`,
`texture-fill`, `bg`, `terrain`, `environment`.
