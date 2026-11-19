const CONSENT_CLASS: Record<string, string> = {
  consented: 'good',
  pending: 'warn',
  declined: 'bad',
  opted_out: 'bad',
};

export function ConsentBadge({ consent }: { consent: string }) {
  return <span className={`badge ${CONSENT_CLASS[consent] ?? ''}`}>{consent.replace('_', ' ')}</span>;
}

export function PersonFlags({ paused, blocked, deleted }: { paused: boolean; blocked: boolean; deleted: boolean }) {
  return (
    <>
      {blocked && <span className="badge bad">blocked</span>}{' '}
      {paused && <span className="badge warn">paused</span>}{' '}
      {deleted && <span className="badge">deleted</span>}
    </>
  );
}

const CALL_CLASS: Record<string, string> = {
  completed: 'good',
  answered: 'good',
  no_answer: 'warn',
  busy: 'warn',
  failed: 'bad',
};

export function CallStatusBadge({ status }: { status: string }) {
  return <span className={`badge ${CALL_CLASS[status] ?? ''}`}>{status.replace('_', ' ')}</span>;
}
