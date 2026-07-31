import { navigate } from '../router';

/** §2.6 — the fork in the road: host a table, or sit down at one. */
export default function Landing() {
  return (
    <div
      data-page="landing"
      className="flex h-full flex-col items-center justify-center gap-8 bg-neutral-950 p-6 text-neutral-100"
    >
      <header className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Good Goblin</h1>
        <p className="mt-1 text-sm text-neutral-400">One map, one table, everyone looking at it.</p>
      </header>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        <Card
          to="/host"
          title="Host a game"
          body="Point at your server, upload a map, hand out the invite code."
        />
        <Card
          to="/join"
          title="Join a game"
          body="Got a code or a link from your DM? Take a seat."
        />
      </div>

      <p className="max-w-md text-center text-xs leading-relaxed text-neutral-500">
        How it works: the DM runs the game server, uploads a <code>.mapbuilder</code> map and
        shares a six-character code. Everyone who types it in sees the same table.
      </p>
    </div>
  );
}

function Card({ to, title, body }: { to: string; title: string; body: string }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        // Left-click routes in-page; ctrl/middle-click keeps the browser's own behaviour.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-5 transition hover:border-neutral-600 hover:bg-neutral-800/60"
    >
      <span className="text-lg font-medium">{title}</span>
      <span className="text-sm text-neutral-400">{body}</span>
    </a>
  );
}
