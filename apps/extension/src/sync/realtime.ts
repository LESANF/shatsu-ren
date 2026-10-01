import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/** 프로필당 socket 하나, workspace private channel 하나. 팝업/설정은 연결을 만들지 않는다. */
export class RealtimeLink {
  private channel: RealtimeChannel | null = null;
  private client: SupabaseClient | null = null;
  private topic = '';
  status: 'off' | 'connecting' | 'connected' | 'reconnecting' = 'off';
  health(): {
    status: string;
    socket: boolean;
    channel: string | null;
    lastMessageAt: number;
    lastError: string | null;
  } {
    return {
      status: this.status,
      socket: this.client?.realtime.isConnected() ?? false,
      channel: this.channel?.state ?? null,
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
    };
  }
  lastMessageAt = 0;
  lastError: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private token = '';
  private connection: Promise<void> = Promise.resolve();
  constructor(
    private onChanged: () => void,
    private onStatus: (s: RealtimeLink['status']) => void,
  ) {}

  connect(client: SupabaseClient, workspaceId: string, token: string): Promise<void> {
    const task = this.connection
      .catch(() => undefined)
      .then(() => this.connectNow(client, workspaceId, token));
    this.connection = task;
    return task;
  }

  private async connectNow(
    client: SupabaseClient,
    workspaceId: string,
    token: string,
  ): Promise<void> {
    const topic = `workspace:${workspaceId}`;
    this.token = token;
    if (this.channel && this.client === client && this.topic === topic) {
      await client.realtime.setAuth(token);
      // 채널 state 만 믿지 않는다: 소켓이 조용히 끊기면 state 가 'joined' 로 남을 수 있다 (P02 실측)
      const socketOk = client.realtime.isConnected();
      if (socketOk && (this.channel.state === 'joined' || this.channel.state === 'joining')) return;
      this.lastError = socketOk ? `channel ${this.channel.state}` : 'socket disconnected';
      // 끊긴 채널/소켓은 다시 만든다
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
      void this.connect(client, ws, this.token);
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

  disconnect(): Promise<void> {
    const task = this.connection.catch(() => undefined).then(() => this.disconnectNow());
    this.connection = task;
    return task;
  }

  private async disconnectNow(): Promise<void> {
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
