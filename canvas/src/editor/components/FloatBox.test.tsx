import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { render } from '@testing-library/react';
import { FloatBox } from './FloatBox';

describe('FloatBox', () => {
  it('is the float: panel, hairline, radius 8, float shadow, 8 to its content', () => {
    const ref = createRef<HTMLDivElement>();
    render(<FloatBox ref={ref}>body</FloatBox>);
    for (const c of ['bg-panel', 'border', 'border-line', 'rounded-float', 'shadow-e', 'p-2'])
      expect(ref.current!.className.split(' ')).toContain(c);
  });

  it('lets a surface that draws edge to edge drop the padding', () => {
    const ref = createRef<HTMLDivElement>();
    render(<FloatBox ref={ref} className="p-0" />);
    expect(ref.current!.className.split(' ')).toContain('p-0');
    expect(ref.current!.className.split(' ')).not.toContain('p-2');
  });
});
