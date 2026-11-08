import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { z } from 'zod';
import { useStore } from '@/store/store';
import { defineSetting } from '@/editor/registry/define';
import { useSettingValue } from './hooks';

// A binding that builds its value afresh on every read, as a list or a record would.
let picked = ['a'];
const list = defineSetting<string[]>({
  id: 'test.freshList',
  label: 'Fresh list',
  schema: z.array(z.string()),
  default: ['a'],
  home: 'dock',
  control: 'custom',
  render: () => null,
  persist: false,
  bind: {
    read: () => [...picked],
    write: (store, v) => {
      picked = v;
      store.setState({});
    },
  },
});

describe('useSettingValue', () => {
  it('does not re-render without end when a read returns a fresh list', () => {
    let renders = 0;
    function Probe() {
      renders++;
      return <span data-testid="v">{(useSettingValue(list) as string[]).join(',')}</span>;
    }
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('v').textContent).toBe('a');
    const settled = renders;

    // Store changes that leave the value as it was re-render nothing.
    act(() => useStore.getState().setCurveMode(true));
    act(() => useStore.getState().setCurveMode(false));
    expect(renders).toBe(settled);

    // A real change comes through.
    act(() => list.bind!.write(useStore, ['a', 'b']));
    expect(getByTestId('v').textContent).toBe('a,b');
  });
});
