import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dict, fmt, relTime } from '../i18n';
import type { StateSnapshot } from '../messages';
import type { TreePickerNode } from '../sync/browser';

export function StatusLine({ state }: { state: StateSnapshot | null }) {
  const d = dict();
  if (!state)
    return (
      <div className="status-line" aria-live="polite">
        <span className="dot" />
        {d.status.checking}
      </div>
    );
  const s = state.status;
  const paused = state.bindings.filter((b) => b.status === 'paused').length;
  const tone =
    s === 'idle'
      ? 'ok'
      : ['conflict', 'recovery_required', 'auth_required', 'blocked'].includes(s)
        ? 'danger'
        : ['review_required', 'offline', 'reconnecting', 'paused'].includes(s)
          ? 'warn'
          : 'none';
  let text: string;
  switch (s) {
    case 'idle':
      text = paused ? fmt(d.status.idlePartial, { n: paused }) : d.status.idle;
      break;
    case 'pending':
      text = fmt(d.status.pending, { out: state.counts.outbox, in: state.counts.pendingApply });
      break;
    case 'review_required':
      text = fmt(d.status.review_required, { n: state.counts.reviews });
      break;
    case 'conflict':
      text = fmt(d.status.conflict, { n: state.counts.conflicts });
      break;
    case 'syncing':
      text = state.settings.autoSync ? d.status.syncing : d.status.syncingManualOff;
      break;
    case 'blocked':
      text =
        (state.statusDetail && (d.blockedCodes as Record<string, string>)[state.statusDetail]) ??
        d.status.blocked;
      break;
    default:
      text = d.status[s];
  }
  return (
    <div className="status-line" data-tone={tone} aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {text}
    </div>
  );
}

export function ErrorLine({ state }: { state: StateSnapshot }) {
  const d = dict();
  if (!state.lastError || state.status === 'idle' || state.status === 'syncing') return null;
  const msg =
    (d.errorCodes as Record<string, string>)[state.lastError.code] ??
    `${d.common.error}: ${state.lastError.code}`;
  return (
    <div className="small muted">
      {msg}
      {state.nextRetryAt ? ` · ${fmt(d.nextRetry, { t: relTime(state.nextRetryAt) })}` : ''}
    </div>
  );
}

export function LastCheck({ state }: { state: StateSnapshot }) {
  const d = dict();
  return (
    <div
      className="small muted"
      title={state.lastServerCheckAt ? new Date(state.lastServerCheckAt).toISOString() : ''}
    >
      {fmt(d.lastCheck, { t: relTime(state.lastServerCheckAt) })}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      prev.current = document.activeElement;
      el.showModal();
    }
    if (!open && el.open) {
      el.close();
      (prev.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dlg-title">
      <div className="stack">
        <h2 id="dlg-title">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

/** 폴더 트리: 단순 펼침 목록 (불완전한 ARIA tree 대신 button 목록). */
export function FolderTree({
  nodes,
  selected,
  onSelect,
  disabledIds,
  disabledReason,
}: {
  nodes: TreePickerNode[];
  selected: string | null;
  onSelect: (n: TreePickerNode) => void;
  disabledIds?: Set<string>;
  disabledReason?: (n: TreePickerNode) => string | undefined;
}) {
  const d = dict();
  const [open, setOpen] = useState<Set<string>>(() => new Set(nodes.map((n) => n.id)));
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const render = (n: TreePickerNode): ReactNode => {
    const disabled = n.unmodifiable || disabledIds?.has(n.id);
    const reason = n.unmodifiable ? d.onboarding.managed : disabledReason?.(n);
    const label = `${n.title || '(untitled)'} · ${n.count}`;
    return (
      <li key={n.id}>
        <div
          className="node"
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled ? 'true' : undefined}
          aria-selected={selected === n.id ? 'true' : undefined}
          aria-label={label}
          onClick={() => !disabled && onSelect(n)}
          onKeyDown={(e) => {
            if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onSelect(n);
            }
          }}
        >
          {n.children.length ? (
            <button
              type="button"
              className="toggle"
              aria-label={open.has(n.id) ? 'collapse' : 'expand'}
              aria-expanded={open.has(n.id)}
              onClick={(e) => {
                e.stopPropagation();
                toggle(n.id);
              }}
            >
              {open.has(n.id) ? '▾' : '▸'}
            </button>
          ) : (
            <span className="toggle" aria-hidden="true">
              ·
            </span>
          )}
          <span className="ellipsis" style={{ flex: 1 }}>
            {n.title || '(untitled)'}
          </span>
          <span className="small muted">{n.count}</span>
          {reason && <span className="badge small">{reason}</span>}
        </div>
        {n.children.length > 0 && open.has(n.id) && <ul>{n.children.map(render)}</ul>}
      </li>
    );
  };
  return <ul className="tree">{nodes.map(render)}</ul>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="small muted">
      {label ?? dict().common.loading}
    </span>
  );
}
