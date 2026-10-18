import { Button } from 'map-builder';
import { Upload, Trash2, Copy, Plus, RotateCw } from 'lucide-react';

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Publish map</Button>
      <Button variant="outline">Export PNG</Button>
      <Button variant="secondary">Duplicate layer</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Delete room</Button>
      <Button variant="link">View pack</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        <Upload />
        Publish to table
      </Button>
      <Button variant="outline">
        <Plus />
        Add layer
      </Button>
      <Button variant="destructive">
        <Trash2 />
        Delete
      </Button>
    </div>
  );
}

export function IconOnly() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon-xs" variant="ghost" aria-label="Copy">
        <Copy />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Rotate">
        <RotateCw />
      </Button>
      <Button size="icon" variant="outline" aria-label="Add layer">
        <Plus />
      </Button>
      <Button size="icon-lg" variant="secondary" aria-label="Upload">
        <Upload />
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>Publish map</Button>
      <Button variant="outline" disabled>
        Export PNG
      </Button>
      <Button variant="destructive" disabled>
        Delete room
      </Button>
    </div>
  );
}
