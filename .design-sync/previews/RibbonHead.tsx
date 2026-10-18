import { DayRibbon, RibbonHead } from 'map-builder';

// RibbonHead is the scrubber head for DayRibbon and is only ever rendered as
// its child (see EnvironmentSection) — it positions itself along the ribbon by
// `minutes`. Alone it is a floating pin with nothing to point at, so every
// story composes it inside its parent, which is the only true render.
function skyAt(minutes: number) {
  const stops: Array<[number, string]> = [
    [0, '#0f1016'],
    [300, '#243043'],
    [420, '#c08457'],
    [720, '#8fb3d9'],
    [1020, '#d98f5a'],
    [1140, '#2b3550'],
    [1440, '#0f1016'],
  ];
  let prev = stops[0];
  for (const s of stops) {
    if (minutes <= s[0]) {
      const span = s[0] - prev[0] || 1;
      return (minutes - prev[0]) / span < 0.5 ? prev[1] : s[1];
    }
    prev = s;
  }
  return prev[1];
}

export function OnRibbon() {
  return (
    <div className="w-[320px]">
      <DayRibbon colorAt={skyAt} height={28}>
        <RibbonHead minutes={480} />
      </DayRibbon>
    </div>
  );
}

export function CommittedVsPreview() {
  return (
    <div className="flex w-[320px] flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground">Committed (08:00)</span>
        <DayRibbon colorAt={skyAt} height={28}>
          <RibbonHead minutes={480} committed />
        </DayRibbon>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground">Previewing (19:00)</span>
        <DayRibbon colorAt={skyAt} height={28}>
          <RibbonHead minutes={1140} />
        </DayRibbon>
      </div>
    </div>
  );
}

export function AcrossTheDay() {
  return (
    <div className="flex w-[320px] flex-col gap-3">
      {[360, 720, 1020].map((m) => (
        <DayRibbon key={m} colorAt={skyAt} height={20}>
          <RibbonHead minutes={m} committed />
        </DayRibbon>
      ))}
    </div>
  );
}
