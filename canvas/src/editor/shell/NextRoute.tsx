// `/next`: the new shell over the same canvas, store and map as the editor at `/`, so the
// two can be compared side by side. Development only (main.tsx guards it); it renders the
// real families that have landed and the stub registry for the rest. The v2 styles load
// because the sheets that come over as they are still use them.

import { useEffect } from 'react';
import { EditorHost, type EditorChromeProps } from '@/editor/EditorHost';
import { setEditorDesk, type EditorDesk } from '@dnd/core/src/engine/editorDesk';
import { initTheme, useTheme } from '@/v2/theme';
import { readDesk } from '@/v2/desk';
import { initLightBrush, initLitOnLight, initMarqueePrefs, initPropPrefs, initRoomPrefs, useLitPreview } from '@/v2/viewPrefs';
import { SHELL_TOASTER } from '@/editor/surfaces/toaster';
import { EditorShell } from './EditorShell';
import { useShell } from './shellStore';
import { createRegistry, registry } from '@/editor/registry';
import { stubInput } from './stub/stubRegistry';
import { withStubs } from './stub/withStubs';
import '@/v2/v2.css';
import '@/v2/editor/v2-editor.css';

// The shell's view state, for the frame specs (the store is already on window in dev).
(window as Window & { __shell?: typeof useShell }).__shell = useShell;

initTheme();
initRoomPrefs();
initPropPrefs();
initMarqueePrefs();
initLightBrush();
initLitOnLight();

function deskFromTokens(): EditorDesk {
  const css = getComputedStyle(document.documentElement);
  return readDesk((name) => css.getPropertyValue(name), document.documentElement.classList.contains('dark'));
}

// The registered families, and a stub for each one not registered yet.
const nextRegistry = createRegistry(withStubs(registry, stubInput));

function NextChrome(props: EditorChromeProps) {
  return <EditorShell {...props} registry={nextRegistry} />;
}

export function NextRoute() {
  const [theme] = useTheme();
  const lit = useLitPreview();
  useEffect(() => {
    setEditorDesk({ ...deskFromTokens(), lit });
  }, [theme, lit]);
  useEffect(() => () => setEditorDesk(null), []);
  // Home is the editor at `/`, which has the maps page.
  return <EditorHost home={false} onHome={() => window.location.assign('/')} openSettings={false} chrome={NextChrome} toaster={SHELL_TOASTER} />;
}
