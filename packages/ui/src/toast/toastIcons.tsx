// Compact animated toast icons — each type gets a unique micro-animation via CSS class.
// Icons are 16px lucide-react wrapped in a span with animation trigger class.
// This is a utility module, not a React component file.

import { createElement, type ReactElement } from 'react';
import {
  Trash2, Check, Undo2, Redo2, Copy, ClipboardPaste,
  Plus, Minus, X, AlertTriangle, Download, Loader2,
  Info, Wrench, Save, Grid3X3, Lock, Unlock, Eye, EyeOff,
  Scissors, Palette, PenLine, Map, Focus, Layers,
} from 'lucide-react';

const S = 16;

/** Wrap a lucide icon in an animated span. Uses createElement to avoid fast-refresh false positive. */
function wrap(cls: string, Icon: typeof Trash2): ReactElement {
  return createElement('span', { className: `ti ${cls}` }, createElement(Icon, { size: S }));
}

const toastIcons = {
  trash:    () => wrap('ti-trash', Trash2),
  check:    () => wrap('ti-check', Check),
  save:     () => wrap('ti-check', Save),
  undo:     () => wrap('ti-undo', Undo2),
  redo:     () => wrap('ti-redo', Redo2),
  copy:     () => wrap('ti-copy', Copy),
  paste:    () => wrap('ti-paste', ClipboardPaste),
  plus:     () => wrap('ti-plus', Plus),
  minus:    () => wrap('ti-minus', Minus),
  error:    () => wrap('ti-error', X),
  warning:  () => wrap('ti-warning', AlertTriangle),
  download: () => wrap('ti-download', Download),
  loading:  () => wrap('ti-loading', Loader2),
  info:     () => wrap('ti-info', Info),
  tool:     () => wrap('ti-tool', Wrench),
  grid:     () => wrap('ti-tool', Grid3X3),
  lock:     () => wrap('ti-tool', Lock),
  unlock:   () => wrap('ti-tool', Unlock),
  eye:      () => wrap('ti-tool', Eye),
  eyeOff:   () => wrap('ti-tool', EyeOff),
  scissors: () => wrap('ti-trash', Scissors),
  palette:  () => wrap('ti-tool', Palette),
  rename:   () => wrap('ti-tool', PenLine),
  map:      () => wrap('ti-tool', Map),
  focus:    () => wrap('ti-tool', Focus),
  layers:   () => wrap('ti-tool', Layers),
} as const;

export type ToastIconKey = keyof typeof toastIcons;

export function resolveIcon(key: ToastIconKey): ReactElement {
  return toastIcons[key]();
}
