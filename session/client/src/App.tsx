import { matchRoute, usePath } from './router';
import GameTable from './pages/GameTable';
import HostSetup from './pages/HostSetup';
import JoinSession from './pages/JoinSession';
import Landing from './pages/Landing';
import { TableUpdatedCard } from './shell/TableUpdatedCard';

function Page() {
  const route = matchRoute(usePath());

  switch (route.name) {
    case 'host':
      return <HostSetup />;
    case 'join':
      // Remount on a different code so the link's code is re-resolved.
      return <JoinSession key={route.code} code={route.code} />;
    case 'table':
      return <GameTable />;
    default:
      return <Landing />;
  }
}

/** Every page, and the card that stops any of them once the server has moved on (12.2). */
export default function App() {
  return (
    <>
      <Page />
      <TableUpdatedCard />
    </>
  );
}
