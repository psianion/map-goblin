import { useStore } from '@/store/store';

/**
 * Hook for reading and toggling the continuous placement mode.
 * Used by the ToolPropsBar checkbox.
 */
export function useContinuousPlacement(): {
  continuousPlacement: boolean;
  setContinuousPlacement: (v: boolean) => void;
} {
  const value = useStore((s) => s.tools.settings.continuousPlacement);
  const update = useStore((s) => s.updateToolSettings);

  return {
    continuousPlacement: value,
    setContinuousPlacement: (v: boolean) => update({ continuousPlacement: v }),
  };
}
