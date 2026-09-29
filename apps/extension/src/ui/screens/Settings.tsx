import { useEffect, useState } from 'react';
import type { DeviceRecord } from 'shatsu-ren-protocol';
import { absTime, dict, fmt, relTime } from '../../i18n';
import { send, type StateSnapshot } from '../../messages';
import { Dialog } from '../components';
import { downloadText, useRequest } from '../hooks';

export function SettingsScreen({
  state,
  refresh,
  go,
}: {
  state: StateSnapshot;
  refresh: () => Promise<void>;
  go: (h: string) => void;
}) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const s = state.settings;
  const set = (patch: Partial<typeof s>) =>
    void run({ type: 'setSettings', patch }).then(() => refresh());
  const [label, setLabel] = useState(s.deviceLabel);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<'keep' | 'discard'>('keep');
  const loggedIn = !!state.account && state.status !== 'auth_required';
  return (
    <>
      {loggedIn && (
        <section className="card stack">
          <h2>{d.nav.settings}</h2>
          <label className="row between">
            <span>{d.settingsPage.autoSync}</span>
            <input
              type="checkbox"
              role="switch"
              checked={s.autoSync}
              onChange={(e) => set({ autoSync: e.target.checked })}
            />
          </label>
          <p className="small muted">{d.settingsPage.autoSyncHint}</p>
          {!s.autoSync && (
            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void run({ type: 'syncNow' }).then(() => refresh())}
              >
                {d.settingsPage.syncOnce}
              </button>
            </div>
          )}
          <div className="row between">
            <span>{d.settingsPage.realtime}</span>
            <span className="small">{d.realtime[state.realtime]}</span>
          </div>
          <label className="row between">
            <span>{d.settingsPage.language}</span>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={s.locale}
              onChange={(e) => set({ locale: e.target.value as 'auto' })}
            >
              {Object.entries(d.settingsPage.langs).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="row between">
            <span>{d.settingsPage.theme}</span>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={s.theme}
              onChange={(e) => set({ theme: e.target.value as 'auto' })}
            >
              {Object.entries(d.settingsPage.themes).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <form
            className="row between"
            onSubmit={(e) => {
              e.preventDefault();
              set({ deviceLabel: label });
            }}
          >
            <label className="field" style={{ flex: 1 }}>
              {d.settingsPage.deviceLabel}
              <input
                className="input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
              />
            </label>
            <button type="submit" className="btn" disabled={busy}>
              {d.common.save}
            </button>
          </form>
        </section>
      )}
      {loggedIn && <Devices state={state} />}
      <section className="card stack">
        <h2>{d.settingsPage.privacy}</h2>
        <p className="small">
          {d.settingsPage.privacyBody}{' '}
          <a href={chrome.runtime.getURL('privacy.html')} target="_blank" rel="noreferrer">
            {d.onboarding.privacyLink}
          </a>
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void send({ type: 'exportBackup' }).then((r) => {
                const e = r as { filename: string; json: string };
                downloadText(e.filename, e.json);
              })
            }
          >
            {d.settingsPage.export}
          </button>
          {loggedIn && (
            <button type="button" className="btn" onClick={() => setLogoutOpen(true)}>
              {d.logout}
            </button>
          )}
        </div>
        <p className="small muted">{d.settingsPage.uninstallNote}</p>
      </section>
      <Advanced state={state} refresh={refresh} />
      {loggedIn && <DangerZone state={state} refresh={refresh} go={go} />}
      <p className="small muted">{fmt(d.settingsPage.version, { v: state.version })}</p>
      {err && (
        <div className="alert danger" role="alert">
          {err.code}: {err.message}
        </div>
      )}
      <Dialog open={logoutOpen} onClose={() => setLogoutOpen(false)} title={d.logout}>
        {state.counts.outbox > 0 && <p>{d.settingsPage.logoutPending}</p>}
        {state.counts.outbox > 0 && (
          <>
            <label className="row">
              <input
                type="radio"
                checked={pendingChoice === 'keep'}
                onChange={() => setPendingChoice('keep')}
              />
              {d.settingsPage.logoutKeep}
            </label>
            <label className="row">
              <input
                type="radio"
                checked={pendingChoice === 'discard'}
                onChange={() => setPendingChoice('discard')}
              />
              {d.settingsPage.logoutDiscard}
            </label>
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => setLogoutOpen(false)}>
            {d.common.cancel}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() =>
              void run({ type: 'logout', pendingChoice }).then(() => {
                setLogoutOpen(false);
                void refresh();
                go('/onboarding');
              })
            }
          >
            {d.logout}
          </button>
        </div>
      </Dialog>
    </>
  );
}

