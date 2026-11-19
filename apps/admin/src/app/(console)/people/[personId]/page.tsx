import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { getFamily, getPerson } from '@/lib/queries';
import { fmtDateTime, fmtDuration } from '@/lib/format';
import { CallStatusBadge, ConsentBadge, PersonFlags } from '@/components/Badges';
import { Flash } from '@/components/Flash';
import { NoteForm, NotesList } from '@/components/Notes';
import { blockPersonAction, setPausedAction } from '@/app/actions';

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireSession();
  const { personId } = await params;
  const flash = await searchParams;
  const person = await getPerson(personId);
  if (!person) notFound();
  const family = await getFamily(person.owner.userId);
  const tz = person.timeZone;
  const s = person.doseStats14d;

  return (
    <>
      <p className="muted">
        <Link href="/">Families</Link> / <Link href={`/families/${person.owner.userId}`}>{person.owner.name || 'Unnamed account'}</Link> /
      </p>
      <h1>
        {person.nickname} <ConsentBadge consent={person.consent} />{' '}
        <PersonFlags paused={person.paused} blocked={person.blocked} deleted={person.deleted} />
      </h1>
      <p className="sub">
        <span className="mono">{person.phoneMasked}</span> · times shown in {tz}
      </p>
      <Flash {...flash} />

      <div className="grid">
        <section className="card">
          <h2>Person</h2>
          <dl className="kv">
            <dt>Full name</dt><dd>{person.fullName || <span className="muted">not given</span>}</dd>
            <dt>Call language</dt><dd>{person.language}</dd>
            <dt>Time zone</dt><dd>{tz}</dd>
            <dt>Reads strip names</dt><dd>{person.canReadStrip.replace('_', ' ')}</dd>
            <dt>Self</dt><dd>{person.isSelf ? 'yes' : 'no'}</dd>
            <dt>Consent at</dt><dd>{fmtDateTime(person.consentAt, tz) || <span className="muted">never</span>}</dd>
            <dt>Active medicines</dt><dd>{person.activeMedicines}</dd>
            <dt>Person id</dt><dd className="mono">{person.id}</dd>
          </dl>
        </section>

        <section className="card">
          <h2>Last 14 days</h2>
          <dl className="kv">
            <dt>Confirmed by parent</dt><dd>{s.confirmedByParent}</dd>
            <dt>Marked taken by family</dt><dd>{s.confirmedManual}</dd>
            <dt>Missed</dt><dd>{s.missed}</dd>
            <dt>Skipped (paused)</dt><dd>{s.skippedPaused}</dd>
            <dt>Upcoming</dt><dd>{s.upcoming}</dd>
          </dl>
        </section>

        <section className="card">
          <h2>Actions</h2>
          {!person.deleted && (
            <form action={setPausedAction} className="row" style={{ marginBottom: 12 }}>
              <input type="hidden" name="personId" value={person.id} />
              <input type="hidden" name="paused" value={person.paused ? 'false' : 'true'} />
              <button type="submit" className="secondary">{person.paused ? 'Resume calls' : 'Pause calls'}</button>
              <span className="muted">{person.paused ? 'No reminder calls while paused.' : 'Stops reminder calls until resumed.'}</span>
            </form>
          )}
          {person.blocked ? (
            <p>
              Number blocked ({person.blockReason}) on {fmtDateTime(person.blockedAt, tz)}. Manage on the{' '}
              <Link href="/blocked">block list</Link>.
            </p>
          ) : (
            <form action={blockPersonAction} className="row">
              <input type="hidden" name="personId" value={person.id} />
              <button type="submit" className="danger">Block this number</button>
              <span className="muted">Blocks calls to this number from every account.</span>
            </form>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Consent events</h2>
        {person.consentEvents.length === 0 ? (
          <p className="muted">No consent events.</p>
        ) : (
          <table>
            <thead><tr><th>When</th><th>Result</th><th>Via</th><th className="hide-sm">Call</th></tr></thead>
            <tbody>
              {person.consentEvents.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDateTime(e.createdAt, tz)}</td>
                  <td><ConsentBadge consent={e.result} /></td>
                  <td>{e.via.replace('_', ' ')}</td>
                  <td className="mono hide-sm">{e.callId ? e.callId.slice(0, 8) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Calls ({person.calls.length})</h2>
        {person.calls.length === 0 ? (
          <p className="muted">No calls yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th><th>Purpose</th><th className="num">Try</th><th>Status</th><th>Result</th>
                <th>Input</th><th className="num hide-sm">Length</th><th>Recording</th>
              </tr>
            </thead>
            <tbody>
              {person.calls.map((c) => (
                <tr key={c.id}>
                  <td>{fmtDateTime(c.startedAt ?? c.createdAt, tz)}</td>
                  <td>{c.purpose}</td>
                  <td className="num">{c.attempt}</td>
                  <td><CallStatusBadge status={c.status} /></td>
                  <td>{c.result ?? ''}</td>
                  <td>{c.inputKind ? `${c.inputKind}: ${c.inputValue ?? ''}` : ''}</td>
                  <td className="num hide-sm">{fmtDuration(c.startedAt, c.endedAt)}</td>
                  <td>
                    {c.recordingUrl ? (
                      <audio controls preload="none" src={c.recordingUrl}>
                        <a href={c.recordingUrl} rel="noreferrer">recording</a>
                      </audio>
                    ) : c.hasRecording ? (
                      <span className="muted">{person.consent === 'consented' && !person.deleted ? 'link not playable' : 'withheld (no consent)'}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {family && (
        <section className="card">
          <h2>Support notes</h2>
          <NoteForm userId={family.userId} personId={person.id} />
          <NotesList notes={family.notes} personId={person.id} />
        </section>
      )}
    </>
  );
}
