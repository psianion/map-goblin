import type { Config } from 'tailwindcss'

// The runner's chrome speaks the editor's visual language: this colour scale, the radius
// and the semantic vocabulary are copied verbatim from `canvas/tailwind.config.ts`
// (the editor's "Achromatic Shell" block, mirrored by the shadcn variables in index.css).
// Copied deliberately rather than imported — canvas is an app, not a shared package, and a
// build-time dependency from the runner onto it would be worse than 20 lines of colours.
//
// Two things of canvas's are *not* copied. Its type scale (10–12px panel sizes) is an
// authoring-app density the runner cannot use: this chrome is read across a table in a dim
// room. And its font families (Cinzel/Raleway) come with a Google Fonts request — a table
// mid-session must never wait on, or fail against, a CDN, and display faces are wrong on UI
// labels anyway. System sans it is.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface hierarchy — deepest first. The map is the stage; chrome sits quietly on it.
        'surface-0': '#0E0E0E',
        'surface-1': '#141414',
        'surface-2': '#1E1E1E',
        'surface-3': '#282828',
        // Text hierarchy. `text-muted` clears 4.5:1 only against surface-0/1 at ≥18px —
        // body copy uses primary or secondary.
        'text-primary': '#E8E8E8',
        'text-secondary': '#999999',
        'text-muted': '#666666',
        // Borders
        'border-subtle': '#1E1E1E',
        'border-default': '#252525',
        'border-focus': '#FFFFFF',
        // Accent — achromatic, so colour never becomes the only state encoding.
        'accent-active': '#FFFFFF',
        'accent-dim': '#999999',
        // Semantic
        danger: '#C0392B',
        warning: '#D4A017',
        success: '#2ECC71',
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
      transitionTimingFunction: {
        // ease-out-quart: state settles fast and stops. No bounce, no elastic.
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
      keyframes: {
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'toast-in': 'toast-in 200ms cubic-bezier(0.25, 1, 0.5, 1) both',
      },
    },
  },
  plugins: [],
} satisfies Config
