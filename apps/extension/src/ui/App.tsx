import { dict } from '../i18n';
import { Onboarding } from './screens/Onboarding';
import { Overview } from './screens/Overview';
import { Folders } from './screens/Folders';
import { History } from './screens/History';
import { Recovery } from './screens/Recovery';
import { SettingsScreen } from './screens/Settings';
import { ConflictDetail } from './screens/ConflictDetail';
import { ReviewDetail } from './screens/ReviewDetail';
import { StatusLine } from './components';
import { useHashRoute, useWorkerState } from './hooks';

export function App() {
  const d = dict();
  const { state, error, refresh } = useWorkerState();
  const [route, go] = useHashRoute();
  if (error)
    return (
      <div className="alert danger" role="alert">
        {d.common.error}: {error}
        <button className="btn" type="button" onClick={() => void refresh()}>
          {d.common.retry}
        </button>
      </div>
    );
  if (!state)
    return (
      <div style={{ padding: 24 }}>
        <StatusLine state={null} />
      </div>
    );
  const loggedIn = state.status !== 'auth_required' && !!state.account;
  const onboarding = !loggedIn || state.bindings.length === 0 || route.startsWith('/onboarding');
  if (onboarding && !route.startsWith('/settings'))
    return <Onboarding state={state} refresh={refresh} go={go} />;
  const nav: [string, string][] = [
    ['/', d.nav.overview],
    ['/folders', d.nav.folders],
    ['/history', d.nav.history],
    ['/recovery', d.nav.recovery],
    ['/settings', d.nav.settings],
  ];
  const active = (p: string) => (p === '/' ? route === '/' : route.startsWith(p));
  let screen;
  if (route.startsWith('/conflict/'))
    screen = <ConflictDetail id={route.slice('/conflict/'.length)} refresh={refresh} go={go} />;
  else if (route.startsWith('/review/'))
    screen = <ReviewDetail id={route.slice('/review/'.length)} refresh={refresh} go={go} />;
  else if (route.startsWith('/folders'))
    screen = <Folders state={state} refresh={refresh} go={go} />;
  else if (route.startsWith('/history')) screen = <History />;
  else if (route.startsWith('/recovery')) screen = <Recovery state={state} refresh={refresh} />;
  else if (route.startsWith('/settings'))
    screen = <SettingsScreen state={state} refresh={refresh} go={go} />;
  else screen = <Overview state={state} refresh={refresh} go={go} />;
  return (
    <div
      style={{
        maxWidth: 1080,
        margin: '0 auto',
        padding: 24,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 192px) minmax(0, 1fr)',
        gap: 24,
      }}
      className="app-grid"
    >
      <style>{`@media (max-width: 720px) { .app-grid { grid-template-columns: 1fr !important; } .app-nav { flex-direction: row !important; flex-wrap: wrap; } }`}</style>
      <nav aria-label="main" className="stack app-nav" style={{ gap: 4 }}>
        <h1 style={{ marginBottom: 8 }}>{d.appName}</h1>
        {nav.map(([p, label]) => (
          <a
            key={p}
            href={`#${p}`}
            className="btn"
            aria-current={active(p) ? 'page' : undefined}
            style={{
              justifyContent: 'flex-start',
              ...(active(p) ? { borderColor: 'var(--accent)', fontWeight: 600 } : {}),
            }}
          >
            {label}
          </a>
        ))}
        {state.devAuth && (
          <span className="badge warn small" style={{ marginTop: 8 }}>
            {d.devBuild}
          </span>
        )}
      </nav>
      <main className="stack" style={{ minWidth: 0 }}>
        {screen}
      </main>
    </div>
  );
}
