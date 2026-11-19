import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, getSessionSecret, verifySession, type Session } from './session';

/** Call at the top of every page and server action. Middleware also checks, this is the second lock. */
export async function requireSession(): Promise<Session> {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value, getSessionSecret());
  if (!session) redirect('/login');
  return session;
}
