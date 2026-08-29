import { createContext } from 'react'

/**
 * The layer tree's scroll element — provided by LayerPanel, consumed by the
 * virtualized asset lists (react-virtual needs the actual scroller). Lives
 * outside the component files so fast refresh keeps working there.
 */
export const TreeScrollContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null)
