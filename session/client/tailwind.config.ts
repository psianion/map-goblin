import type { Config } from 'tailwindcss'

// ponytail: stock theme. Canvas's shadcn token block gets copied here when this
// package actually grows components (C2/C3), not before.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
