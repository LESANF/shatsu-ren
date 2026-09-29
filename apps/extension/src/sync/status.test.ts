import { describe, expect, it } from 'vitest';
import { representativeStatus, type StatusInputs } from './status';

const base: StatusInputs = {
  workerReady: true,
  authRequired: false,
  blocked: null,
  recoveryRequired: 0,
  conflicts: 0,
  reviews: 0,
  bindings: 1,
  activeBindings: 1,
  pausedBindings: 0,
  autoSync: true,
  offline: false,
  realtime: 'connected',
  running: false,
  outbox: 0,
  pendingApply: 0,
};

describe('U10 대표 상태 우선순위', () => {
  it('idle 은 모든 대기·문제가 없을 때만', () => {
    expect(representativeStatus(base)).toBe('idle');
    expect(representativeStatus({ ...base, outbox: 1 })).toBe('pending');
    expect(representativeStatus({ ...base, pendingApply: 1 })).toBe('pending');
  });
  it('여러 문제 공존 시 auth → blocked → recovery → conflict → review → unconfigured → paused → offline → reconnecting → syncing', () => {
    const all: StatusInputs = {
      ...base,
      authRequired: true,
      blocked: { code: 'X' },
      recoveryRequired: 1,
      conflicts: 1,
      reviews: 1,
      bindings: 0,
      autoSync: false,
      offline: true,
      realtime: 'reconnecting',
      running: true,
    };
    expect(representativeStatus(all)).toBe('auth_required');
    expect(representativeStatus({ ...all, authRequired: false })).toBe('blocked');
    expect(representativeStatus({ ...all, authRequired: false, blocked: null })).toBe(
      'recovery_required',
    );
    expect(
      representativeStatus({ ...all, authRequired: false, blocked: null, recoveryRequired: 0 }),
    ).toBe('conflict');
    expect(
      representativeStatus({
        ...all,
        authRequired: false,
        blocked: null,
        recoveryRequired: 0,
        conflicts: 0,
      }),
    ).toBe('review_required');
    expect(
      representativeStatus({
        ...all,
        authRequired: false,
        blocked: null,
        recoveryRequired: 0,
        conflicts: 0,
        reviews: 0,
      }),
    ).toBe('unconfigured');
    expect(
      representativeStatus({
        ...all,
        authRequired: false,
        blocked: null,
        recoveryRequired: 0,
        conflicts: 0,
        reviews: 0,
        bindings: 1,
        running: false,
      }),
    ).toBe('paused');
    expect(
      representativeStatus({
        ...all,
        authRequired: false,
        blocked: null,
        recoveryRequired: 0,
        conflicts: 0,
        reviews: 0,
        bindings: 1,
        autoSync: true,
        running: false,
      }),
    ).toBe('offline');
    expect(representativeStatus({ ...base, realtime: 'reconnecting' })).toBe('reconnecting');
    expect(representativeStatus({ ...base, running: true })).toBe('syncing');
  });
  it('worker 연결 전에는 저장된 성공을 표시하지 않는다', () => {
    expect(representativeStatus({ ...base, workerReady: false })).toBe('checking');
  });
  it('폴더 전부 정지 = paused, 일부 정지는 idle(범위 표시는 UI)', () => {
    expect(representativeStatus({ ...base, activeBindings: 0, pausedBindings: 1 })).toBe('paused');
    expect(
      representativeStatus({ ...base, bindings: 2, activeBindings: 1, pausedBindings: 1 }),
    ).toBe('idle');
  });
});
