import { useCallback, useEffect, useRef, useState } from 'react';
import { send, type Request, type Response, type StateSnapshot } from '../messages';
import { setLocale } from '../i18n';

/** worker 상태를 주기적으로 읽는다(보이는 동안만, 앞 요청이 끝난 뒤에만). 저장된 성공 상태를 현재 성공으로 꾸미지 않는다. */
export function useWorkerState(intervalMs = 3000) {
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const s = await send({ type: 'getState' });
      applyPrefs(s);
      setState(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(
      () => document.visibilityState === 'visible' && void refresh(),
      intervalMs,
    );
    const onVis = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh, intervalMs]);
  const rerender = useCallback(() => force((n) => n + 1), []);
  return { state, error, refresh, rerender };
}

function applyPrefs(s: StateSnapshot) {
  setLocale(s.settings.locale);
  const t = s.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function useRequest() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const run = useCallback(
    async <T extends Request>(req: T): Promise<Response<T['type']> | undefined> => {
      setBusy(true);
      setErr(null);
      try {
        return await send(req);
      } catch (e) {
        const er = e as { code?: string; message: string };
        if (alive.current) setErr({ code: er.code ?? 'INTERNAL', message: er.message });
        return undefined;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [],
  );
  return { run, busy, err, clear: () => setErr(null) };
}

export function useHashRoute(): [string, (h: string) => void] {
  const [hash, setHash] = useState(location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const on = () => setHash(location.hash.replace(/^#/, '') || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [
    hash,
    (h) => {
      location.hash = h;
    },
  ];
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
