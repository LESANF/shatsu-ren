import { useEffect, useState } from 'react';
import { dict, fmt, relTime } from '../../i18n';
import { send, type StateSnapshot } from '../../messages';
import type { ConflictRecord, ReviewItem } from '../../sync/types';
import { Dialog } from '../components';
import { useRequest } from '../hooks';

export function BindingRow({
  b,
  refresh,
  go,
  compact,
}: {
  b: StateSnapshot['bindings'][number];
  refresh: () => Promise<void>;
  go: (h: string) => void;
  compact?: boolean;
}) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const [confirm, setConfirm] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<'keep' | 'discard'>('keep');
  const tone = b.status === 'active' ? 'ok' : b.status === 'paused' ? 'warn' : 'danger';
  return (
    <div
      className="row between"
      style={{
        flexWrap: 'wrap',
        gap: 8,
        borderBottom: '1px solid var(--border)',
        padding: '8px 0',
      }}
    >
      <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
        <div className="row">
          <strong className="ellipsis">{b.title}</strong>
          <span className={`badge ${tone}`}>{d.binding.status[b.status]}</span>
        </div>
        <div className="small muted ellipsis">
          {d.binding.local}: {b.rootTitle ?? '—'} · {fmt(d.binding.items, { n: b.itemCount })}
        </div>
        {b.recovery && (
          <div className="small" style={{ color: 'var(--danger)' }}>
            {b.recovery.reason}
          </div>
        )}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {b.status === 'active' && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run({ type: 'pauseBinding', collectionId: b.collectionId }).then(() => refresh())
            }
          >
            {d.binding.pause}
          </button>
        )}
        {(b.status === 'paused' || b.status === 'recovery_required') && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run({ type: 'resumeBinding', collectionId: b.collectionId }).then(() =>
                refresh(),
              )
            }
          >
            {d.binding.resume}
          </button>
        )}
        {b.status === 'root_missing' && (
          <button type="button" className="btn" onClick={() => go('/onboarding')}>
            {d.binding.reselect}
          </button>
        )}
        {!compact && (
          <button type="button" className="btn danger" onClick={() => setConfirm(true)}>
            {d.binding.disconnect}
          </button>
        )}
      </div>
      {err && (
        <div className="alert danger small" role="alert">
          {err.code}
        </div>
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={d.binding.disconnect}>
        <p>{d.binding.disconnectBody}</p>
        <label className="row">
          <input
            type="radio"
            name="pc"
            checked={pendingChoice === 'keep'}
            onChange={() => setPendingChoice('keep')}
          />
          {d.binding.pendingKeep}
        </label>
        <label className="row">
          <input
            type="radio"
            name="pc"
            checked={pendingChoice === 'discard'}
            onChange={() => setPendingChoice('discard')}
          />
          {d.binding.pendingDiscard}
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => setConfirm(false)}>
            {d.common.cancel}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() =>
              void run({
                type: 'disconnectBinding',
                collectionId: b.collectionId,
                pendingChoice,
              }).then(() => {
                setConfirm(false);
                void refresh();
              })
            }
          >
            {d.binding.disconnect}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

export function Folders({
  state,
  refresh,
  go,
}: {
  state: StateSnapshot;
  refresh: () => Promise<void>;
  go: (h: string) => void;
}) {
  const d = dict();
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  useEffect(() => {
    void send({ type: 'listConflicts' })
      .then(setConflicts)
      .catch(() => undefined);
    void send({ type: 'listReviews' })
      .then(setReviews)
      .catch(() => undefined);
  }, [state.counts.conflicts, state.counts.reviews]);
  return (
    <>
      <section className="card stack">
        <div className="row between">
          <h2>{d.nav.folders}</h2>
          {state.bindings.length === 0 && (
            <a className="btn" href="#/onboarding">
              {d.overview.addFolder}
            </a>
          )}
        </div>
        {state.bindings.length === 0 ? (
          <p className="muted">{d.binding.none}</p>
        ) : (
          state.bindings.map((b) => (
            <BindingRow key={b.collectionId} b={b} refresh={refresh} go={go} />
          ))
        )}
      </section>
      {conflicts.length > 0 && (
        <section className="card stack" id="conflicts">
          <h2>
            {d.conflict.title} · {conflicts.length}
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th>{d.common.error}</th>
                <th>Title</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.id}>
                  <td className="small">{d.conflict.kinds[c.kind]}</td>
                  <td className="ellipsis" style={{ maxWidth: 300 }}>
                    {c.local?.title ?? c.remote.title}
                  </td>
                  <td className="small muted">{relTime(c.createdAt)}</td>
                  <td>
                    <a className="btn" href={`#/conflict/${c.id}`}>
                      {d.overview.open}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {reviews.length > 0 && (
        <section className="card stack" id="reviews">
          <h2>
            {d.review.title} · {reviews.length}
          </h2>
          <table className="table">
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id}>
                  <td>{d.review.kinds[r.kind]}</td>
                  <td className="small muted">
                    {fmt(d.review.count, { n: r.items.length, total: r.scopeCount ?? 0 })}
                  </td>
                  <td>
                    <a className="btn" href={`#/review/${r.id}`}>
                      {d.overview.open}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
