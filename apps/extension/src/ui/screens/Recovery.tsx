import { useEffect, useState } from 'react';
import type { TrashEntry } from 'shatsu-ren-protocol';
import { absTime, dict, fmt } from '../../i18n';
import { send, type StateSnapshot } from '../../messages';
import type { TreePickerNode } from '../../sync/browser';
import { FolderTree } from '../components';
import { downloadText, useRequest } from '../hooks';

export function Recovery({
  state,
  refresh,
}: {
  state: StateSnapshot;
  refresh: () => Promise<void>;
}) {
  const d = dict();
  const [tab, setTab] = useState<'trash' | 'backups'>('trash');
  return (
    <>
      <div className="row" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'trash'}
          className="btn"
          onClick={() => setTab('trash')}
        >
          {d.recovery.trash}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'backups'}
          className="btn"
          onClick={() => setTab('backups')}
        >
          {d.recovery.backups}
        </button>
      </div>
      {tab === 'trash' ? <Trash state={state} refresh={refresh} /> : <Backups refresh={refresh} />}
    </>
  );
}

function Trash({ state, refresh }: { state: StateSnapshot; refresh: () => Promise<void> }) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [target, setTarget] = useState<Record<string, string>>({});
  const load = () =>
    send({ type: 'listTrash' })
      .then(setEntries)
      .catch(() => setEntries([]));
  useEffect(() => {
    void load();
  }, []);
  if (!entries) return <p className="muted">{d.common.loading}</p>;
  const live = entries.filter((e) => !e.restoredAt);
  return (
    <section className="card stack">
      {live.length === 0 ? (
        <p className="muted">{d.recovery.trashEmpty}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Deleted</th>
              <th>{d.recovery.restoreTo}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {live.map((e) => {
              const col = state.collections.find((c) => c.id === e.collectionId);
              return (
                <tr key={e.deletionId}>
                  <td>
                    {e.rootTitle ?? '—'}{' '}
                    <span className="small muted">
                      {fmt(d.recovery.itemsN, { n: e.itemCount })}
                    </span>
                  </td>
                  <td className="small muted">
                    {absTime(e.deletedAt)}
                    <br />
                    {fmt(d.recovery.expires, { t: absTime(e.expiresAt) })}
                  </td>
                  <td>
                    <select
                      className="input"
                      value={target[e.deletionId] ?? ''}
                      onChange={(ev) => setTarget({ ...target, [e.deletionId]: ev.target.value })}
                      aria-label={d.recovery.restoreTo}
                    >
                      <option value="">{d.recovery.originalParent}</option>
                      {col && <option value={col.rootNodeId}>{col.title} (root)</option>}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run({
                          type: 'restoreTrash',
                          deletionId: e.deletionId,
                          collectionId: e.collectionId,
                          parentGlobalId: target[e.deletionId] || null,
                        }).then(() => {
                          void load();
                          void refresh();
                        })
                      }
                    >
                      {d.recovery.restore}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {err && (
        <div className="alert danger" role="alert">
          {err.code === 'PARENT_NOT_FOUND'
            ? d.recovery.restoreTo + ': ' + d.recovery.originalParent + ' ✗'
            : `${err.code}: ${err.message}`}
        </div>
      )}
    </section>
  );
}

function Backups({ refresh }: { refresh: () => Promise<void> }) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const [list, setList] = useState<
    { id: string; createdAt: number; reason: string; bytes: number }[]
  >([]);
  const [preview, setPreview] = useState<{
    importId: string;
    count: number;
    excluded: number;
    depth: number;
  } | null>(null);
  const [tree, setTree] = useState<TreePickerNode[] | null>(null);
  const [parent, setParent] = useState<TreePickerNode | null>(null);
  useEffect(() => {
    void send({ type: 'listBackups' })
      .then((l) => setList(l as typeof list))
      .catch(() => undefined);
  }, []);
  const dl = async (backupId?: string) => {
    const r = (await run(
      backupId ? { type: 'exportBackup', backupId } : { type: 'exportBackup' },
    )) as { filename: string; json: string } | undefined;
    if (r) downloadText(r.filename, r.json);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const json = await f.text();
    const p = (await run({ type: 'importPreview', json })) as typeof preview;
    setPreview(p ?? null);
    if (p) setTree(await send({ type: 'getFolderTree' }));
  };
  return (
    <section className="card stack">
      <p className="small muted">{d.recovery.exportNote}</p>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void dl()}>
          {d.recovery.exportNow}
        </button>
      </div>
      {list.length === 0 ? (
        <p className="muted">{d.recovery.backupEmpty}</p>
      ) : (
        <table className="table">
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td>{absTime(b.createdAt)}</td>
                <td>{(d.recovery.reasons as Record<string, string>)[b.reason] ?? b.reason}</td>
                <td className="small muted">{Math.round(b.bytes / 1024)} KB</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void dl(b.id)}
                  >
                    {d.recovery.download}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>{d.recovery.import}</h3>
      <p className="small muted">{d.recovery.importNote}</p>
      <input
        type="file"
        accept="application/json"
        aria-label={d.recovery.import}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {preview && (
        <div className="stack">
          <p>
            {fmt(d.recovery.importPreview, {
              n: preview.count,
              x: preview.excluded,
              d: preview.depth,
            })}
          </p>
          <h4 style={{ margin: 0 }}>{d.recovery.importTarget}</h4>
          {tree && <FolderTree nodes={tree} selected={parent?.id ?? null} onSelect={setParent} />}
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={!parent || busy}
              onClick={() =>
                void run({
                  type: 'importApply',
                  importId: preview.importId,
                  parentLocalId: parent!.id,
                }).then(() => {
                  setPreview(null);
                  void refresh();
                })
              }
            >
              {d.recovery.importApply}
            </button>
          </div>
        </div>
      )}
      {err && (
        <div className="alert danger" role="alert">
          {err.code}: {err.message}
        </div>
      )}
    </section>
  );
}
