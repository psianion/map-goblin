import { ShortcutHelpDialog } from 'map-builder';

// The dialog owns all of its copy — rendering it open is the whole story, and
// it is the densest block of type in the system, so it doubles as the
// font/spacing check for the DS.
export function Open() {
  return <ShortcutHelpDialog open onOpenChange={() => {}} />;
}
