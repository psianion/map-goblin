import { lazy, Suspense, useState } from 'react';
import type { NewMapModalProps } from './NewMapModal';

// The dialog reaches the engine (image imports, grid calibration), so the home page loads
// it on first open instead of with the page.
const NewMapModal = lazy(() => import('./NewMapModal').then((m) => ({ default: m.NewMapModal })));

/** The New map dialog, loaded the first time it opens and kept after for its close. */
export function LazyNewMapModal(props: NewMapModalProps) {
  const [wanted, setWanted] = useState(props.open);
  if (props.open && !wanted) setWanted(true);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <NewMapModal {...props} />
    </Suspense>
  );
}
