import { useCallback, useRef } from 'react';
import type { RenderEngine } from '../engine/RenderEngine';
import { handleImageImport } from './importImage';

/**
 * Returns an `open` function that triggers a file-input dialog.
 * Call `open()` from a toolbar "Import Image" button.
 */
export function useImageFilePicker(engine: RenderEngine | null): () => void {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return useCallback(() => {
    if (!engine) return;

    let input = inputRef.current;
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/svg+xml,image/webp';
      inputRef.current = input;
    }

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) await handleImageImport(file, engine);
      input!.value = ''; // reset so same file can be re-picked
    };

    input.click();
  }, [engine]);
}
