import { useEffect, useState } from 'react';
import { absTime, dict, fmt } from '../../i18n';
import { send } from '../../messages';
import type { RecentChange } from '../../sync/types';

export function History() {
  const d = dict();
  const [items, setItems] = useState<RecentChange[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<{ device: 'all' | 'this' | 'other'; kind: string }>({
    device: 'all',
    kind: 'all',
  });
  const load = async (beforeSeq?: number) => {
    const r = await send({ type: 'listHistory', ...(beforeSeq ? { beforeSeq } : {}), limit: 50 });
    setItems((prev) => (beforeSeq ? [...prev, ...r.items] : r.items));
    setHasMore(r.hasMore);
  };
  useEffect(() => {
    void load();
  }, []);
  const shown = items.filter(
    (i) =>
      (filter.device === 'all' || (filter.device === 'this') === i.isThisDevice) &&
      (filter.kind === 'all' || i.kind === filter.kind),
  );
  return (
    <section className="card stack">
      <h2>{d.history.title}</h2>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select
          className="input"
          style={{ width: 'auto' }}
          value={filter.device}
          onChange={(e) => setFilter({ ...filter, device: e.target.value as 'all' })}
          aria-label="device"
        >
          <option value="all">—</option>
          <option value="this">{d.thisBrowser}</option>
          <option value="other">{d.overview.connectedBrowsers}</option>
        </select>
        <select
          className="input"
          style={{ width: 'auto' }}
          value={filter.kind}
          onChange={(e) => setFilter({ ...filter, kind: e.target.value })}
          aria-label="kind"
        >
          <option value="all">—</option>
          {Object.entries(d.history.kinds).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <p className="muted">{d.history.empty}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Browser</th>
              <th>Action</th>
              <th>Item</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.seq}>
                <td className="small muted" style={{ whiteSpace: 'nowrap' }} title={r.at}>
                  {absTime(r.at)}
                </td>
                <td>{r.isThisDevice ? d.thisBrowser : r.deviceLabel || '·'}</td>
                <td>{(d.history.kinds as Record<string, string>)[r.kind] ?? r.kind}</td>
                <td className="ellipsis" style={{ maxWidth: 360 }}>
                  {r.summary.count > 1
                    ? `${r.summary.title} … ${fmt(d.history.itemsN, { n: r.summary.count })}`
                    : r.summary.title}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && (
        <div className="row">
          <button type="button" className="btn" onClick={() => void load(items.at(-1)?.seq)}>
            {d.history.more}
          </button>
        </div>
      )}
      <p className="small muted">{d.history.retentionNote}</p>
    </section>
  );
}
