import type { Config } from 'tailwindcss'

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Surface hierarchy (Stone Cold Dark)
        'surface-0': '#0E0E0E',
        'surface-1': '#181818',
        'surface-2': '#222222',
        'surface-3': '#2A2A2A',
        // Text hierarchy
        'text-primary':   '#E8E8E8',
        'text-secondary': '#999999',
        'text-muted':     '#666666',
        // Border system
        'border-subtle':  '#1E1E1E',
        'border-default': '#2A2A2A',
        'border-focus':   '#FFFFFF',
      },
      fontSize: {
        'panel-heading': ['11px', { lineHeight: '16px', fontWeight: '600', letterSpacing: '0.04em' }],
        'panel-body':    ['13px', { lineHeight: '18px' }],
        'panel-small':   ['11px', { lineHeight: '15px' }],
      },
    },
  },
  plugins: [],
} satisfies Config
