import { navigate } from '../router';

/** §2.6: host a table, or sit down at one. */
export default function Landing() {
  return (
    <div data-page="landing" className="flex h-full flex-col items-center justify-center gap-8 bg-bg p-6 text-text">
      <header className="text-center">
        <h1 className="text-3xl font-medium">Good Goblin</h1>
        <p className="mt-1 text-sm text-text-2">One map, one table, everyone looking at it.</p>
      </header>
      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        <Card to="/host" title="Host a game" body="Pick a campaign, pick a map, hand out the invite code." />
        <Card to="/join" title="Join a game" body="Got a code or a link from your DM? Take a seat." />
      </div>
      <p className="max-w-md text-center text-xs text-text-3">
        The DM publishes maps from the canvas, or brings a .ggvtt file, and shares a six-character code. Everyone who types it in sees the same table.
      </p>
    </div>
  );
}

function Card({ to, title, body }: { to: string; title: string; body: string }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      className="flex flex-col gap-2 rounded-float border border-line bg-panel p-5 shadow-e hover:bg-panel-2"
    >
      <span className="text-lg font-medium">{title}</span>
      <span className="text-sm text-text-2">{body}</span>
    </a>
  );
}
