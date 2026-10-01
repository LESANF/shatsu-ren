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

function shortBrowser(deviceLabel: string): string {
  const brands =
    (navigator as { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands ?? [];
  const known: Record<string, string> = {
    'Google Chrome': 'Chrome',
    'Microsoft Edge': 'Edge',
    Brave: 'Brave',
    Opera: 'Opera',
    Vivaldi: 'Vivaldi',
  };
  for (const b of brands) if (known[b.brand]) return known[b.brand]!;
  return deviceLabel.split(' · ')[0]?.trim() || '';
}

function PickStep({
  state,
  onPlan,
}: {
  state: StateSnapshot;
  onPlan: (p: MergePlan & { collectionTitle: string; localTitle?: string }) => void;
}) {
  const d = dict();
  const o = d.onboarding;
  const { run, busy, err } = useRequest();
  const [tree, setTree] = useState<TreePickerNode[] | null>(null);
  const unbound = [...state.collections.filter((c) => !c.bound)].sort((a, b) => {
    const filled = Number((b.itemCount ?? 0) > 0) - Number((a.itemCount ?? 0) > 0);
    if (filled) return filled; // 내용이 있는 것 먼저
    const mine = Number(a.createdHere) - Number(b.createdHere);
    if (mine) return mine; // 다른 브라우저가 만든 것 먼저
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? ''); // 최근 것 먼저
  });
  const defaultTarget =
    unbound.find((c) => (c.itemCount ?? 0) > 0 && !c.createdHere)?.id ?? unbound[0]?.id ?? 'new';
  const [target, setTarget] = useState<string>(defaultTarget);
  const [how, setHow] = useState<'bind' | 'receive'>('bind');
  const [node, setNode] = useState<TreePickerNode | null>(null);
  const [sharedTitle, setSharedTitle] = useState('');
  const [newName, setNewName] = useState('');
  useEffect(() => {
    void send({ type: 'getFolderTree' }).then(setTree);
  }, []);
  const boundRoots = new Set(state.bindings.map((b) => b.localRootId));
  const reason = (n: TreePickerNode) => (boundRoots.has(n.id) ? o.nested : undefined);
  const col = target === 'new' ? null : (state.collections.find((c) => c.id === target) ?? null);
  const browser = shortBrowser(state.settings.deviceLabel);
  const select = (n: TreePickerNode) => {
    setNode(n);
    if (!col) setSharedTitle(browser ? `${browser} ${n.title}` : n.title);
    else setNewName(col.title);
  };
  const pickTarget = (id: string) => {
    setTarget(id);
    setNode(null);
  };
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
    parts.push(c.itemCount ? fmt(o.metaItems, { n: c.itemCount }) : o.metaEmpty);
    return parts.join(' · ');
  };
  const summary = !node
    ? o.pickFolderFirst
    : !col
      ? fmt(o.summaryNew, { local: node.title, shared: sharedTitle || node.title })
      : how === 'bind'
        ? fmt(o.summaryBind, { shared: col.title, local: node.title })
        : fmt(o.summaryReceive, {
            shared: col.title,
            local: node.title,
            name: newName || col.title,
          });
  const next = async () => {
    if (!node) return;
    const req = !col
      ? {
          type: 'previewMerge' as const,
          localRootId: node.id,
          newCollectionTitle: sharedTitle || node.title,
        }
      : how === 'bind'
        ? { type: 'previewMerge' as const, localRootId: node.id, collectionId: col.id }
        : {
            type: 'previewNewLocalFolder' as const,
            collectionId: col.id,
            parentLocalId: node.id,
            title: newName || col.title,
          };
    const p = await run(req);
    if (p)
      onPlan({
        ...p,
        localTitle:
          col && how === 'receive' ? `${node.title} / ${newName || col.title}` : node.title,
      });
  };
  return (
    <div className="card stack">
      {unbound.length > 0 && (
        <section className="stack" aria-labelledby="pick-shared">
          <h2 id="pick-shared">{o.step1Title}</h2>
          <p className="small muted">{o.step1Body}</p>
          <div className="choices" role="radiogroup" aria-labelledby="pick-shared">
            {unbound.map((c) => (
              <label key={c.id} className="choice" data-on={target === c.id || undefined}>
                <input
                  type="radio"
                  name="shared"
                  id={`shared-${c.id}`}
                  checked={target === c.id}
                  onChange={() => pickTarget(c.id)}
                />
                <span className="choice-body">
                  <strong>{c.title || o.untitled}</strong>
                  <span className="small muted">{meta(c)}</span>
                </span>
              </label>
            ))}
            <label className="choice" data-on={target === 'new' || undefined}>
              <input
                type="radio"
                name="shared"
                id="shared-new"
                checked={target === 'new'}
                onChange={() => pickTarget('new')}
              />
              <span className="choice-body">
                <strong>{o.newSharedOption}</strong>
                <span className="small muted">{o.newSharedOptionHint}</span>
              </span>
            </label>
          </div>
        </section>
      )}
      <section className="stack" aria-labelledby="pick-local">
        <h2 id="pick-local">
          {unbound.length === 0 ? o.pickTitle : col ? o.step2BindTitle : o.step2NewTitle}
        </h2>
        {col ? (
          <div className="choices row-choices" role="radiogroup" aria-label={o.step2BindTitle}>
            <label className="choice" data-on={how === 'bind' || undefined}>
              <input
                type="radio"
                name="how"
                id="how-bind"
                checked={how === 'bind'}
                onChange={() => setHow('bind')}
              />
              <span className="choice-body">
                <strong>{o.howBind}</strong>
                <span className="small muted">{o.howBindHint}</span>
              </span>
            </label>
            <label className="choice" data-on={how === 'receive' || undefined}>
              <input
                type="radio"
                name="how"
                id="how-receive"
                checked={how === 'receive'}
                onChange={() => setHow('receive')}
              />
              <span className="choice-body">
                <strong>{o.howReceive}</strong>
                <span className="small muted">{o.howReceiveHint}</span>
              </span>
            </label>
          </div>
        ) : (
          <p className="small muted">{o.pickBody}</p>
        )}
        {tree ? (
          <FolderTree
            nodes={tree}
            selected={node?.id ?? null}
            onSelect={select}
            disabledIds={boundRoots}
            disabledReason={reason}
          />
        ) : (
          <Spinner />
        )}
        {!col && node && (
          <label className="field">
            {o.sharedName}
            <input
              id="shared-title"
              className="input"
              value={sharedTitle}
              onChange={(e) => setSharedTitle(e.target.value)}
            />
            <span className="small muted">{o.sharedNameHint}</span>
          </label>
        )}
        {col && how === 'receive' && node && (
          <label className="field">
            {o.newFolderName}
            <input
              id="new-folder-name"
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
        )}
      </section>
      {err && (
        <div className="alert danger" role="alert">
          {err.code === 'NESTED_BINDING'
            ? o.nested
            : err.code === 'MANAGED'
              ? o.managed
              : `${err.code}: ${err.message}`}
        </div>
      )}
      <div className="summary" aria-live="polite" data-ready={node ? true : undefined}>
        {summary}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn primary lg"
          disabled={!node || busy || boundRoots.has(node.id)}
          onClick={() => void next()}
        >
          {o.nextToPreview}
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
