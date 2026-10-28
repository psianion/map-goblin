import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ColorCtl, Seg, Slider, Switch } from './controls';

afterEach(cleanup);

function SliderHarness({ onChange, onCommit }: { onChange: (v: number) => void; onCommit: (v: number, s: number) => void }) {
  const [v, setV] = useState(0.5);
  return (
    <Slider
      label="Opacity"
      value={v}
      min={0}
      max={1}
      step={0.1}
      format={(n) => n.toFixed(1)}
      onChange={(n) => {
        setV(n);
        onChange(n);
      }}
      onCommit={onCommit}
    />
  );
}

describe('Slider', () => {
  it('fires onChange during a drag and one onCommit with the start value on release', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<SliderHarness onChange={onChange} onCommit={onCommit} />);
    const input = screen.getByRole('slider', { name: 'Opacity' });
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: '0.7' } });
    fireEvent.change(input, { target: { value: '0.9' } });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(0.9);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(input);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.9, 0.5);
    expect(screen.getByText('0.9')).toBeTruthy();
  });

  it('commits a key run once', () => {
    const onCommit = vi.fn();
    render(<SliderHarness onChange={vi.fn()} onCommit={onCommit} />);
    const input = screen.getByRole('slider', { name: 'Opacity' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.change(input, { target: { value: '0.6' } });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.change(input, { target: { value: '0.7' } });
    fireEvent.keyUp(input, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.7, 0.5);
  });
});

describe('Switch', () => {
  it('exposes role switch with aria-checked and toggles', () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Switch label="Secret" checked={on} onChange={setOn} />;
    }
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Secret' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.className).toContain('v2-switch--on');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });
});

describe('Seg', () => {
  it('marks the selected option with aria-pressed', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Seg
        label="Kind"
        value="river"
        options={[
          { value: 'river', label: 'River' },
          { value: 'lake', label: 'Lake' },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('group', { name: 'Kind' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'River' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Lake' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Lake' }));
    expect(onChange).toHaveBeenCalledWith('lake');
    rerender(
      <Seg
        label="Kind"
        value="lake"
        options={[
          { value: 'river', label: 'River' },
          { value: 'lake', label: 'Lake' },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'Lake' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('ColorCtl', () => {
  function Harness({ onCommit }: { onCommit: (c: string, s: string) => void }) {
    const [c, setC] = useState('#ff0000');
    return <ColorCtl label="Floor" value={c} onChange={setC} onCommit={onCommit} />;
  }

  it('opens its picker, and commits once on close with the start colour', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const swatch = screen.getByRole('button', { name: 'Floor colour, #ff0000' });
    expect(swatch.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(swatch);
    expect(screen.getByRole('dialog', { name: 'Floor colour' })).toBeTruthy();
    expect(swatch.getAttribute('aria-expanded')).toBe('true');

    const hex = screen.getByRole('textbox', { name: 'Hex colour' });
    fireEvent.change(hex, { target: { value: '0f0' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Floor colour' })).toBeNull();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('#00ff00', '#ff0000');
  });

  it('closes and commits when the swatch is pressed again', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const swatch = screen.getByRole('button', { name: /Floor colour/ });
    fireEvent.click(swatch);
    fireEvent.click(swatch);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onCommit).toHaveBeenCalledWith('#ff0000', '#ff0000');
  });

  it('opens in a portal outside its card, fixed, and a press inside it keeps it open', () => {
    const onCommit = vi.fn();
    render(
      <section className="v2-float" data-testid="card">
        <Harness onCommit={onCommit} />
      </section>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Floor colour/ }));
    const pop = screen.getByRole('dialog', { name: 'Floor colour' });
    expect(screen.getByTestId('card').contains(pop)).toBe(false);
    expect(pop.style.position).toBe('fixed');
    expect(pop.hasAttribute('data-chrome')).toBe(true);

    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Hex colour' }));
    expect(screen.getByRole('dialog', { name: 'Floor colour' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
