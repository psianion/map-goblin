import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from './button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './context-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Input } from './input';
import { Kbd } from './kbd';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { ScrollArea } from './scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Separator } from './separator';
import { Slider } from './slider';
import { Switch } from './switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Toggle } from './toggle';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`) as HTMLElement;

describe('ui primitives', () => {
  it('Button: primary is the 28 ink button, outline the hairline secondary at 24', () => {
    render(
      <>
        <Button>Publish</Button>
        <Button variant="outline" size="sm">
          Cancel
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Publish' }).className).toMatch(/\bh-7\b.*\bbg-ink\b|\bbg-ink\b.*\bh-7\b/);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.className).toContain('h-6');
    expect(cancel.className).toContain('border-line');
  });

  it('Toggle: pressing turns on the ink ring', () => {
    render(<Toggle aria-label="Snap">S</Toggle>);
    const toggle = screen.getByRole('button', { name: 'Snap' });
    expect(toggle.hasAttribute('data-pressed')).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.hasAttribute('data-pressed')).toBe(true);
    expect(toggle.className).toContain('data-[pressed]:ring-ink');
  });

  it('ToggleGroup: spacing 0 is the segmented control, one cell chosen', () => {
    render(
      <ToggleGroup defaultValue={['b']}>
        <ToggleGroupItem value="a">Square</ToggleGroupItem>
        <ToggleGroupItem value="b">Hex</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(slot('toggle-group').getAttribute('data-spacing')).toBe('0');
    expect(screen.getByText('Hex').hasAttribute('data-pressed')).toBe(true);
    expect(screen.getByText('Square').className).toContain('h-[22px]');
  });

  it('Slider: renders a thumb per value on a 2px track', () => {
    render(<Slider defaultValue={[40]} aria-label="Strength" />);
    expect(document.querySelectorAll('[data-slot="slider-thumb"]')).toHaveLength(1);
    expect(slot('slider-track').className).toContain('bg-line-strong');
  });

  it('Switch: 28 by 16, flips on click', () => {
    render(<Switch aria-label="Lit" />);
    const sw = screen.getByRole('switch', { name: 'Lit' });
    expect(sw.className).toContain('data-[size=default]:w-7');
    fireEvent.click(sw);
    expect(sw.hasAttribute('data-checked')).toBe(true);
  });

  it('Select: the trigger shows the value and the open list its items', () => {
    render(
      <Select defaultValue="ink" open items={[{ value: 'ink', label: 'Cave ink' }, { value: 'oak', label: 'Oak plank' }]}>
        <SelectTrigger aria-label="Edge band">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ink">Cave ink</SelectItem>
          <SelectItem value="oak">Oak plank</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(slot('select-trigger').className).toContain('h-6');
    expect(screen.getAllByText('Oak plank').length).toBeGreaterThan(0);
  });

  it('Popover: an open popover is a float', () => {
    render(
      <Popover open>
        <PopoverTrigger>Grid</PopoverTrigger>
        <PopoverContent>Grid options</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText('Grid options').className).toContain('shadow-e');
  });

  it('Tooltip: ink-filled and 24 tall, with a keycap', () => {
    render(
      <Tooltip open>
        <TooltipTrigger>T</TooltipTrigger>
        <TooltipContent>
          Terrain brush <Kbd>B</Kbd>
        </TooltipContent>
      </Tooltip>,
    );
    const tip = slot('tooltip-content');
    expect(tip.className).toContain('bg-ink');
    expect(tip.className).toContain('h-6');
    expect(tip.querySelector('[data-slot="kbd"]')?.textContent).toBe('B');
  });

  it('Dialog: 320 wide, title and description, no close cross by default', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Delete 3 props?</DialogTitle>
          <DialogDescription>They leave this layer.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog').className).toContain('w-[320px]');
    expect(screen.getByText('Delete 3 props?')).toBeDefined();
    expect(screen.queryByText('Close')).toBeNull();
  });

  it('DropdownMenu: 232 wide with 28 rows, a separator and a mono shortcut', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>More</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>
            Export <DropdownMenuShortcut>Ctrl E</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(slot('dropdown-menu-content').className).toContain('w-[232px]');
    expect(screen.getByRole('menuitem', { name: /Export/ }).className).toContain('h-7');
    expect(screen.getByText('Ctrl E').className).toContain('font-mono');
    expect(document.querySelector('[data-slot="dropdown-menu-separator"]')).not.toBeNull();
  });

  it('ContextMenu: opens on right click with the menu float', () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Map</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Paste here</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText('Map'));
    expect(slot('context-menu-content').className).toContain('w-[232px]');
    expect(screen.getByRole('menuitem', { name: 'Paste here' })).toBeDefined();
  });

  it('Tabs: the chosen tab is active and shows its panel', () => {
    render(
      <Tabs defaultValue="floors">
        <TabsList variant="line">
          <TabsTrigger value="floors">Floors</TabsTrigger>
          <TabsTrigger value="walls">Walls</TabsTrigger>
        </TabsList>
        <TabsContent value="floors">Floor tools</TabsContent>
        <TabsContent value="walls">Wall tools</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tab', { name: 'Floors' }).hasAttribute('data-active')).toBe(true);
    expect(screen.getByText('Floor tools')).toBeDefined();
  });

  it('ScrollArea: wraps its children in a viewport', () => {
    render(
      <ScrollArea className="h-20">
        <p>Long list</p>
      </ScrollArea>,
    );
    expect(slot('scroll-area-viewport').textContent).toBe('Long list');
  });

  it('Separator: a hairline in line', () => {
    render(<Separator />);
    expect(slot('separator').className).toContain('bg-line');
  });

  it('Kbd: an 18 tall mono keycap on panel-2', () => {
    render(<Kbd>Ctrl</Kbd>);
    const k = slot('kbd');
    expect(k.className).toContain('h-[18px]');
    expect(k.className).toContain('font-mono');
    expect(k.className).toContain('bg-panel-2');
  });

  it('Input: 24 tall, mono for numbers', () => {
    render(<Input type="number" aria-label="Size" defaultValue={20} />);
    const input = screen.getByRole('spinbutton', { name: 'Size' });
    expect(input.className).toContain('h-6');
    expect(input.className).toContain('[&[type=number]]:font-mono');
  });
});
