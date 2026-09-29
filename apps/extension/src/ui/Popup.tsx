import { useState } from 'react';
import { dict, fmt, relTime } from '../i18n';
import { send } from '../messages';
import { ErrorLine, LastCheck, StatusLine } from './components';
import { useWorkerState } from './hooks';

const openApp = (hash = '/') =>
  chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#${hash}`) });

export function Popup() {
  const d = dict();
  const { state, refresh } = useWorkerState(1500);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  if (!state)
    return (
      <div style={{ width: 360, padding: 16 }}>
        <StatusLine state={null} />
      </div>
    );
  const needsAttention = ['conflict', 'review_required', 'recovery_required', 'blocked'].includes(
    state.status,
  );
  const paused = state.bindings.filter((b) => b.status === 'paused').length;
  return (
    <div style={{ width: 360, padding: 16 }} className="stack">
      <div className="row between">
        <h1>{d.appName}</h1>
        <button type="button" className="btn" onClick={() => void openApp('/settings')}>
          {d.settings}
        </button>
      </div>
      {state.devAuth && <div className="badge warn">{d.devBuild}</div>}
      {!state.backend && <div className="alert">{d.noBackend}</div>}
      <StatusLine state={state} />
      {state.status === 'auth_required' ? (
        <div className="stack">
          <p className="muted small">{d.tagline}</p>
          <button
            type="button"
            className="btn primary lg"
            onClick={() => void openApp('/onboarding')}
          >
            {d.login}
          </button>
        </div>
      ) : state.status === 'unconfigured' ? (
        <button
          type="button"
          className="btn primary lg"
          onClick={() => void openApp('/onboarding')}
        >
          {d.startConnect}
        </button>
      ) : (
        <>
          <LastCheck state={state} />
          <ErrorLine state={state} />
          <div className="small">
            {d.realtime[state.realtime]} ·{' '}
            {paused
              ? fmt(d.foldersPaused, { n: state.bindings.length, p: paused })
              : fmt(d.folders, { n: state.bindings.length })}
            <br />
            {fmt(d.queue, { out: state.counts.outbox, in: state.counts.pendingApply })}
            {state.counts.conflicts > 0 && (
              <> · {fmt(d.status.conflict, { n: state.counts.conflicts })}</>
            )}
            {state.counts.reviews > 0 && (
              <> · {fmt(d.status.review_required, { n: state.counts.reviews })}</>
            )}
          </div>
          {state.running && (
            <div className="small muted" role="status">
              {state.running.phase}
            </div>
          )}
          {needsAttention ? (
            <button type="button" className="btn primary lg" onClick={() => void openApp('/')}>
              {d.reviewChanges}
            </button>
          ) : (
            <button
              type="button"
              className="btn primary lg"
              disabled={busy || !!state.running}
              onClick={() => void run(() => send({ type: 'syncNow' }))}
            >
              {d.checkNow}
            </button>
          )}
          <div className="row between">
            <h3>{d.recent}</h3>
            <button
              type="button"
              className="btn link small"
              onClick={() => void openApp('/history')}
            >
              {d.viewAll}
            </button>
          </div>
          {state.recent.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              {d.noHistory}
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
              {state.recent.slice(0, 3).map((r) => (
                <li key={r.seq} className="row between small">
                  <span className="ellipsis">
                    {r.isThisDevice ? d.thisBrowser : r.deviceLabel || '·'} ·{' '}
                    {(d.history.kinds as Record<string, string>)[r.kind] ?? r.kind}{' '}
                    {r.summary.count > 1
                      ? fmt(d.history.itemsN, { n: r.summary.count })
                      : r.summary.title}
                  </span>
                  <span className="muted" style={{ flex: 'none' }}>
                    {relTime(Date.parse(r.at))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
