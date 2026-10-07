import { useEffect, useState } from 'react';
import { dict, fmt } from '../../i18n';
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
  const [plan, setPlan] = useState<(MergePlan & { collectionTitle: string }) | null>(null);
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
        <PickStep
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

function PickStep({
  state,
  onPlan,
}: {
  state: StateSnapshot;
  onPlan: (p: MergePlan & { collectionTitle: string }) => void;
}) {
  const d = dict();
  const { run, busy, err } = useRequest();
  const [tree, setTree] = useState<TreePickerNode[] | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [sharedTitle, setSharedTitle] = useState('');
  const [newName, setNewName] = useState('');
  const [selectedNode, setSelectedNode] = useState<TreePickerNode | null>(null);
  const [mode, setMode] = useState<
    'newShared' | { collectionId: string; how: 'bind' | 'receive' } | null
  >(null);
  const unbound = state.collections.filter((c) => !c.bound);
  useEffect(() => {
    void send({ type: 'getFolderTree' }).then(setTree);
  }, []);
  const boundRoots = new Set(state.bindings.map((b) => b.localRootId));
  const isDisabled = (n: TreePickerNode) => boundRoots.has(n.id);
  const reason = (n: TreePickerNode) => (boundRoots.has(n.id) ? d.onboarding.nested : undefined);
  const select = (n: TreePickerNode) => {
    setSelectedNode(n);
    if (mode === 'newShared' || mode === null) {
      setMode('newShared');
      setSharedTitle(n.title);
      setChoice({ mode: 'newShared', localRootId: n.id, title: n.title });
    } else if (mode.how === 'bind')
      setChoice({ mode: 'bindExisting', collectionId: mode.collectionId, localRootId: n.id });
    else {
      const col = state.collections.find((c) => c.id === mode.collectionId)!;
      setNewName(col.title);
      setChoice({
        mode: 'receiveNew',
        collectionId: mode.collectionId,
        parentLocalId: n.id,
        title: col.title,
      });
    }
  };
  const next = async () => {
    if (!choice) return;
    const req =
      choice.mode === 'newShared'
        ? {
            type: 'previewMerge' as const,
            localRootId: choice.localRootId,
            newCollectionTitle: sharedTitle,
          }
        : choice.mode === 'bindExisting'
          ? {
              type: 'previewMerge' as const,
              localRootId: choice.localRootId,
              collectionId: choice.collectionId,
            }
          : {
              type: 'previewNewLocalFolder' as const,
              collectionId: choice.collectionId,
              parentLocalId: choice.parentLocalId,
              title: newName,
            };
    const p = await run(req);
    if (p) onPlan(p);
  };
  return (
    <div className="card stack">
      {unbound.length > 0 && (
        <section className="stack">
          <h2>{d.onboarding.existingTitle}</h2>
          <p className="small muted">{d.onboarding.existingBody}</p>
          <table className="table">
            <tbody>
              {unbound.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td className="row" style={{ justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn"
                      aria-pressed={
                        typeof mode === 'object' &&
                        mode?.collectionId === c.id &&
                        mode.how === 'bind'
                      }
                      onClick={() => {
                        setMode({ collectionId: c.id, how: 'bind' });
                        setChoice(null);
                        setSelectedNode(null);
                      }}
                    >
                      {d.onboarding.pickLocal}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-pressed={
                        typeof mode === 'object' &&
                        mode?.collectionId === c.id &&
                        mode.how === 'receive'
                      }
                      onClick={() => {
                        setMode({ collectionId: c.id, how: 'receive' });
                        setChoice(null);
                        setSelectedNode(null);
                      }}
                    >
                      {d.onboarding.receiveNew}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="btn link small"
            aria-pressed={mode === 'newShared'}
            onClick={() => {
              setMode('newShared');
              setChoice(null);
              setSelectedNode(null);
            }}
          >
            {d.onboarding.addLocalAsNew}
          </button>
        </section>
      )}
      <h2>
        {typeof mode === 'object' && mode?.how === 'receive'
          ? d.onboarding.newFolderParent
          : d.onboarding.pickTitle}
      </h2>
      <p className="small muted">{d.onboarding.pickBody}</p>
      {tree ? (
        <FolderTree
          nodes={tree}
          selected={selectedNode?.id ?? null}
          onSelect={select}
          disabledIds={new Set([...boundRoots])}
          disabledReason={reason}
        />
      ) : (
        <Spinner />
      )}
      {choice?.mode === 'newShared' && (
        <label className="field">
          {d.onboarding.sharedName}
          <input
            className="input"
            value={sharedTitle}
            onChange={(e) => setSharedTitle(e.target.value)}
          />
          <span className="small muted">{d.onboarding.sharedNameHint}</span>
        </label>
      )}
      {choice?.mode === 'receiveNew' && (
        <label className="field">
          {d.onboarding.newFolderName}
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
      )}
      {err && (
        <div className="alert danger" role="alert">
          {err.code === 'NESTED_BINDING'
            ? d.onboarding.nested
            : err.code === 'MANAGED'
              ? d.onboarding.managed
              : `${err.code}: ${err.message}`}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn primary lg"
          disabled={!choice || busy || isDisabled(selectedNode ?? ({ id: '' } as TreePickerNode))}
          onClick={() => void next()}
        >
          {d.onboarding.next}
        </button>
      </div>
    </div>
  );
}

export function PreviewStep({
  plan,
  onBack,
  onDone,
  onReplan,
}: {
  plan: MergePlan & { collectionTitle: string };
  onBack: () => void;
  onDone: (local: string, shared: string) => void;
  onReplan: (p: MergePlan & { collectionTitle: string }) => void;
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
            onReplan(p);
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
          l: plan.localRootId ? '…' : d.onboarding.receiveNew,
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
