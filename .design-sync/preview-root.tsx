// Preview-only theme root for design-sync cards. Not part of the product.
//
// The app ships <html lang="en" class="dark"> hardcoded (canvas/index.html), so
// the night theme is the only one it ever renders. In the stylesheet, `:root`
// defines the indirections (--background: var(--surface-0)) while `.dark`
// overrides only the RAW tokens (--surface-0, --text-primary, ...). Those
// resolve on the element that carries them, so `.dark` only works when it sits
// on the SAME element as `:root` — documentElement.
//
// Measured on this bundle:
//   .dark on <div>   -> bg-background 223,227,222 (light) + --surface-0 15,16,14 (dark)  = half-themed
//   .dark on <html>  -> bg-background 15,16,14   (dark)  + --surface-0 15,16,14 (dark)  = correct
//
// Hence documentElement, not a wrapper element. The effect is deliberately
// scoped to this component (never module scope) so the DS's light `:root`
// stays intact for designs that don't opt in.
import { useLayoutEffect, type ReactNode } from 'react';

// Re-exported so previews can read REAL domain objects (a Layer, a child, the
// ids the panels expect) out of the app's own store instead of fabricating
// look-alike fixtures that rot the moment the schema moves. It is a hook, so
// the converter never emits a card for it.
export { useStore } from '@/store/store';

// The product's real style presets. PresetGrid renders each tile as a SWATCH
// derived from preset.dungeonStyle (the label is only a tooltip), so stub
// presets with an empty style render six identical blank tiles.
export { DUNGEON_STYLE_PRESETS } from '@/store/presetRegistry';

// The card template hardcodes `body{...background:#fff}` in an inline <style>,
// which outranks the stylesheet's `body{background-color:rgb(var(--background))}`.
// The app's own body rule is what makes ghost/outline variants legible, so we
// restore it as an ELEMENT style (beats any stylesheet rule) rather than forking
// the emitter, which defines the output contract with the app's self-check.
export function PreviewRoot({ children }: { children?: ReactNode }) {
  useLayoutEffect(() => {
    const el = document.documentElement;
    const had = el.classList.contains('dark');
    el.classList.add('dark');

    const { body } = document;
    const prev = {
      background: body.style.background,
      color: body.style.color,
      colorScheme: el.style.colorScheme,
    };
    body.style.background = 'rgb(var(--background))';
    body.style.color = 'rgb(var(--foreground))';
    el.style.colorScheme = 'dark';

    return () => {
      if (!had) el.classList.remove('dark');
      body.style.background = prev.background;
      body.style.color = prev.color;
      el.style.colorScheme = prev.colorScheme;
    };
  }, []);
  return <>{children}</>;
}
