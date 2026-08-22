import type { Config } from 'tailwindcss'

/**
 * Moss — the Good Goblin chrome theme, table side.
 *
 * Every colour resolves to a CSS variable declared in `src/index.css` (`:root`, night only —
 * the table has one theme), written as `rgb(var(--x) / <alpha-value>)` so Tailwind's opacity
 * modifier works on all of them: `bg-surface-1/80`, `ring-ring/50`, `bg-destructive/10`.
 *
 * Both vocabularies are declared here on purpose. Components use the Tailwind names
 * (surface-*, text-*, border-*, accent-*) today; the shadcn names (primary, muted, ring,
 * border, ...) are for the shell primitives to come. The canvas gotcha: when only one
 * vocabulary is declared, the other compiles to nothing — `bg-muted`, `bg-primary`,
 * `ring-ring` and `border-border` silently vanish. Declaring both against one set of values
 * is what makes hovers, focus rings and destructive tints exist at all.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface hierarchy — deepest first. The map is the stage; chrome sits quietly on it.
        'surface-0': token('surface-0'),
        'surface-1': token('surface-1'),
        'surface-2': token('surface-2'),
        'surface-3': token('surface-3'),
        // Text hierarchy
        'text-primary': token('text-primary'),
        'text-secondary': token('text-secondary'),
        'text-muted': token('text-muted'),
        'text-dim': token('text-dim'),
        // Ink weights — heavier on structure, lighter on ground clutter
        'border-structure': token('border-structure'),
        'border-default': token('border-default'),
        'border-subtle': token('border-subtle'),
        'border-focus': token('border-focus'),
        // Accent — one focal per screen: active tool, selection, primary action, live state
        'accent-active': token('accent-active'),
        'accent-dim': token('accent-dim'),
        'on-accent': token('on-accent'),
        // Semantic — distinct from the accent by hue AND by shape at the call site, because
        // with a green accent `success` and `accent-active` are the same hue.
        danger: token('danger'),
        warning: token('warning'),
        success: token('success'),
        info: token('info'),

        // shadcn vocabulary — same values, the names future shell primitives will use
        background: token('background'),
        foreground: token('foreground'),
        card: {
          DEFAULT: token('card'),
          foreground: token('card-foreground'),
        },
        popover: {
          DEFAULT: token('popover'),
          foreground: token('popover-foreground'),
        },
        primary: {
          DEFAULT: token('primary'),
          foreground: token('primary-foreground'),
        },
        secondary: {
          DEFAULT: token('secondary'),
          foreground: token('secondary-foreground'),
        },
        muted: {
          DEFAULT: token('muted'),
          foreground: token('muted-foreground'),
        },
        accent: {
          DEFAULT: token('accent'),
          foreground: token('accent-foreground'),
        },
        destructive: token('destructive'),
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        serif: ['Newsreader', 'Georgia', 'serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'Consolas', 'monospace'],
      },
      borderRadius: {
        chip: '2px',
      },
      // A named stack, so nothing ever reaches for 999. Everything below `overlay` is the
      // canvas itself. The player fog mask (a later lane) draws inside the canvas, not here.
      zIndex: {
        overlay: '10',
        toolbar: '20',
        banner: '30',
        toast: '40',
      },
      boxShadow: {
        panel: 'var(--panel-shadow)',
      },
      transitionTimingFunction: {
        // ease-out-quart: state settles fast and stops. No bounce, no elastic.
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
        // ease-settle: the Moss popover/drawer curve — quint ease-out.
        settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // The drawer/popover entrance (M1): settle in, not slide.
        'panel-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        // The ticker's line crossfade — opacity only, no motion.
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'toast-in': 'toast-in 200ms cubic-bezier(0.25, 1, 0.5, 1) both',
        'panel-in': 'panel-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 150ms cubic-bezier(0.25, 1, 0.5, 1) both',
      },
    },
  },
  plugins: [],
} satisfies Config
