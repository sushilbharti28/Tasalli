import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { searchFamilies } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';

export default async function FamiliesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireSession();
  const { q = '' } = await searchParams;
  const families = await searchFamilies(q);
  return (
    <>
      <h1>Families</h1>
      <p className="sub">Search by name, nickname, 4 or more digits of any number on the account, or an id.</p>
      <form className="row card" role="search">
        <input type="search" name="q" defaultValue={q} placeholder="Papa, Sharma, 3210, or an id" style={{ flex: 1 }} aria-label="Search families" />
        <button type="submit">Search</button>
      </form>
      <div className="card">
        {families.length === 0 ? (
          <p className="muted">{q ? 'No families match.' : 'No families yet.'}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Phone</th>
                <th className="num">People</th>
                <th>Plan</th>
                <th className="hide-sm">Signed up (IST)</th>
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.userId}>
                  <td>
                    <Link href={`/families/${f.userId}`}>{f.name || 'Unnamed'}</Link>{' '}
                    {f.deleted && <span className="badge">deleted</span>}
                  </td>
                  <td className="mono">{f.phoneMasked}</td>
                  <td className="num">{f.peopleCount}</td>
                  <td>{f.plan ? `${f.plan} (${f.subscriptionStatus})` : <span className="muted">none</span>}</td>
                  <td className="hide-sm">{fmtDateTime(f.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
