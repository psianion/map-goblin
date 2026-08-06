import type { Config } from 'tailwindcss'

/**
 * Moss — the Good Goblin chrome theme.
 *
 * Every colour resolves to a CSS variable declared in `src/index.css` (`:root` = day,
 * `.dark` = night), written as `rgb(var(--x) / <alpha-value>)` so Tailwind's opacity
 * modifier works on all of them: `bg-surface-1/80`, `ring-ring/50`, `bg-destructive/10`.
 *
 * Both vocabularies are declared here on purpose. Components use the Tailwind names
 * (surface-*, text-*, border-*, accent-*) and the shadcn names (primary, muted, ring,
 * border, ...) interchangeably — but only the first half was ever in this file, so
 * `bg-muted`, `bg-primary`, `ring-ring` and `border-border` compiled to nothing across
 * ~124 call sites. Declaring both against one set of values is what makes button
 * hovers, focus rings and destructive tints exist at all.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // v3's ringWidth scale has no `3` key, so `ring-3`/`focus-visible:ring-3`
      // silently compiled to nothing and every focus ring using them vanished
      // from the build. Check the BUILT css when touching this, not the source.
      ringWidth: {
        3: '3px',
      },
      colors: {
        // Surface hierarchy — the table the map lies on
        'surface-0': token('surface-0'),
        'surface-1': token('surface-1'),
        'surface-2': token('surface-2'),
        'surface-3': token('surface-3'),
        // Text hierarchy
        'text-primary':   token('text-primary'),
        'text-secondary': token('text-secondary'),
        'text-muted':     token('text-muted'),
        'text-dim':       token('text-dim'),
        // Ink weights — heavier on structure, lighter on ground clutter
        'border-structure': token('border-structure'),
        'border-default':   token('border-default'),
        'border-subtle':    token('border-subtle'),
        'border-focus':     token('border-focus'),
        // Accent — one focal per screen
        'accent-active':  token('accent-active'),
        'accent-dim':     token('accent-dim'),
        'on-accent':      token('on-accent'),
        // Semantic — distinct from the accent by hue AND by shape at the call site,
        // because with a green accent `success` and `accent-active` are the same hue.
        'danger':   token('danger'),
        'warning':  token('warning'),
        'success':  token('success'),
        'info':     token('info'),

        // shadcn vocabulary — same values, the names button.tsx and dialogs use
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
        // Newsreader carries panel and section headers only — old-style ink traps and
        // optical sizing, so headers read as set rather than as bigger body text.
        display: ['Newsreader', 'Georgia', 'serif'],
        // Plex Sans is the workhorse: humanist, warm, and legible at the 10–12px
        // authoring density the property panels run at.
        sans:    ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        body:    ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        // Numbers that tick — coordinates, latency, zoom — need tabular figures.
        mono:    ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'panel-heading': ['10px', { lineHeight: '16px', fontWeight: '400', letterSpacing: '0.1em' }],
        'panel-label':   ['10px', { lineHeight: '14px', fontWeight: '400', letterSpacing: '0.1em' }],
        'panel-body':    ['11px', { lineHeight: '16px' }],
        'panel-small':   ['10px', { lineHeight: '14px' }],
        'tab-label':     ['12px', { lineHeight: '16px', fontWeight: '600' }],
        'strip-label':   ['7px',  { lineHeight: '10px', letterSpacing: '0.1em' }],
      },
      // Color chip / swatch sizing tokens
      width: {
        'chip':    '56px',
        'chip-sm': '14px',
        'chip-md': '22px',
      },
      height: {
        'chip':    '20px',
        'chip-sm': '14px',
        'chip-md': '22px',
      },
      borderRadius: {
        'chip': '2px',
        'chip-md': '3px',
      },
      boxShadow: {
        panel: 'var(--panel-shadow)',
      },
      transitionTimingFunction: {
        // Ease-out quint — state settles, never bounces.
        settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config
