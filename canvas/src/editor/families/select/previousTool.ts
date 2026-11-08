import { useRegistry } from '@/editor/shell/registryContext';
import { useShell } from '@/editor/shell/shellStore';
import { pickTool } from '@/editor/surfaces/hooks';

/** Previous tool: back to the last family tool in hand, if there was one. */
export function usePreviousTool() {
  const { registry } = useRegistry();
  const lastId = useShell((s) => s.lastToolId);
  const last = lastId ? registry.toolById(lastId) : undefined;
  return { last, back: () => (last ? pickTool(last) : undefined) };
}
