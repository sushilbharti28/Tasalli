import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { logout } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">Tasalli Admin</Link>
        <nav>
          <Link href="/">Families</Link>
          <Link href="/blocked">Block list</Link>
          <Link href="/metrics">Pilot metrics</Link>
        </nav>
        <form action={logout} className="row">
          <span className="muted hide-sm">{session.email}</span>
          <button type="submit" className="link">Sign out</button>
        </form>
      </header>
      <main>{children}</main>
    </>
  );
}
