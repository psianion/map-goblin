import { create } from 'zustand';

export type MapFamily = 'rooms' | 'doors' | 'lights' | 'triggers' | 'levels' | 'labels';

/** Which family the Map tab's strip shows. */
export const useMapFamily = create<{ family: MapFamily }>()(() => ({ family: 'rooms' }));
