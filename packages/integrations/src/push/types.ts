export interface PushMessage {
  /** FCM registration token of one device. */
  token: string;
  title: string;
  body: string;
  /** String values only (FCM requirement). Used by the app for deep links. */
  data?: Record<string, string>;
  /** Android notification channel, created by the app. */
  androidChannelId?: string;
  /** Newer messages with the same tag replace older ones in the tray. */
  tag?: string;
}

export type PushResult =
  | { ok: true; messageId: string }
  /** The token is dead (app uninstalled, token rotated). Remove it; do not retry. */
  | { ok: false; reason: 'invalid_token'; detail: string }
  /** Temporary failure (quota, 5xx, network). Retry later. */
  | { ok: false; reason: 'retryable'; detail: string }
  /** Our request was wrong or not authorised. Retrying will not help. */
  | { ok: false; reason: 'error'; detail: string };

export interface PushSender {
  readonly name: string;
  send(msg: PushMessage): Promise<PushResult>;
}
