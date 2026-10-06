import { DayRibbon } from 'map-builder';

// Midnight → dawn → noon → dusk → midnight, as the environment editor drives it.
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

export function FullDay() {
  return (
    <div className="w-[320px]">
      <DayRibbon colorAt={skyAt} height={28} />
    </div>
  );
}

export function Muted() {
  return (
    <div className="w-[320px]">
      <DayRibbon colorAt={skyAt} height={28} muted />
    </div>
  );
}

export function Tall() {
  return (
    <div className="w-[320px]">
      <DayRibbon colorAt={skyAt} height={56} />
    </div>
  );
}
