import { useEffect, useState } from 'react';
import { dict, fmt, locale } from '../../i18n';
import { send, type StateSnapshot } from '../../messages';
import type { TreePickerNode } from '../../sync/browser';
import type { MergePlan } from '../../sync/plan';
import { FolderTree, Spinner } from '../components';
import { downloadText, useRequest } from '../hooks';

type Step = 0 | 1 | 2 | 3;
type Choice =
  | { mode: 'newShared'; localRootId: string; title: string }
  | { mode: 'bindExisting'; collectionId: string; localRootId: string }
  | { mode: 'receiveNew'; collectionId: string; parentLocalId: string; title: string };

export function Onboarding({
  state,
  refresh,
  go,
}: {
  state: StateSnapshot;
  refresh: () => Promise<void>;
  go: (h: string) => void;
}) {
  const d = dict();
  const loggedIn = state.status !== 'auth_required' && !!state.account;
  const [step, setStep] = useState<Step>(loggedIn ? 1 : 0);
  const [plan, setPlan] = useState<
    (MergePlan & { collectionTitle: string; localTitle?: string }) | null
  >(null);
  const [done, setDone] = useState<{ local: string; shared: string } | null>(null);
  useEffect(() => {
    if (loggedIn && step === 0) setStep(1);
  }, [loggedIn, step]);
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }} className="stack">
      <div className="row between">
        <h1>{d.appName}</h1>
        <a className="btn" href="#/settings">
          {d.common.openSettings}
        </a>
        {state.account && (
          <span className="small muted">
            {fmt(d.onboarding.signedInAs, { email: state.account.email })}
          </span>
        )}
      </div>
      <ol className="steps">
        {d.onboarding.steps.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {step === 0 && <LoginStep state={state} refresh={refresh} />}
      {step === 1 && (
        <ConnectStep
          state={state}
          onPlan={(p) => {
            setPlan(p);
            setStep(2);
          }}
        />
      )}
      {step === 2 && plan && (
        <PreviewStep
          plan={plan}
          onBack={() => setStep(1)}
          onDone={(l, s) => {
            setDone({ local: l, shared: s });
            setStep(3);
            void refresh();
          }}
          onReplan={(p) => setPlan(p)}
        />
      )}
      {step === 3 && done && (
        <div className="card stack">
          <h2>{d.onboarding.doneTitle}</h2>
          <p>{fmt(d.onboarding.doneBody, { l: done.local, s: done.shared })}</p>
          <p className="muted small">{d.onboarding.laterNote}</p>
          <div className="alert">{d.onboarding.doneOther}</div>
          <div className="row">
            <button type="button" className="btn primary lg" onClick={() => go('/')}>
              {d.onboarding.goOverview}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LoginStep({ state, refresh }: { state: StateSnapshot; refresh: () => Promise<void> }) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const [email, setEmail] = useState('synthetic-a@example.com');
  const [pw, setPw] = useState('');
  return (
    <div className="card stack">
      <h2>{d.onboarding.introTitle}</h2>
      <p>{d.onboarding.introBody}</p>
      <div className="alert">
        {d.onboarding.introPrivacy}{' '}
        <a href={chrome.runtime.getURL('privacy.html')} target="_blank" rel="noreferrer">
          {d.onboarding.privacyLink}
        </a>
      </div>
      {!state.backend && <div className="alert danger">{d.noBackend}</div>}
      <div className="row">
        <button
          type="button"
          className="btn primary lg"
          disabled={busy || !state.backend}
          onClick={() => void run({ type: 'login', provider: 'google' }).then(() => refresh())}
        >
          {d.login}
        </button>
      </div>
      {state.devAuth && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ type: 'loginDev', email, password: pw }).then(() => refresh());
          }}
        >
          <h3>{d.loginDev}</h3>
          <p className="small muted">{d.loginDevHint}</p>
          <label className="field">
            Email
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="field">
            Password
            <input
              className="input"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="row">
            <button type="submit" className="btn" disabled={busy || !state.backend}>
              {d.loginDev}
            </button>
          </div>
        </form>
      )}
      {busy && <Spinner />}
      {err && (
        <div className="alert danger" role="alert">
          {err.code}
          {err.message ? `: ${err.message}` : ''}
        </div>
      )}
    </div>
  );
}

