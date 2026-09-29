import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/** 프로필당 socket 하나, workspace private channel 하나. 팝업/설정은 연결을 만들지 않는다. */
export class RealtimeLink {
  private channel: RealtimeChannel | null = null;
  private client: SupabaseClient | null = null;
  private topic = '';
  status: 'off' | 'connecting' | 'connected' | 'reconnecting' = 'off';
  lastMessageAt = 0;
  lastError: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private token = '';
  constructor(
    private onChanged: () => void,
    private onStatus: (s: RealtimeLink['status']) => void,
  ) {}

  async connect(client: SupabaseClient, workspaceId: string, token: string): Promise<void> {
    const topic = `workspace:${workspaceId}`;
    this.token = token;
    if (this.channel && this.client === client && this.topic === topic) {
      await client.realtime.setAuth(token);
      if (this.channel.state === 'joined' || this.channel.state === 'joining') return;
      // 끊긴 채널은 다시 만든다
    }
    await this.teardown();
    this.client = client;
    this.topic = topic;
    await client.realtime.setAuth(token);
    this.set('connecting');
    const ch = client.channel(topic, { config: { private: true, broadcast: { self: true } } });
    ch.on('broadcast', { event: 'changed' }, () => {
      this.lastMessageAt = Date.now();
      this.onChanged();
    });
    ch.subscribe((s, err) => {
      if (this.channel !== ch) return;
      if (s === 'SUBSCRIBED') {
        this.retries = 0;
        this.set('connected');
        this.lastError = null;
        this.onChanged(); /* 구독 전후 틈 메우기 */
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        this.lastError = err?.message ?? s;
        this.set('reconnecting');
        this.scheduleRetry();
      }
    });
    this.channel = ch;
  }

  /** backoff+jitter 재접속 (2s→5s→15s→60s). 주기 alarm 의 ensureRealtime 도 보조 경로. */
  private scheduleRetry() {
    if (this.retryTimer || !this.client) return;
    const base = [2, 5, 15, 60][Math.min(this.retries, 3)]! * 1000;
    const delay = base * (1 + (Math.random() - 0.5) * 0.4);
    this.retries++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      const client = this.client;
      if (!client || this.status === 'off') return;
      const ws = this.topic.replace('workspace:', '');
      this.channel = null;
      void client
        .removeAllChannels()
        .catch(() => undefined)
        .then(() => this.connect(client, ws, this.token));
    }, delay);
  }

  private async teardown() {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (this.client) {
      try {
        await this.client.removeAllChannels();
      } catch {
        /* ignore */
      }
    }
    this.channel = null;
  }

  async setAuth(token: string): Promise<void> {
    await this.client?.realtime.setAuth(token);
  }

  async disconnect(): Promise<void> {
    await this.teardown();
    this.client?.realtime.disconnect();
    this.client = null;
    this.retries = 0;
    this.set('off');
  }

  private set(s: RealtimeLink['status']) {
    if (this.status !== s) {
      this.status = s;
      this.onStatus(s);
    }
  }
}
