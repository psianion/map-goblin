import type { Config } from 'tailwindcss'

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Surface hierarchy — Achromatic Shell
        'surface-0': '#0E0E0E',   // canvas bg, deepest
        'surface-1': '#141414',   // panel bg
        'surface-2': '#1E1E1E',   // card bg, nested surfaces
        'surface-3': '#282828',   // active/pressed, hover
        // Text hierarchy
        'text-primary':   '#E8E8E8',
        'text-secondary': '#999999',
        'text-muted':     '#666666',
        // Border system
        'border-subtle':  '#1E1E1E',
        'border-default': '#252525',  // all standard borders
        'border-focus':   '#FFFFFF',
        // Accent system — achromatic
        'accent-active':  '#FFFFFF',  // active state highlight (white)
        'accent-dim':     '#999999',  // secondary accent
        // Semantic
        'danger':   '#C0392B',
        'warning':  '#D4A017',
        'success':  '#2ECC71',
      },
      fontFamily: {
        display: ['Cinzel', 'serif'],
        mono:    ['Space Mono', 'monospace'],
        sans:    ['Raleway', 'sans-serif'],
        body:    ['Raleway', 'sans-serif'],
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
    },
  },
  plugins: [],
} satisfies Config
