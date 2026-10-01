import { dict, fmt, relTime } from '../../i18n';
import { send, type StateSnapshot } from '../../messages';
import { ErrorLine, LastCheck, StatusLine } from '../components';
import { useRequest } from '../hooks';
import { BindingRow } from './Folders';

export function Overview({
  state,
  refresh,
  go,
}: {
  state: StateSnapshot;
  refresh: () => Promise<void>;
  go: (h: string) => void;
}) {
  const d = dict();
  const { run, busy } = useRequest();
  const blockedMsg = state.blocked
    ? ((d.blockedCodes as Record<string, string>)[state.blocked.code] ?? state.blocked.code)
    : null;
  return (
    <>
      <section className="card stack">
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}>
            <span className="small muted">
              {d.overview.account} · {state.account?.email}
            </span>
            <StatusLine state={state} />
            <LastCheck state={state} />
            <ErrorLine state={state} />
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !!state.running}
            onClick={() => void run({ type: 'syncNow' }).then(() => refresh())}
          >
            {d.checkNow}
          </button>
        </div>
        {state.running && (
          <div className="small muted" role="status">
            {state.running.phase}
          </div>
        )}
      </section>
      {(state.problems.length > 0 || blockedMsg) && (
        <section className="card stack" aria-labelledby="attention">
          <h2 id="attention">{d.overview.needsAttention}</h2>
          {blockedMsg && (
            <div className="alert danger">
              {blockedMsg}
              {state.blocked?.code === 'SERVER_GENERATION_CHANGED' && (
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void run({ type: 'recoverGeneration' }).then(() => refresh())}
                  >
                    {d.settingsPage.generationRecover}
                  </button>
                </div>
              )}
            </div>
          )}
          {state.counts.conflicts > 0 && (
            <div className="row between">
              <span>
                {d.overview.conflict} · {state.counts.conflicts}
              </span>
              <a className="btn" href="#/folders?tab=conflicts">
                {d.overview.open}
              </a>
            </div>
          )}
          {state.counts.reviews > 0 && (
            <div className="row between">
              <span>
                {d.overview.review} · {state.counts.reviews}
              </span>
              <a className="btn" href="#/folders?tab=reviews">
                {d.overview.open}
              </a>
            </div>
          )}
          {state.counts.recovery > 0 && (
            <div className="row between">
              <span>{d.overview.recovery}</span>
              <a className="btn" href="#/folders">
                {d.overview.open}
              </a>
            </div>
          )}
        </section>
      )}
      <section className="card stack">
        <div className="row between">
          <h2>{d.nav.folders}</h2>
          <div className="row">
            {state.bindings.length === 0 && (
              <a className="btn" href="#/onboarding">
                {d.overview.addFolder}
              </a>
            )}
            <a className="btn" href="#/settings#devices">
              {d.overview.connectedBrowsers}
            </a>
          </div>
        </div>
        {state.bindings.length === 0 ? (
          <p className="muted">{d.binding.none}</p>
        ) : (
          state.bindings.map((b) => (
            <BindingRow key={b.collectionId} b={b} refresh={refresh} go={go} compact />
          ))
        )}
      </section>
      <section className="card stack">
        <div className="row between">
          <h2>{d.recent}</h2>
          <a className="btn link small" href="#/history">
            {d.viewAll}
          </a>
        </div>
        {state.recent.length === 0 ? (
          <p className="muted small">{d.noHistory}</p>
        ) : (
          <table className="table">
            <tbody>
              {state.recent.slice(0, 5).map((r) => (
                <tr key={r.seq}>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                    {relTime(Date.parse(r.at))}
                  </td>
                  <td>{r.isThisDevice ? d.thisBrowser : r.deviceLabel || '·'}</td>
                  <td>{(d.history.kinds as Record<string, string>)[r.kind] ?? r.kind}</td>
                  <td className="ellipsis" style={{ maxWidth: 320 }}>
                    {r.summary.count > 1
                      ? fmt(d.history.itemsN, { n: r.summary.count })
                      : r.summary.title}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
