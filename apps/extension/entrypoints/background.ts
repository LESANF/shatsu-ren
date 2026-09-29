import type { Reply, Request } from '../src/messages';
import { Service } from '../src/service';

export default defineBackground(() => {
  const service = new Service();
  void service.boot();

  chrome.runtime.onInstalled.addListener(() => void service.boot());
  chrome.runtime.onStartup.addListener(() => void service.boot());
  chrome.alarms.onAlarm.addListener((a) => service.onAlarm(a.name));

  for (const ev of [
    chrome.bookmarks.onCreated,
    chrome.bookmarks.onChanged,
    chrome.bookmarks.onMoved,
    chrome.bookmarks.onRemoved,
  ]) {
    ev.addListener(() => service.onBookmarkEvent());
  }
  (
    chrome.bookmarks as { onChildrenReordered?: chrome.events.Event<() => void> }
  ).onChildrenReordered?.addListener(() => service.onBookmarkEvent());
  chrome.bookmarks.onImportEnded?.addListener(() => service.onBookmarkEvent());

  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse: (r: Reply) => void) => {
    // 확장 내부 페이지만. 외부 메시지 수신 없음.
    if (
      sender.id !== chrome.runtime.id ||
      !msg ||
      typeof msg !== 'object' ||
      typeof (msg as { type?: unknown }).type !== 'string'
    ) {
      sendResponse({ ok: false, code: 'FORBIDDEN' });
      return false;
    }
    service.handle(msg as Request).then(
      (data) => sendResponse({ ok: true, data }),
      (e: unknown) => {
        const err = e as { code?: string; message?: string; planId?: string };
        sendResponse({
          ok: false,
          code: err.code ?? 'INTERNAL',
          message: err.message ?? String(e),
          ...(err.planId ? { planId: err.planId } : {}),
        } as Reply);
      },
    );
    return true;
  });
});
