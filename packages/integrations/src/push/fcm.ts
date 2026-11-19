import { createSign } from 'node:crypto';
import { optionalEnv, requireEnv, type Env } from '../util/env';
import type { PushMessage, PushResult, PushSender } from './types';

/**
 * Firebase Cloud Messaging HTTP v1 (free).
 * POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send
 * Authorised with a short-lived OAuth 2.0 token for scope
 * https://www.googleapis.com/auth/firebase.messaging, minted from a service account
 * (signed JWT exchanged at https://oauth2.googleapis.com/token).
 */
export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string; // PEM
  tokenUri?: string;
}

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ status: number; json(): Promise<unknown> }>;

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/**
 * Reads either FIREBASE_SERVICE_ACCOUNT_JSON (the whole key file as JSON), or the three
 * variables FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * (newlines may be written as \n).
 */
export function fcmConfigFromEnv(env: Env): FcmConfig {
  const json = optionalEnv(env, 'FIREBASE_SERVICE_ACCOUNT_JSON');
  if (json) {
    const sa = JSON.parse(json) as { project_id?: string; client_email?: string; private_key?: string; token_uri?: string };
    if (!sa.project_id || !sa.client_email || !sa.private_key) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email or private_key');
    }
    return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key, tokenUri: sa.token_uri };
  }
  return {
    projectId: requireEnv(env, 'FIREBASE_PROJECT_ID'),
    clientEmail: requireEnv(env, 'FIREBASE_CLIENT_EMAIL'),
    privateKey: requireEnv(env, 'FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
  };
}

export class FcmPushSender implements PushSender {
  readonly name = 'fcm';
  private accessToken?: { value: string; expiresAt: number };

  constructor(
    private readonly config: FcmConfig,
    private readonly fetchFn: FetchFn = globalThis.fetch as unknown as FetchFn,
    private readonly now: () => number = Date.now,
  ) {}

  async send(msg: PushMessage): Promise<PushResult> {
    const body = JSON.stringify({ message: buildFcmMessage(msg) });
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/messages:send`;

    for (let attempt = 0; attempt < 2; attempt++) {
      let token: string;
      let res: { status: number; json(): Promise<unknown> };
      try {
        token = await this.getAccessToken(attempt > 0);
        res = await this.fetchFn(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
          body,
        });
      } catch (err) {
        return { ok: false, reason: 'retryable', detail: `network: ${(err as Error).message}` };
      }
      const json = (await res.json().catch(() => ({}))) as FcmResponse;
      if (res.status >= 200 && res.status < 300 && json.name) return { ok: true, messageId: json.name };
      if (res.status === 401 && attempt === 0) {
        this.accessToken = undefined; // token revoked or expired early: mint a new one once
        continue;
      }
      return classifyFcmError(res.status, json);
    }
    return { ok: false, reason: 'error', detail: 'unauthorised after token refresh' };
  }

  private async getAccessToken(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh && this.accessToken && this.accessToken.expiresAt - 60_000 > this.now()) {
      return this.accessToken.value;
    }
    const iat = Math.floor(this.now() / 1000);
    const tokenUri = this.config.tokenUri ?? DEFAULT_TOKEN_URI;
    const assertion = signJwt(
      { iss: this.config.clientEmail, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 },
      this.config.privateKey,
    );
    const res = await this.fetchFn(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (res.status !== 200 || !json.access_token) {
      throw new Error(`OAuth token exchange failed (${res.status} ${json.error ?? ''})`.trim());
    }
    this.accessToken = { value: json.access_token, expiresAt: this.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }
}

interface FcmResponse {
  name?: string;
  error?: { code?: number; status?: string; message?: string; details?: Array<{ '@type'?: string; errorCode?: string }> };
}

export function buildFcmMessage(msg: PushMessage): Record<string, unknown> {
  return {
    token: msg.token,
    notification: { title: msg.title, body: msg.body },
    ...(msg.data ? { data: msg.data } : {}),
    android: {
      priority: 'HIGH',
      notification: {
        ...(msg.androidChannelId ? { channel_id: msg.androidChannelId } : {}),
        ...(msg.tag ? { tag: msg.tag } : {}),
      },
    },
  };
}

/** Maps FCM v1 errors (https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode). */
export function classifyFcmError(httpStatus: number, json: FcmResponse): PushResult {
  const fcmCode = json.error?.details?.find((d) => d.errorCode)?.errorCode;
  const status = json.error?.status;
  const detail = `${httpStatus} ${fcmCode ?? status ?? 'unknown'}`;
  if (fcmCode === 'UNREGISTERED' || fcmCode === 'SENDER_ID_MISMATCH') {
    return { ok: false, reason: 'invalid_token', detail };
  }
  if (fcmCode === 'INVALID_ARGUMENT' || status === 'INVALID_ARGUMENT') {
    // FCM uses INVALID_ARGUMENT both for a malformed token and for a malformed message.
    const aboutToken = /registration token/i.test(json.error?.message ?? '');
    return { ok: false, reason: aboutToken ? 'invalid_token' : 'error', detail };
  }
  if (httpStatus === 429 || httpStatus >= 500 || fcmCode === 'QUOTA_EXCEEDED' || fcmCode === 'UNAVAILABLE' || fcmCode === 'INTERNAL') {
    return { ok: false, reason: 'retryable', detail };
  }
  return { ok: false, reason: 'error', detail };
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function signJwt(claims: Record<string, unknown>, privateKeyPem: string): string {
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem);
  return `${unsigned}.${b64url(sig)}`;
}
