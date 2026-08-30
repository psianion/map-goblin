import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// tailwind-merge only knows Tailwind's stock scale, so it reads our custom
// fontSize utilities (text-panel-body etc., tailwind.config.ts) as text
// COLORS and silently drops one side of e.g. cn('text-panel-body',
// 'text-text-primary'). Teach it they're sizes.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["panel-heading", "panel-label", "panel-body", "panel-small", "tab-label", "strip-label"] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
