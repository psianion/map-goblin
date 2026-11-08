import { useState } from 'react';
import { Download, Keyboard, Maximize, Package, Settings2 } from 'lucide-react';
import {
  PrimaryButton,
  SecondaryButton,
  Button,
  DownloadPill,
  LoadingScreen,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@dnd/ui';
import { Item, Section, Specimens, type GalleryTheme } from './parts';

// The tooltip and the menu are held open, each beside a zero-size anchor at the top left of
// the room kept for it, so they sit in the flow like the page's specimens.
const MB = 1024 * 1024;

const anchor = <span className="block size-0" />;

function OverlaysSection({ theme }: { theme: GalleryTheme }) {
  const [dialog, setDialog] = useState(false);
  const [paused, setPaused] = useState(false);
  return (
    <Section
      id="overlays"
      title="Overlays"
      small="Tooltip, menu, dialog, loading, download, toast"
      theme={theme}
      rules="Tooltips are ink-filled, 24 tall, label plus key. Menus are floats with 28px rows and 6px padding. Dialogs are floats at 320 wide with the primary action last. Toasts are ink-filled with one underlined undo verb and leave by themselves."
    >
      <Specimens>
        <Item cap="tooltip 24 · ink · label + key · 1 line">
          <div className="h-6 w-[120px]">
            <Tooltip open>
              <TooltipTrigger render={anchor} />
              <TooltipContent side="right" align="start" sideOffset={0}>
                Terrain brush <Kbd>B</Kbd>
              </TooltipContent>
            </Tooltip>
          </div>
        </Item>
        <Item cap="menu 232 · pad 6 · rows 28 · icon 14 gap 10 · meta mono right">
          <div className="h-[166px] w-[232px]">
            <DropdownMenu open modal={false}>
              <DropdownMenuTrigger nativeButton={false} render={anchor} />
              <DropdownMenuContent side="right" align="start" sideOffset={0} finalFocus={false}>
                <DropdownMenuItem>
                  <Settings2 />
                  Map settings…
                </DropdownMenuItem>
                <DropdownMenuItem className="bg-panel-2">
                  <Download />
                  Export…
                  <DropdownMenuShortcut>Ctrl E</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Package />
                  Packs…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Maximize />
                  Fit to content
                  <DropdownMenuShortcut>0</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Keyboard />
                  Keyboard shortcuts
                  <DropdownMenuShortcut>?</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Item>
        <Item cap={'dialog 320 · pad 16 · gap 12 · title 13/500 · actions right, primary last\nopens over the page, as it does in the editor'}>
          <SecondaryButton onClick={() => setDialog(true)}>Open the dialog</SecondaryButton>
          <Dialog open={dialog} onOpenChange={setDialog}>
            <DialogContent>
              <DialogTitle>Delete 3 props?</DialogTitle>
              <DialogDescription>They leave this layer. Undo brings them back.</DialogDescription>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(false)}>
                  Cancel
                </Button>
                <PrimaryButton onClick={() => setDialog(false)}>Delete</PrimaryButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Item>
        <Item cap={'loading screen · first load only · desk + card 320\nsteps, live step spins · bar · files and bytes'}>
          <div className="relative h-[200px] w-[360px] overflow-hidden rounded-float border border-line">
            <LoadingScreen
              title="Opening the map"
              steps={['Engine', 'Library index', 'Map textures']}
              current={2}
              progress={{ filesDone: 12, filesTotal: 40, bytesDone: 3.1 * MB, bytesTotal: 7.8 * MB }}
            />
          </div>
        </Item>
        <Item cap={'loading screen · indeterminate while nothing is counted'}>
          <div className="relative h-[200px] w-[360px] overflow-hidden rounded-float border border-line">
            <LoadingScreen title="Starting the canvas" steps={['Engine', 'Library index', 'Map textures']} current={0} />
          </div>
        </Item>
        <Item cap={'download pill 28 · ring 14 · mono 11 · chevron opens packs + Pause · × hides'}>
          <div className="flex flex-col items-start gap-2">
            <DownloadPill
              phase="library"
              progress={{ filesDone: 300, filesTotal: 900, bytesDone: 12.4 * MB, bytesTotal: 20 * MB }}
              packs={[
                { id: 'gg-forge', label: 'gg-forge', status: 'done' },
                { id: 'gg-demo', label: 'gg-demo', status: 'active', progress: { filesDone: 120, filesTotal: 829, bytesDone: 4 * MB, bytesTotal: 18.4 * MB } },
              ]}
              paused={paused}
              onPause={() => setPaused(true)}
              onResume={() => setPaused(false)}
              onHide={() => {}}
            />
            <DownloadPill phase="map" progress={{ filesDone: 3, filesTotal: 12, bytesDone: MB, bytesTotal: 3.1 * MB }} onHide={() => {}} />
          </div>
        </Item>
        <Item cap={'toast 36 · ink · pad 12 · one verb · 5 s\nnot built yet: no toast primitive in src/ui'}>
          <div className="h-9" />
        </Item>
      </Specimens>
    </Section>
  );
}

export { OverlaysSection };
