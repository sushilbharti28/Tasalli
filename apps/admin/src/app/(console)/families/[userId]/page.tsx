import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { getFamily } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { ConsentBadge, PersonFlags } from '@/components/Badges';
import { Flash } from '@/components/Flash';
import { NoteForm, NotesList } from '@/components/Notes';

export default async function FamilyPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireSession();
  const { userId } = await params;
  const flash = await searchParams;
  const family = await getFamily(userId);
  if (!family) notFound();

  return (
    <>
      <p className="muted"><Link href="/">Families</Link> /</p>
      <h1>{family.name || 'Unnamed account'} {family.deleted && <span className="badge">deleted</span>}</h1>
      <p className="sub mono">{family.phoneMasked}</p>
      <Flash {...flash} />

      <div className="grid">
        <section className="card">
          <h2>Account</h2>
          <dl className="kv">
            <dt>Account id</dt><dd className="mono">{family.userId}</dd>
            <dt>Time zone</dt><dd>{family.timeZone}</dd>
            <dt>App language</dt><dd>{family.locale}</dd>
            <dt>Signed up</dt><dd>{fmtDateTime(family.createdAt)} IST</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Subscription</h2>
          {family.subscriptions.length === 0 ? (
            <p className="muted">No subscription.</p>
          ) : (
            <table>
              <thead><tr><th>Plan</th><th>Status</th><th>Trial ends / period end</th></tr></thead>
              <tbody>
                {family.subscriptions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.plan}</td>
                    <td>{s.status}</td>
                    <td>{fmtDateTime(s.plan === 'trial' ? s.trialEndsAt : s.currentPeriodEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <h2>People ({family.people.filter((p) => !p.deleted).length} of 4)</h2>
        {family.people.length === 0 ? (
          <p className="muted">No people added yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Nickname</th><th>Phone</th><th>Language</th><th>Consent</th><th>State</th></tr>
            </thead>
            <tbody>
              {family.people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/people/${p.id}`}>{p.nickname}</Link>
                    {p.isSelf && <span className="muted"> (self)</span>}
                    {p.fullName && <div className="muted">{p.fullName}</div>}
                  </td>
                  <td className="mono">{p.phoneMasked}</td>
                  <td>{p.language}</td>
                  <td><ConsentBadge consent={p.consent} /></td>
                  <td><PersonFlags paused={p.paused} blocked={p.blocked} deleted={p.deleted} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Support notes</h2>
        <NoteForm userId={family.userId} />
        <NotesList notes={family.notes} />
      </section>
    </>
  );
}
