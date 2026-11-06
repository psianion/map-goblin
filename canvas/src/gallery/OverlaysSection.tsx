import { useState } from 'react';
import { Download, Keyboard, Maximize, Package, Settings2 } from 'lucide-react';
import { PrimaryButton, SecondaryButton } from '@/editor/components';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Kbd } from '@/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { Item, Section, Specimens, type GalleryTheme } from './parts';

// The tooltip and the menu are held open, each beside a zero-size anchor at the top left of
// the room kept for it, so they sit in the flow like the page's specimens.
const anchor = <span className="block size-0" />;

function OverlaysSection({ theme }: { theme: GalleryTheme }) {
  const [dialog, setDialog] = useState(false);
  return (
    <Section
      id="overlays"
      title="Overlays"
      small="Tooltip, menu, dialog, toast"
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
        <Item cap={'toast 36 · ink · pad 12 · one verb · 5 s\nnot built yet: no toast primitive in src/ui'}>
          <div className="h-9" />
        </Item>
      </Specimens>
    </Section>
  );
}

export { OverlaysSection };
