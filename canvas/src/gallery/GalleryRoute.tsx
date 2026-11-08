import { useState } from 'react';
import { Seg } from '@/editor/components';
import { TooltipProvider } from '@/ui/tooltip';
import { BarsSection } from './BarsSection';
import { ButtonsSection } from './ButtonsSection';
import { ControlsSection } from './ControlsSection';
import { DockSection } from './DockSection';
import { GuttersSection } from './GuttersSection';
import { HeadersSection } from './HeadersSection';
import { IconButtonsSection } from './IconButtonsSection';
import { OverlaysSection } from './OverlaysSection';
import type { GalleryTheme } from './parts';
import { RowsSection } from './RowsSection';
import { SpacingSection } from './SpacingSection';
import { TilesSection } from './TilesSection';
import { TokensSection } from './TokensSection';
import { TypeSection } from './TypeSection';

/** The sections in the order of docs/plans/canvas-v2-shell/mockups/design-system.html. */
const SECTIONS = [
  TokensSection,
  TypeSection,
  SpacingSection,
  IconButtonsSection,
  ButtonsSection,
  ControlsSection,
  TilesSection,
  RowsSection,
  HeadersSection,
  DockSection,
  BarsSection,
  OverlaysSection,
  GuttersSection,
];

// The class goes on <html> before the sections render, so the token values they read are
// the new theme's.
function apply(theme: GalleryTheme): GalleryTheme {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  return theme;
}

/**
 * `/gallery`, development only: every design-system section drawn from the real primitives
 * and composites, one theme at a time, to open beside the mockup page. `?theme=dark` opens dark.
 */
function GalleryRoute() {
  const [theme, setTheme] = useState<GalleryTheme>(() =>
    apply(new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'),
  );
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-sheet font-sans text-[14px] leading-normal text-text">
        <div className="mx-auto max-w-[1320px] px-4 pt-7 pb-20">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="mb-1.5 text-[22px] font-semibold tracking-[-0.01em]">Canvas v2 design system · gallery</h1>
              <p className="max-w-[76ch] text-text-2">
                Every section of the design-system page, drawn from the components in src/ui and src/editor/components.
                Open it beside mockups/design-system.html and compare one theme at a time.
              </p>
            </div>
            <Seg
              aria-label="Theme"
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              value={theme}
              onValueChange={(next) => setTheme(apply(next as GalleryTheme))}
            />
          </div>
          {SECTIONS.map((S, i) => (
            <S key={i} theme={theme} />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

export { GalleryRoute };
