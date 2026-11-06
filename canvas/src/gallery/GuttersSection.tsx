import { Hand, House, MousePointer2, PencilRuler, Redo2, Undo2 } from 'lucide-react';
import { FloatBox, IconKeyButton, PanelHeader, PrimaryButton } from '@/editor/components';
import { Separator } from '@/ui/separator';
import { Section, type GalleryTheme } from './parts';

// The page's gutter labels, in danger so they read as annotations, not chrome.
const GUTTERS: [string, React.CSSProperties][] = [
  ['12', { left: 58, top: 14 }],
  ['12', { left: 58, top: 70 }],
  ['12', { left: 160, top: 56 }],
  ['12', { right: 4, top: 70 }],
  ['12 above dock', { right: 4, top: 184 }],
  ['12', { left: 342, top: 200 }],
];

function GuttersSection({ theme }: { theme: GalleryTheme }) {
  return (
    <Section id="gutters" title="Gutters at the screen edge" small="How the surfaces sit together" theme={theme}>
      <div className="relative flex h-[260px] gap-3 overflow-hidden rounded-control bg-bg">
        <FloatBox className="flex h-[260px] w-14 flex-col items-center gap-2.5 rounded-none px-0 py-3">
          <IconKeyButton size={36} icon={MousePointer2} label="Select" shortcut="V" />
          <IconKeyButton size={36} icon={Hand} label="Pan" shortcut="H" />
          <Separator className="my-1.5 w-6" />
          <IconKeyButton size={36} icon={PencilRuler} label="Design" shortcut="D" active />
        </FloatBox>
        <FloatBox className="absolute top-3 left-[68px] inline-flex h-11 items-center gap-2 px-2 py-0">
          <IconKeyButton icon={House} label="Home" />
          <span className="text-[13px] font-medium">Warren of the Pale Moth</span>
        </FloatBox>
        <FloatBox className="absolute top-[68px] left-[68px] h-[150px] w-[272px] p-0">
          <PanelHeader path={['Design']} title="Floor" />
        </FloatBox>
        <FloatBox className="absolute top-3 right-3 inline-flex h-11 items-center gap-2 px-2 py-0">
          <IconKeyButton icon={Undo2} label="Undo" shortcut="Z" />
          <IconKeyButton icon={Redo2} label="Redo" shortcut="Y" />
          <PrimaryButton>Publish</PrimaryButton>
        </FloatBox>
        <FloatBox className="absolute top-[68px] right-3 h-[110px] w-[200px] p-0">
          <PanelHeader title="Assets" />
        </FloatBox>
        <FloatBox className="absolute top-[190px] left-[352px] h-10 w-[400px] p-0" />
        {GUTTERS.map(([label, at], i) => (
          <span key={i} className="absolute font-mono text-[9px] text-danger" style={at}>
            {label}
          </span>
        ))}
      </div>
      <div className="mt-2 font-mono text-[10px] text-text-3">
        12px from every edge, 12px between floats, the asset panel ends 12px above the dock, the dock is 12px above the status bar
      </div>
    </Section>
  );
}

export { GuttersSection };
