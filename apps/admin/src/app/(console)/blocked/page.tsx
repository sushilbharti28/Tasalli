import { requireSession } from '@/lib/auth';
import { listBlocked } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Flash } from '@/components/Flash';
import { blockNumberAction, unblockNumberAction } from '@/app/actions';

const REASON_LABEL: Record<string, string> = {
  key_9: 'Pressed 9',
  stop_phrase: 'Said stop',
  declined: 'Declined consent',
  admin: 'Blocked by admin',
};

export default async function BlockedPage({
  searchParams,
}: {
  searchParams: Promise<{ last4?: string; notice?: string; error?: string }>;
}) {
  await requireSession();
  const { last4 = '', notice, error } = await searchParams;
  const rows = await listBlocked({ last4 });

  return (
    <>
      <h1>Block list</h1>
      <p className="sub">Blocked numbers get no calls from any account. Blocks set by the parent (key 9, stop phrase, declined) can only be lifted by the parent consenting again, never from here.</p>
      <Flash notice={notice} error={error} />

      <div className="grid">
        <form action={blockNumberAction} className="card" style={{ display: 'grid', gap: 8 }}>
          <h2>Block a number</h2>
          <label htmlFor="phone" className="muted">Full number in international format</label>
          <input id="phone" type="text" name="phone" placeholder="+91 followed by 10 digits" inputMode="tel" autoComplete="off" required />
          <div><button type="submit" className="danger">Block for every account</button></div>
        </form>
        <form className="card" style={{ display: 'grid', gap: 8 }} role="search">
          <h2>Find</h2>
          <label htmlFor="last4" className="muted">Last digits</label>
          <input id="last4" type="search" name="last4" defaultValue={last4} placeholder="3210" inputMode="numeric" />
          <div><button type="submit" className="secondary">Filter</button></div>
        </form>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">No blocked numbers{last4 ? ' match' : ''}.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Number</th><th>Reason</th><th>Blocked (IST)</th><th className="num">People</th><th className="num">Accounts</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.phoneRef}>
                  <td className="mono">{r.phoneMasked}</td>
                  <td>{REASON_LABEL[r.reason] ?? r.reason}</td>
                  <td>{fmtDateTime(r.blockedAt)}</td>
                  <td className="num">{r.peopleCount}</td>
                  <td className="num">{r.accountCount}</td>
                  <td>
                    {r.canUnblock ? (
                      <form action={unblockNumberAction}>
                        <input type="hidden" name="phoneRef" value={r.phoneRef} />
                        <button type="submit" className="secondary">Unblock</button>
                      </form>
                    ) : (
                      <span className="muted">parent's choice</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
