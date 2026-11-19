import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, getSessionSecret, verifySession } from './lib/session';

export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, getSessionSecret());
  if (session) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page and static assets requires a session.
  matcher: ['/((?!login|_next/static|_next/image|favicon.ico).*)'],
};