function ConnectStep({
  state,
  onPlan,
}: {
  state: StateSnapshot;
  onPlan: (p: MergePlan & { collectionTitle: string; localTitle?: string }) => void;
}) {
  const d = dict();
  const o = d.onboarding;
  const { run, busy, err } = useRequest();
  const sets = state.collections;
  const receivable = sets.filter((c) => !c.bound);
  const [tab, setTab] = useState<'download' | 'upload'>(receivable.length ? 'download' : 'upload');
  const [tree, setTree] = useState<TreePickerNode[] | null>(null);
  const [node, setNode] = useState<TreePickerNode | null>(null);
  const [title, setTitle] = useState('');
  useEffect(() => {
    void send({ type: 'getFolderTree' }).then(setTree);
  }, []);
  const boundRoots = new Set(state.bindings.map((b) => b.localRootId));
  const name = title.trim();
  const taken = !!name && sets.some((c) => c.title.trim().toLowerCase() === name.toLowerCase());
  const meta = (c: StateSnapshot['collections'][number]) => {
    const parts: string[] = [];
    if (c.createdHere) parts.push(o.metaCreatedHere);
    else if (c.createdBy) parts.push(fmt(o.metaCreatedBy, { who: c.createdBy }));
    if (c.createdAt)
      parts.push(
        new Date(c.createdAt).toLocaleString(locale() === 'ko' ? 'ko-KR' : 'en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
      );
    if (c.itemCount !== null)
      parts.push(c.itemCount ? fmt(o.metaItems, { n: c.itemCount }) : o.metaEmpty);
    return parts.join(' · ');
  };
  const errText = (code: string, message: string) =>
    code === 'DUPLICATE_TITLE'
      ? o.titleTaken
      : code === 'EMPTY_TITLE'
        ? o.titleEmpty
        : code === 'NESTED_BINDING'
          ? o.nested
          : code === 'MANAGED'
            ? o.managed
            : `${code}: ${message}`;
  return (
    <div className="card stack">
      <div className="choices row-choices" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'download'}
          className="choice"
          data-on={tab === 'download' || undefined}
          onClick={() => setTab('download')}
        >
          <span className="choice-body">
            <strong>{o.tabDownload}</strong>
            <span className="small muted">{o.tabDownloadHint}</span>
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'upload'}
          className="choice"
          data-on={tab === 'upload' || undefined}
          onClick={() => setTab('upload')}
        >
          <span className="choice-body">
            <strong>{o.tabUpload}</strong>
            <span className="small muted">{o.tabUploadHint}</span>
          </span>
        </button>
      </div>

      {tab === 'download' ? (
        sets.length === 0 ? (
          <p className="muted">{o.noSets}</p>
        ) : (
          <ul className="sets">
            {sets.map((c) => (
              <li key={c.id} className="set">
                <span className="choice-body">
                  <strong>{c.title || o.untitled}</strong>
                  <span className="small muted">{meta(c)}</span>
                </span>
                {c.bound ? (
                  <span className="badge ok">{o.alreadyHere}</span>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      void run({ type: 'previewDownload', collectionId: c.id }).then(
                        (p) => p && onPlan(p),
                      )
                    }
                  >
                    {o.download}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <p className="small muted">{o.uploadBody}</p>
          {tree ? (
            <FolderTree
              nodes={tree}
              selected={node?.id ?? null}
              onSelect={(n) => {
                setNode(n);
                setTitle(n.title);
              }}
              disabledIds={boundRoots}
              disabledReason={(n) => (boundRoots.has(n.id) ? o.alreadyUploaded : undefined)}
            />
          ) : (
            <Spinner />
          )}
          {node && (
            <label className="field">
              {o.uploadName}
              <input
                id="upload-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-invalid={taken || undefined}
              />
              <span className="small" style={{ color: taken ? 'var(--danger)' : undefined }}>
                {taken ? o.titleTaken : o.uploadNameHint}
              </span>
            </label>
          )}
          <div className="summary" data-ready={node ? true : undefined} aria-live="polite">
            {node
              ? fmt(o.summaryUpload, { local: node.title, name: name || node.title })
              : o.pickFolderFirst}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn primary lg"
              disabled={!node || !name || taken || busy}
              onClick={() =>
                void run({ type: 'previewUpload', localRootId: node!.id, title: name }).then(
                  (p) => p && onPlan(p),
                )
              }
            >
              {o.nextToPreview}
            </button>
          </div>
        </>
      )}
      {err && (
        <div className="alert danger" role="alert">
          {errText(err.code, err.message)}
        </div>
      )}
    </div>
  );
}

export function PreviewStep({
  plan,
  onBack,
  onDone,
  onReplan,
}: {
  plan: MergePlan & { collectionTitle: string; localTitle?: string };
  onBack: () => void;
  onDone: (local: string, shared: string) => void;
  onReplan: (p: MergePlan & { collectionTitle: string; localTitle?: string }) => void;
}) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const [showItems, setShowItems] = useState(false);
  const [replan, setReplan] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const c = plan.counts;
  const apply = async () => {
    setProgress(d.onboarding.applying);
    const res = await run({ type: 'applyMerge', planId: plan.planId });
    setProgress(null);
    if (res) {
      const local =
        (await send({ type: 'getState' })).bindings.find(
          (b) => b.collectionId === plan.collectionId,
        )?.rootTitle ?? '';
      onDone(local, plan.collectionTitle);
    }
  };
  useEffect(() => {
    if (err?.code === 'REPLAN') {
      setReplan(true);
      const req = plan.localRootId
        ? {
            type: 'previewMerge' as const,
            localRootId: plan.localRootId,
            collectionId: plan.collectionId,
          }
        : null;
      if (req)
        void send(req)
          .then((p) => {
            onReplan({ ...p, ...(plan.localTitle ? { localTitle: plan.localTitle } : {}) });
            setReplan(false);
          })
          .catch(() => undefined);
    }
  }, [err, plan, onReplan]);
  const Row = ({ label, n, unit }: { label: string; n: number; unit?: string }) => (
    <div className="count-row">
      <span>{label}</span>
      <strong>
        {unit === 'pairs' ? fmt(d.onboarding.pairs, { n }) : fmt(d.onboarding.items, { n })}
      </strong>
    </div>
  );
  return (
    <div className="card stack">
      <h2>{d.onboarding.previewTitle}</h2>
      <p className="small muted">
        {fmt(d.onboarding.shared, {
          s: plan.collectionTitle,
          l: plan.localTitle ?? d.onboarding.receiveNew,
        })}
      </p>
      {replan && (
        <div className="alert" role="alert">
          {d.onboarding.replan}
        </div>
      )}
      <div>
        <Row label={d.onboarding.toLocal} n={c.toLocal} />
        <div className="small muted" style={{ paddingLeft: 12 }}>
          {fmt(d.onboarding.itemsDetail, {
            b: c.toLocal - c.folders.toLocal,
            f: c.folders.toLocal,
          })}
        </div>
        <Row label={d.onboarding.toServer} n={c.toServer} />
        <div className="small muted" style={{ paddingLeft: 12 }}>
          {fmt(d.onboarding.itemsDetail, {
            b: c.toServer - c.folders.toServer,
            f: c.folders.toServer,
          })}
        </div>
        <Row label={d.onboarding.matched} n={c.matched} />
        <Row label={d.onboarding.duplicates} n={c.duplicateCandidates} unit="pairs" />
        <Row label={d.onboarding.excluded} n={c.excluded} />
        <Row label={d.onboarding.deletes} n={0} />
      </div>
      {c.reorderedFolders > 0 && (
        <p className="small muted">
          {fmt(d.onboarding.orderedFolders, { n: c.reorderedFolders })} · {d.onboarding.ordersNote}
        </p>
      )}
      {c.duplicateCandidates > 0 && <p className="small muted">{d.onboarding.dupNote}</p>}
      {c.excluded > 0 && <p className="small muted">{d.onboarding.excludedNote}</p>}
      <div className="row">
        <button
          type="button"
          className="btn"
          aria-expanded={showItems}
          onClick={() => setShowItems((s) => !s)}
        >
          {d.onboarding.showItems}
        </button>
      </div>
      {showItems && (
        <table className="table">
          <thead>
            <tr>
              <th>{d.onboarding.direction.matched}</th>
              <th>{d.common.folder}</th>
              <th>Title</th>
            </tr>
          </thead>
          <tbody>
            {plan.items.slice(0, 500).map((it, i) => (
              <tr key={i}>
                <td>{d.onboarding.direction[it.direction]}</td>
                <td className="small muted">{it.path.join(' › ')}</td>
                <td>
                  {it.kind === 'folder' ? '📁 ' : ''}
                  {it.title}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="small">
        {d.onboarding.backupSaved}{' '}
        <button
          type="button"
          className="btn link small"
          onClick={() =>
            void send({ type: 'exportBackup' }).then((r) =>
              downloadText(
                (r as { filename: string; json: string }).filename,
                (r as { json: string }).json,
              ),
            )
          }
        >
          {d.onboarding.downloadBackup}
        </button>
      </p>
      <p className="small muted">{d.onboarding.laterNote}</p>
      {err && err.code !== 'REPLAN' && (
        <div className="alert danger" role="alert">
          {err.code === 'BACKUP_FAILED' ? d.onboarding.backupFailed : `${err.code}: ${err.message}`}
        </div>
      )}
      {progress && <Spinner label={progress} />}
      <div className="row between">
        <button type="button" className="btn" onClick={onBack} disabled={busy}>
          {d.onboarding.back}
        </button>
        <button
          type="button"
          className="btn primary lg"
          disabled={busy || replan}
          onClick={() => void apply()}
        >
          {d.onboarding.confirm}
        </button>
      </div>
    </div>
  );
}
