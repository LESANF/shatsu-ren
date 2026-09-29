import type { SyncStatusKind } from './types';

export interface StatusInputs {
  workerReady: boolean;
  authRequired: boolean;
  blocked: { code: string } | null;
  recoveryRequired: number;
  conflicts: number;
  reviews: number;
  bindings: number;
  activeBindings: number;
  pausedBindings: number;
  autoSync: boolean;
  offline: boolean;
  realtime: 'connected' | 'reconnecting' | 'off';
  running: boolean;
  outbox: number;
  pendingApply: number;
}

/** 대표 상태 우선순위 (청사진 17.2) */
export function representativeStatus(i: StatusInputs): SyncStatusKind {
  if (!i.workerReady) return 'checking';
  if (i.authRequired) return 'auth_required';
  if (i.blocked) return 'blocked';
  if (i.recoveryRequired > 0) return 'recovery_required';
  if (i.conflicts > 0) return 'conflict';
  if (i.reviews > 0) return 'review_required';
  if (i.bindings === 0) return 'unconfigured';
  if (!i.autoSync || (i.activeBindings === 0 && i.pausedBindings > 0))
    return i.running ? 'syncing' : 'paused';
  if (i.offline) return 'offline';
  if (i.realtime === 'reconnecting') return 'reconnecting';
  if (i.running) return 'syncing';
  if (i.outbox > 0 || i.pendingApply > 0) return 'pending';
  return 'idle';
}
