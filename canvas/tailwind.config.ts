import type { Config } from 'tailwindcss'
import preset from '@dnd/ui/tailwind-preset'

// The design system is the @dnd/ui preset; the content globs include the package so the
// classes its primitives and components use make it into the build.
export default {
  presets: [preset],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", "../packages/ui/src/**/*.{ts,tsx}"],
} satisfies Config
