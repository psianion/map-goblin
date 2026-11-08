import { Section, type GalleryTheme } from './parts';

// The page's order and roles; the values are read live from @dnd/ui theme/tokens.css.
const TOKENS: [string, string][] = [
  ['bg', 'canvas behind the map'],
  ['dot', 'grid dots'],
  ['sheet', 'sheet background'],
  ['panel', 'floats, rail, bars'],
  ['panel-2', 'hover, kbd, input'],
  ['panel-3', 'chosen cell, hover on icon'],
  ['line', 'every hairline'],
  ['line-strong', 'slider track, dashed add'],
  ['text', 'values, names'],
  ['text-2', 'labels, icons'],
  ['text-3', 'captions, keys, hints'],
  ['ink', 'primary, ring, thumb'],
  ['on-ink', 'text on ink'],
  ['ink-hover', 'primary hover'],
  ['focus', 'focus outline'],
  ['danger', 'delete only'],
];

function TokensSection({ theme }: { theme: GalleryTheme }) {
  const css = getComputedStyle(document.documentElement);
  return (
    <Section
      id="tokens"
      title="Colour tokens"
      small="@dnd/ui theme/tokens.css, read live"
      theme={theme}
      rules="Text on panel uses text for values, text-2 for labels, text-3 for captions and keys. Lines are hairline only, 1px, line for rest and line-strong for slider tracks. Danger is reserved for delete. No second accent anywhere."
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5">
        {TOKENS.map(([name, role]) => (
          <div key={name} className="flex flex-col gap-1.5">
            <i className="block h-11 rounded-control border border-line" style={{ background: `var(--${name})` }} />
            <b className="text-[11px] font-medium text-text">{name}</b>
            <small className="font-mono text-[10px] text-text-3">{css.getPropertyValue(`--${name}`).trim()}</small>
            <small className="font-mono text-[10px] text-text-3">{role}</small>
          </div>
        ))}
      </div>
    </Section>
  );
}

export { TokensSection };