function Devices({ state }: { state: StateSnapshot }) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const [list, setList] = useState<DeviceRecord[] | null>(null);
  useEffect(() => {
    void send({ type: 'listDevices' })
      .then(setList)
      .catch(() => setList([]));
  }, [state.account?.deviceId]);
  return (
    <section className="card stack" id="devices">
      <h2>{d.settingsPage.devices}</h2>
      <p className="small muted">{d.settingsPage.devicesNote}</p>
      {!list ? (
        <p className="muted">{d.common.loading}</p>
      ) : (
        <table className="table">
          <tbody>
            {list.map((dev) => (
              <tr key={dev.id}>
                <td>
                  {dev.label || '—'}{' '}
                  {dev.isCurrent && <span className="badge ok">{d.settingsPage.current}</span>}{' '}
                  {dev.revokedAt && <span className="badge">{d.settingsPage.revoked}</span>}
                </td>
                <td className="small muted">{dev.browser}</td>
                <td className="small muted">
                  {fmt(d.settingsPage.lastSeen, {
                    t: dev.lastSeenAt ? relTime(Date.parse(dev.lastSeenAt)) : d.never,
                  })}
                </td>
                <td>
                  {!dev.revokedAt && !dev.isCurrent && (
                    <button
                      type="button"
                      className="btn danger"
                      disabled={busy}
                      onClick={() =>
                        void run({ type: 'revokeDevice', deviceId: dev.id }).then(
                          (l) => l && setList(l),
                        )
                      }
                    >
                      {d.settingsPage.revoke}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {err && (
        <div className="alert danger" role="alert">
          {err.code}
        </div>
      )}
    </section>
  );
}

function Advanced({ state, refresh }: { state: StateSnapshot; refresh: () => Promise<void> }) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  return (
    <details className="card">
      <summary style={{ cursor: 'pointer' }}>
        <strong>{d.settingsPage.advanced}</strong>
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <h3>{d.settingsPage.backend}</h3>
        <p className="small muted">{d.settingsPage.backendHint}</p>
        <p className="small">
          {fmt(d.settingsPage.backendCurrent, {
            u: state.backend ? `${state.backend.url} (${state.backend.source})` : '—',
          })}
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ type: 'setBackend', url, anonKey: key }).then(() => refresh());
          }}
        >
          <label className="field">
            {d.settingsPage.backendUrl}
            <input
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://xxxx.supabase.co"
            />
          </label>
          <label className="field">
            {d.settingsPage.backendKey}
            <input
              className="input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="row">
            <button type="submit" className="btn" disabled={busy || !url || !key}>
              {d.settingsPage.backendConnect}
            </button>
            {state.backend?.source === 'custom' && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void run({ type: 'resetBackend' }).then(() => refresh())}
              >
                {d.settingsPage.backendReset}
              </button>
            )}
          </div>
        </form>
        <h3>{d.settingsPage.diagnostics}</h3>
        <p className="small muted">{d.settingsPage.diagnosticsNote}</p>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run({ type: 'diagnostics' }).then(
                (r) =>
                  r &&
                  downloadText(
                    `shatsu-ren-diagnostics-${Date.now()}.json`,
                    JSON.stringify(r, null, 1),
                  ),
              )
            }
          >
            {d.settingsPage.diagnostics}
          </button>
        </div>
        {state.blocked?.code === 'SERVER_GENERATION_CHANGED' && (
          <>
            <h3>{d.settingsPage.generationRecover}</h3>
            <p className="small muted">{d.settingsPage.generationRecoverHint}</p>
            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void run({ type: 'recoverGeneration' }).then(() => refresh())}
              >
                {d.settingsPage.generationRecover}
              </button>
            </div>
          </>
        )}
        {err && (
          <div className="alert danger" role="alert">
            {err.code}: {err.message}
          </div>
        )}
      </div>
    </details>
  );
}

function DangerZone({
  state,
  refresh,
  go,
}: {
  state: StateSnapshot;
  refresh: () => Promise<void>;
  go: (h: string) => void;
}) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <section className="card stack" style={{ borderColor: 'var(--danger)' }}>
      <h2 style={{ color: 'var(--danger)' }}>{d.settingsPage.danger}</h2>
      <p className="small">{d.settingsPage.deleteBody}</p>
      <div className="row">
        <button type="button" className="btn danger" onClick={() => setOpen(true)}>
          {d.settingsPage.deleteButton}
        </button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={d.settingsPage.danger}>
        <p className="small">{d.settingsPage.deleteBody}</p>
        <label className="field">
          {d.settingsPage.deleteConfirmLabel}
          <input
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </label>
        {err && (
          <div className="alert danger" role="alert">
            {err.message?.includes('RECENT_LOGIN')
              ? d.settingsPage.deleteRecent
              : `${err.code}: ${err.message}`}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            {d.common.cancel}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy || email !== state.account?.email}
            onClick={() =>
              void run({ type: 'deleteAccount', confirmEmail: email }).then((r) => {
                if (r) {
                  setOpen(false);
                  void refresh();
                  go('/onboarding');
                }
              })
            }
          >
            {d.settingsPage.deleteButton}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
