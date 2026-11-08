import { useRole } from '../../session/store';
import { sheetDef, useSheet } from './registry';

/** Renders whichever sheet is open, if the role may see it. */
export function SheetHost() {
  const open = useSheet();
  const role = useRole();
  const def = open ? sheetDef(open.id) : undefined;
  if (!open || !def || !role || (def.roles && !def.roles.includes(role))) return null;
  const { Component } = def;
  return <Component key={open.id} {...open.props} />;
}
