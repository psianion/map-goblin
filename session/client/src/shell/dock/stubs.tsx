// Placeholder bodies for tabs whose real body has not landed yet. Each is swapped out by
// pointing its `registerDockTab` call in `tabs.ts` at the real component.

function Stub({ title }: { title: string }) {
  return (
    <p className="px-1 py-2 text-xs text-text-3" data-testid="dock-stub">
      {title} controls are on their way.
    </p>
  );
}

export const FogStub = () => <Stub title="Fog" />;
export const MapStub = () => <Stub title="Map" />;
export const TokensStub = () => <Stub title="Tokens" />;
export const EncounterStub = () => <Stub title="Encounter" />;
export const StoryStub = () => <Stub title="Story" />;
export const WorldStub = () => <Stub title="World" />;
export const ScenesStub = () => <Stub title="Scenes" />;
export const DiceStub = () => <Stub title="Dice" />;
