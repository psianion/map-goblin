import type { Config } from 'tailwindcss'

/**
 * The design system, read from `theme/tokens.css` (`:root` light, `.dark` dark). Each app's
 * tailwind.config.ts takes this as its preset and adds its own `content` globs, which must
 * include this package's .ts and .tsx sources.
 *
 * The tokens are hex, so each colour goes through `color-mix` to keep Tailwind's opacity
 * modifier working on all of them: `bg-panel/95`, `bg-danger/10`, `bg-ink/10`.
 */
const token = (name: string) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`

export default {
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
        bg: token('bg'),
        dot: token('dot'),
        sheet: token('sheet'),
        panel: token('panel'),
        'panel-2': token('panel-2'),
        'panel-3': token('panel-3'),
        line: token('line'),
        'line-strong': token('line-strong'),
        text: token('text'),
        'text-2': token('text-2'),
        'text-3': token('text-3'),
        ink: token('ink'),
        'on-ink': token('on-ink'),
        'ink-hover': token('ink-hover'),
        focus: token('focus'),
        danger: token('danger'),
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        // Numbers that tick — coordinates, latency, zoom — need tabular figures.
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        key: 'var(--radius-key)',
        control: 'var(--radius-control)',
        float: 'var(--radius-float)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        e: 'var(--e-shadow)',
      },
    },
  },
  plugins: [],
} satisfies Partial<Config>
