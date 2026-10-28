import type { ReactNode, SVGProps } from 'react';

/* The rooms UI's own glyphs, drawn on lucide's 24-unit grid with its stroke so they sit
 * beside lucide icons unnoticed. */

export interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, 'stroke'> {
  size?: number;
  strokeWidth?: number;
}

function glyph(children: ReactNode, filled = false) {
  return function Glyph({ size = 16, strokeWidth = 1.75, ...rest }: GlyphProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...rest}
      >
        {children}
      </svg>
    );
  };
}

export const RoomRectIcon = glyph(<rect x="4" y="4" width="16" height="16" rx="2" />);
export const RoomPolygonIcon = glyph(<path d="M12 3l9 6.5-3.5 10.5h-11L3 9.5z" />);
export const DivideIcon = glyph(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M12 3v18" strokeDasharray="3 3" />
  </>,
);
export const SuggestIcon = glyph(
  <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM5 18l.7 1.8L7.5 20.5l-1.8.7L5 23l-.7-1.8L2.5 20.5l1.8-.7z" />,
);
export const RoomsListIcon = glyph(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </>,
);
export const RenumberIcon = glyph(
  <>
    <path d="M4 6h10M4 12h16M4 18h12" />
    <path d="M18 4v5M16 6.5l2-2.5 2 2.5" />
  </>,
);
export const NewAreaIcon = glyph(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M12 9v6M9 12h6" />
  </>,
);
export const KeyDocIcon = glyph(<path d="M5 4h10l4 4v12H5zM15 4v4h4M8 13h8M8 17h5" />);
export const EncounterIcon = glyph(<path d="M4 4l10 10M20 4L10 14M14 14l4 4M10 14l-4 4" />);
export const LevelIcon = glyph(<path d="M12 3l9 5-9 5-9-5z" />);
export const GripIcon = glyph(
  <>
    <circle cx="9" cy="6" r="1.5" />
    <circle cx="15" cy="6" r="1.5" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="18" r="1.5" />
    <circle cx="15" cy="18" r="1.5" />
  </>,
  true,
);
