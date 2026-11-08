import type { Config } from 'tailwindcss'
import preset from '@dnd/ui/tailwind-preset'

const token = (name: string) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`

// The old shell's class names, pointed at the shared tokens while its last surfaces are
// replaced. Goes with the old shell; new surfaces use the preset's names only.
const legacy = {
  colors: {
    'surface-0': token('bg'),
    'surface-1': token('panel'),
    'surface-2': token('panel-2'),
    'surface-3': token('panel-3'),
    'text-primary': token('text'),
    'text-secondary': token('text-2'),
    'text-muted': token('text-3'),
    'text-dim': token('text-2'),
    'border-structure': token('line-strong'),
    'border-default': token('line'),
    'border-subtle': token('line'),
    'border-focus': token('ink'),
    'accent-active': token('ink'),
    'accent-dim': token('text-3'),
    'on-accent': token('on-ink'),
    accent: token('panel-3'),
    primary: token('ink'),
    muted: token('text-3'),
    warning: token('danger'),
    success: token('ink'),
    info: token('text-2'),
  },
  zIndex: { overlay: '10', toolbar: '20', banner: '30', toast: '40', 'sidebar-overlay': '31' },
  boxShadow: { panel: 'var(--e-shadow)' },
  borderRadius: { chip: 'var(--radius-key)' },
  fontFamily: { serif: ['IBM Plex Sans', 'system-ui', 'sans-serif'] },
  transitionTimingFunction: {
    'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
    settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
  keyframes: {
    'toast-in': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
    'panel-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
    'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
  },
  animation: {
    'toast-in': 'toast-in 200ms cubic-bezier(0.25, 1, 0.5, 1) both',
    'panel-in': 'panel-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
    'fade-in': 'fade-in 150ms cubic-bezier(0.25, 1, 0.5, 1) both',
  },
}

// The design system is the @dnd/ui preset; the content globs include the package so the
// classes its primitives and components use make it into the build.
export default {
  presets: [preset],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: { extend: legacy },
} satisfies Config
