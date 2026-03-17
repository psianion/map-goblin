interface PresetChip {
  id: string;
  label: string;
  color?: string;
}

interface PresetStripProps {
  presets: PresetChip[];
  activeId?: string;
  onSelect: (id: string) => void;
}

export function PresetStrip({ presets, activeId, onSelect }: PresetStripProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto scrollbar-hide py-0.5">
      {presets.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={p.id === activeId}
          onClick={() => onSelect(p.id)}
          className={`
            flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-mono
            whitespace-nowrap cursor-pointer transition-colors
            ${p.id === activeId
              ? 'bg-surface-3 text-text-primary border border-white/30'
              : 'bg-surface-2 text-text-muted border border-transparent hover:bg-surface-3'
            }
          `}
        >
          {p.color && (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: p.color }}
            />
          )}
          {p.label}
        </button>
      ))}
    </div>
  );
}
