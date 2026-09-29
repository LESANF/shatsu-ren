import { useEffect, useState } from 'react';
import { dict, fmt } from '../../i18n';
import { send } from '../../messages';
import type { ReviewItem } from '../../sync/types';
import { downloadText, useRequest } from '../hooks';

export function ReviewDetail({
  id,
  refresh,
  go,
}: {
  id: string;
  refresh: () => Promise<void>;
  go: (h: string) => void;
}) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const [r, setR] = useState<ReviewItem | null>(null);
  const [cand, setCand] = useState<string>('');
  useEffect(() => {
    void send({ type: 'listReviews' }).then((l) => {
      const x = l.find((i) => i.id === id);
      if (x) setR(x);
      else go('/folders');
    });
  }, [id, go]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') go('/folders');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);
  if (!r) return <p className="muted">{d.common.loading}</p>;
  const resolve = (resolution: string) =>
    void run({
      type: 'resolveReview',
      id,
      resolution,
      ...(cand ? { candidateLocalId: cand } : {}),
    }).then((res) => {
      if (res) {
        void refresh();
        go('/folders');
      }
    });
  const exportNow = () =>
    void send({ type: 'exportBackup' }).then((x) => {
      const e = x as { filename: string; json: string };
      downloadText(e.filename, e.json);
    });
  return (
    <section className="card stack">
      <div className="row between">
        <h2>{d.review.title}</h2>
        <a className="btn" href="#/folders">
          {d.common.close}
        </a>
      </div>
      <p>{d.review.kinds[r.kind]}</p>
      <p className="small muted">
        {fmt(d.review.count, { n: r.items.length, total: r.scopeCount ?? 0 })}
      </p>
      {r.kind.startsWith('mass_delete') && <p className="small muted">{d.review.massNote}</p>}
      {r.kind === 'moved_out' && <p className="small muted">{d.review.movedOutNote}</p>}
      {r.kind === 'create_recovery' && <p className="small muted">{d.review.recoveryNote}</p>}
      <ul style={{ maxHeight: 320, overflow: 'auto', margin: 0, paddingLeft: 20 }}>
        {r.items.slice(0, 500).map((it, i) => (
          <li key={i} className="ellipsis">
            {it.kind === 'folder' ? '📁 ' : ''}
            {it.title}
            {it.url ? <span className="small muted"> · {it.url}</span> : null}
          </li>
        ))}
      </ul>
      {r.kind === 'create_recovery' && r.candidates && (
        <div className="stack">
          <h3>{d.review.mapCandidate}</h3>
          {r.candidates.map((c) => (
            <label key={c.localId} className="row">
              <input
                type="radio"
                name="cand"
                value={c.localId}
                checked={cand === c.localId}
                onChange={() => setCand(c.localId)}
              />
              {c.title} <span className="small muted">{c.url}</span>
            </label>
          ))}
        </div>
      )}
      {err && (
        <div className="alert danger" role="alert">
          {err.code}: {err.message}
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {r.kind === 'mass_delete_out' && (
          <>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => resolve('approve')}
            >
              {d.review.approveOut}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => resolve('restore')}
            >
              {d.review.restoreOut}
            </button>
            <button type="button" className="btn" onClick={exportNow}>
              {d.review.export}
            </button>
          </>
        )}
        {r.kind === 'mass_delete_in' && (
          <>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => resolve('approve')}
            >
              {d.review.approveIn}
            </button>
            <button type="button" className="btn" onClick={exportNow}>
              {d.review.export}
            </button>
            <a className="btn" href="#/folders">
              {d.review.holdIn}
            </a>
          </>
        )}
        {r.kind === 'moved_out' && (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => resolve('keep')}>
              {d.review.keepRemote}
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => resolve('delete')}
            >
              {d.review.deleteRemote}
            </button>
          </>
        )}
        {r.kind === 'create_recovery' && (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !cand}
              onClick={() => resolve('map')}
            >
              {d.review.mapCandidate}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => resolve('new')}>
              {d.review.createNew}
            </button>
            <a className="btn" href="#/folders">
              {d.review.cancel}
            </a>
          </>
        )}
        {r.kind === 'excluded_url' && (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => resolve('restore')}
            >
              {d.review.restoreRemote}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => resolve('keep')}>
              {d.review.later}
            </button>
          </>
        )}
        <a className="btn link" href="#/folders">
          {d.review.later}
        </a>
      </div>
    </section>
  );
}
