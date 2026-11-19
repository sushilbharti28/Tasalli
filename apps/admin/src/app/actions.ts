'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { checkCredentials, clearFailures, isLockedOut, recordFailure } from '@/lib/password';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, getSessionSecret, signSession } from '@/lib/session';
import { addSupportNote, blockNumber, blockPersonNumber, setPersonPaused, unblockNumber, type WriteResult } from '@/lib/writes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
}

function back(path: string, result: WriteResult, okMessage: string): never {
  revalidatePath(path);
  const q = result.ok ? `notice=${encodeURIComponent(okMessage)}` : `error=${encodeURIComponent(result.error)}`;
  redirect(`${path}?${q}`);
}

// ---------------------------------------------------------------------------
// Login / logout

export async function login(form: FormData): Promise<void> {
  const secret = getSessionSecret();
  if (!secret) redirect('/login?error=' + encodeURIComponent('ADMIN_SESSION_SECRET is not set (32+ characters).'));

  const h = await headers();
  const key = (h.get('x-forwarded-for')?.split(',')[0] ?? 'local').trim();
  if (isLockedOut(key)) redirect('/login?error=' + encodeURIComponent('Too many attempts. Try again in 15 minutes.'));

  const email = str(form, 'email');
  if (!checkCredentials(email, str(form, 'password'))) {
    recordFailure(key);
    redirect('/login?error=' + encodeURIComponent('Wrong email or password.'));
  }
  clearFailures(key);

  const token = await signSession(
    { email: email.trim().toLowerCase(), exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS },
    secret,
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect('/');
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}

// ---------------------------------------------------------------------------
// Writes. Each one checks the session again, then calls src/lib/writes.ts.

export async function blockNumberAction(form: FormData): Promise<void> {
  const s = await requireSession();
  back('/blocked', await blockNumber(str(form, 'phone'), { email: s.email }), 'Number blocked for every account.');
}

export async function unblockNumberAction(form: FormData): Promise<void> {
  const s = await requireSession();
  back('/blocked', await unblockNumber(str(form, 'phoneRef'), { email: s.email }), 'Block lifted. The person still needs a new consent call.');
}

export async function blockPersonAction(form: FormData): Promise<void> {
  const s = await requireSession();
  const personId = str(form, 'personId');
  if (!UUID_RE.test(personId)) redirect('/');
  back(`/people/${personId}`, await blockPersonNumber(personId, { email: s.email }), 'Number blocked for every account.');
}

export async function setPausedAction(form: FormData): Promise<void> {
  const s = await requireSession();
  const personId = str(form, 'personId');
  if (!UUID_RE.test(personId)) redirect('/');
  const paused = str(form, 'paused') === 'true';
  back(
    `/people/${personId}`,
    await setPersonPaused(personId, paused, { email: s.email }),
    paused ? 'Calls paused.' : 'Calls resumed.',
  );
}

export async function addNoteAction(form: FormData): Promise<void> {
  const s = await requireSession();
  const userId = str(form, 'userId');
  if (!UUID_RE.test(userId)) redirect('/');
  const personId = str(form, 'personId') || null;
  const returnTo = personId && UUID_RE.test(personId) ? `/people/${personId}` : `/families/${userId}`;
  back(returnTo, await addSupportNote(userId, str(form, 'text'), { email: s.email }, { personId }), 'Note saved.');
}
