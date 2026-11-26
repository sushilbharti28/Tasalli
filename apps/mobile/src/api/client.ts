/**
 * Typed API client generated from packages/contracts/openapi.yaml (see `pnpm gen:api`).
 * In mock mode the client's fetch is the in-app mock server, so screens use the same calls.
 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';
import { mockFetch } from './mock/server';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
export const isMockApi = process.env.EXPO_PUBLIC_API_MOCK === '1' || !API_URL;
const baseUrl = isMockApi ? 'https://mock.tasalli.local' : API_URL;

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

/** Path of a URL without `new URL()` (React Native's URL does not implement `pathname`). */
export const pathOf = (url: string) => url.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0] || '/';

export const auth: Middleware = {
  onRequest({ request }) {
    if (authToken) request.headers.set('Authorization', `Bearer ${authToken}`);
    return request;
  },
  // Returns nothing: the response is only inspected. openapi-fetch treats a returned value as a replacement and, on a
  // device, refuses the fetch() response object itself ("must return new Response()"), which broke every real API call.
  onResponse({ response, request }) {
    if (response.status === 401 && !pathOf(request.url).startsWith('/auth/')) onUnauthorized?.();
  },
};

const fetchImpl = (req: Request) => (isMockApi ? mockFetch(req) : globalThis.fetch(req));

export const api = createClient<paths>({ baseUrl, fetch: fetchImpl });
api.use(auth);

export class ApiError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
  }
}

/** Throw on non-2xx so screens can use try/catch; returns `data`. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, response } = await p;
  if (!response.ok) throw new ApiError(response.status);
  return data as T;
}

/**
 * PENDING CONTRACT: endpoints the design needs that are not in openapi.yaml yet.
 * Requested in the PR description. Until approved they work only against the mock;
 * against the real API they report `unsupported` and the UI hides or explains the action.
 */
export const pendingApi = {
  async remindAgain(doseId: string): Promise<'queued' | 'unsupported'> {
    const headers = new Headers();
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
    const res = await fetchImpl(new Request(`${baseUrl}/doses/${encodeURIComponent(doseId)}/remind`, { method: 'POST', headers }));
    if (res.status === 404 || res.status === 405) return 'unsupported';
    if (!res.ok) throw new ApiError(res.status);
    return 'queued';
  },
};
