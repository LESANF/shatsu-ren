import { useEffect, useState } from 'react';
import { dict } from '../../i18n';
import { send, type Response } from '../../messages';
import { useRequest } from '../hooks';

export function ConflictDetail({
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
  const [c, setC] = useState<Response<'getConflictDetail'> | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void send({ type: 'getConflictDetail', id })
      .then(setC)
      .catch(() => go('/folders'));
  }, [id, go, err]);
  if (!c) return <p className="muted">{d.common.loading}</p>;
  const resolve = (r: 'mine' | 'theirs' | 'both') =>
    void run({
      type: 'resolveConflict',
      id,
      resolution: r,
      ...(c.fingerprint ? { fingerprint: c.fingerprint } : {}),
    }).then((res) => {
      if (res) {
        void refresh();
        go('/folders');
      }
    });
  const diff = (a: string | null | undefined, b: string | null | undefined) =>
    a !== b ? { fontWeight: 600, background: 'var(--bg)' } : {};
  const isDeleteCase =
    c.kind === 'local_edit_remote_delete' || c.kind === 'local_delete_remote_edit';
  return (
    <section className="card stack">
      <div className="row between">
        <h2>{d.conflict.title}</h2>
        <a className="btn" href="#/folders">
          {d.common.close}
        </a>
      </div>
      <p>{d.conflict.kinds[c.kind]}</p>
      {c.orderTitles && (
        <div className="row">
          <div>
            <h3>{d.conflict.myChange}</h3>
            <ol>
              {c.orderTitles.local.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3>{d.conflict.serverChange}</h3>
            <ol>
              {c.orderTitles.remote.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th />
            <th>{d.conflict.base}</th>
            <th>{d.conflict.myChange}</th>
            <th>{d.conflict.serverChange}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Title</th>
            <td>{c.base.title}</td>
            <td style={diff(c.local?.title, c.base.title)}>
              {c.local ? c.local.title : <em>{d.conflict.deleted}</em>}
            </td>
            <td style={diff(c.remote.title, c.base.title)}>
              {c.remote.deleted ? <em>{d.conflict.deleted}</em> : c.remote.title}
            </td>
          </tr>
          {c.nodeKind === 'bookmark' && (
            <tr>
              <th>URL</th>
              <td className="ellipsis" style={{ maxWidth: 200 }} title={c.base.url ?? ''}>
                {c.base.url}
              </td>
              <td
                className="ellipsis"
                style={{ maxWidth: 200, ...diff(c.localUrl, c.base.url) }}
                title={c.localUrl ?? ''}
              >
                {c.localUrl}
              </td>
              <td
                className="ellipsis"
                style={{ maxWidth: 200, ...diff(c.remoteUrl, c.base.url) }}
                title={c.remoteUrl ?? ''}
              >
                {c.remoteUrl}
              </td>
            </tr>
          )}
          <tr>
            <th>{d.common.folder}</th>
            <td className="small muted">{c.base.parentGlobalId?.slice(0, 8)}</td>
            <td
              className="small muted"
              style={diff(c.local?.parentGlobalId, c.base.parentGlobalId)}
            >
              {c.local?.parentGlobalId?.slice(0, 8)}
            </td>
            <td
              className="small muted"
              style={diff(c.remote.parentGlobalId, c.base.parentGlobalId)}
            >
              {c.remote.parentGlobalId?.slice(0, 8)}
            </td>
          </tr>
        </tbody>
      </table>
      {c.nodeKind === 'bookmark' && (c.localUrl || c.remoteUrl) && (
        <div className="row">
          <button
            type="button"
            className="btn small"
            onClick={() =>
              void navigator.clipboard
                .writeText(c.localUrl ?? c.remoteUrl ?? '')
                .then(() => setCopied(true))
            }
          >
            {copied ? d.common.copied : d.conflict.copyUrl}
          </button>
        </div>
      )}
      {err && (
        <div className="alert danger" role="alert">
          {err.code === 'RECHECK' ? d.conflict.recheck : `${err.code}: ${err.message}`}
        </div>
      )}
      <div className="stack">
        {!isDeleteCase && (
          <>
            <Action
              label={d.conflict.mine}
              effect={d.conflict.effect.mine}
              onClick={() => resolve('mine')}
              busy={busy}
            />
            <Action
              label={d.conflict.theirs}
              effect={d.conflict.effect.theirs}
              onClick={() => resolve('theirs')}
              busy={busy}
            />
            {c.nodeKind === 'bookmark' ? (
              <Action
                label={d.conflict.both}
                effect={d.conflict.effect.both}
                onClick={() => resolve('both')}
                busy={busy}
              />
            ) : (
              <p className="small muted">{d.conflict.folderNote}</p>
            )}
          </>
        )}
        {c.kind === 'local_edit_remote_delete' && (
          <>
            <Action
              label={d.conflict.keepEdit}
              effect={d.conflict.effect.keepLocalOnDelete}
              onClick={() => resolve('mine')}
              busy={busy}
            />
            <Action
              label={d.conflict.keepDelete}
              effect={d.conflict.effect.deleteLocal}
              onClick={() => resolve('theirs')}
              busy={busy}
              danger
            />
          </>
        )}
        {c.kind === 'local_delete_remote_edit' && (
          <>
            <Action
              label={d.conflict.keepDelete}
              effect={d.conflict.effect.deleteRemote}
              onClick={() => resolve('mine')}
              busy={busy}
              danger
            />
            <Action
              label={d.conflict.keepEdit}
              effect={d.conflict.effect.restoreFromRemote}
              onClick={() => resolve('theirs')}
              busy={busy}
            />
          </>
        )}
        <div className="row">
          <a className="btn" href="#/folders">
            {d.conflict.later}
          </a>
        </div>
      </div>
    </section>
  );
}

function Action({
  label,
  effect,
  onClick,
  busy,
  danger,
}: {
  label: string;
  effect: string;
  onClick: () => void;
  busy: boolean;
  danger?: boolean;
}) {
  return (
    <div className="row between" style={{ gap: 16 }}>
      <span className="small muted" style={{ flex: 1 }}>
        {effect}
      </span>
      <button
        type="button"
        className={`btn ${danger ? 'danger' : 'primary'}`}
        disabled={busy}
        onClick={onClick}
        style={{ flex: 'none' }}
      >
        {label}
      </button>
    </div>
  );
}
