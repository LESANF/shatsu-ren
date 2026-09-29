import { en } from './locales/en';
import { ko, type Dict } from './locales/ko';

export type Locale = 'ko' | 'en';
let current: Locale = 'ko';
export function setLocale(pref: 'auto' | Locale) {
  current =
    pref === 'auto' ? (navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en') : pref;
  document.documentElement.lang = current;
}
export const dict = (): Dict => (current === 'ko' ? ko : en);
export const locale = () => current;

export function fmt(s: string, params?: Record<string, string | number>): string {
  return params ? s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : s;
}

export function relTime(ts: number | null | undefined): string {
  const d = dict();
  if (!ts) return d.never;
  const diff = Date.now() - ts;
  if (diff < 60_000) return d.justNow;
  if (diff < 3_600_000) return fmt(d.minutesAgo, { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return fmt(d.hoursAgo, { n: Math.floor(diff / 3_600_000) });
  return fmt(d.daysAgo, { n: Math.floor(diff / 86_400_000) });
}

export const absTime = (ts: number | string) =>
  new Date(ts).toLocaleString(current === 'ko' ? 'ko-KR' : 'en-US');
