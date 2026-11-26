import { requireSession } from '@/lib/auth';
import { getPilotMetrics, TARGETS, type Ratio } from '@/lib/metrics';
import { getOpsMetrics, OPS_THRESHOLDS } from '@/lib/ops-metrics';
import { fmtDateTime, fmtPercent } from '@/lib/format';
import { RateBarChart, RateLineChart } from '@/components/Charts';

const WINDOWS = [7, 30, 90];

function Stat({
  label,
  value,
  detail,
  definition,
  target,
  lowerIsBetter = false,
  rate,
}: {
  label: string;
  value: string;
  detail: string;
  definition: string;
  target?: number;
  lowerIsBetter?: boolean;
  rate?: number | null;
}) {
  let status: React.ReactNode = null;
  if (target !== undefined) {
    if (rate === null || rate === undefined) status = <span className="badge">no data yet</span>;
    else {
      const ok = lowerIsBetter ? rate < target : rate >= target;
      status = (
        <span className={`badge ${ok ? 'good' : 'bad'}`}>
          {ok ? 'On target' : 'Below target'} ({lowerIsBetter ? 'under' : 'at least'} {fmtPercent(target, 0)})
        </span>
      );
    }
  }
  return (
    <section className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="muted">{detail}</div>
      {status && <div className="status">{status}</div>}
      <div className="def">{definition}</div>
    </section>
  );
}

const of = (r: Ratio) => `${r.numerator} of ${r.denominator}`;

/** A call-operations number with its scaling trigger and the mitigation planned for it (docs/architecture.md). */
function OpsStat({ label, value, detail, ok, trigger, action }: {
  label: string; value: string; detail: string; ok: boolean | null; trigger: string; action: string;
}) {
  return (
    <section className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="muted">{detail}</div>
      <div className="status">
        {ok === null ? <span className="badge">no data yet</span>
          : <span className={`badge ${ok ? 'good' : 'bad'}`}>{ok ? 'OK' : 'Act'} · trigger: {trigger}</span>}
      </div>
      <div className="def">If triggered: {action}</div>
    </section>
  );
}

export default async function MetricsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireSession();
  const { days: daysParam } = await searchParams;
  const days = WINDOWS.includes(Number(daysParam)) ? Number(daysParam) : 30;
  const [m, ops] = await Promise.all([getPilotMetrics({ days }), getOpsMetrics({ days })]);

  return (
    <>
      <h1>Pilot metrics</h1>
      <p className="sub">Measured against the pilot success criteria. As of {fmtDateTime(m.now)} IST.</p>
      <form className="row card" aria-label="Time range">
        <span className="muted">Window for doses and calls:</span>
        {WINDOWS.map((w) => (
          <button key={w} type="submit" name="days" value={w} className={w === days ? '' : 'secondary'} aria-pressed={w === days}>
            {w} days
          </button>
        ))}
      </form>

      <div className="grid">
        <Stat
          label="Families who finished setup"
          value={fmtPercent(m.setupCompletion.rate)}
          detail={of(m.setupCompletion)}
          rate={m.setupCompletion.rate}
          target={TARGETS.setupCompletion}
          definition="All time. Done = at least one consented person with an active medicine and a schedule."
        />
        <Stat
          label="Doses confirmed by the parent"
          value={fmtPercent(m.confirmation.rate)}
          detail={`${of(m.confirmation)} · ${m.confirmation.manual} marked by family · ${m.confirmation.missed} missed`}
          rate={m.confirmation.rate}
          target={TARGETS.confirmation}
          definition={`Last ${days} days. Key or speech confirmations over doses that ended confirmed or missed. Family "mark as taken" does not count.`}
        />
        <Stat
          label="Trial users who pay"
          value={fmtPercent(m.trialToPaid.rate)}
          detail={of(m.trialToPaid)}
          rate={m.trialToPaid.rate}
          target={TARGETS.trialToPaid}
          definition="All time. Of accounts whose trial has ended, those with any paid plan."
        />
        <Stat
          label="Still paying in month 3"
          value={fmtPercent(m.month3Retention.rate)}
          detail={of(m.month3Retention)}
          rate={m.month3Retention.rate}
          target={TARGETS.month3Retention}
          definition="Families whose first payment was 2+ months ago and who are still paying 2 months after it."
        />
        <Stat
          label="Calls that failed (technical)"
          value={fmtPercent(m.failedCalls.rate, 2)}
          detail={of(m.failedCalls)}
          rate={m.failedCalls.rate}
          target={TARGETS.failedCalls}
          lowerIsBetter
          definition={`Last ${days} days. Status "failed" over calls with an outcome. No answer and busy are not failures.`}
        />
        <Stat
          label="Calls per dose"
          value={m.callsPerDose.value === null ? '–' : m.callsPerDose.value.toFixed(2)}
          detail={`${m.callsPerDose.calls} reminder calls · ${m.callsPerDose.doses} doses`}
          definition={`Last ${days} days. Reminder call attempts (incl. retries) over doses that ended confirmed or missed. Below 1 when doses are grouped.`}
        />
      </div>

      <h2>Call operations: scaling triggers</h2>
      <p className="sub">Last {days} days unless marked. Each number has a trigger; crossing it means the planned mitigation is due (docs/architecture.md, section 3).</p>
      <div className="grid">
        <OpsStat
          label="Dial lag (dose time to first dial)"
          value={ops.dialLagMinutes.p95 === null ? '–' : `${ops.dialLagMinutes.p95} min`}
          detail={`95th percentile · median ${ops.dialLagMinutes.p50 ?? '–'} min · ${ops.dialLagMinutes.calls} first calls`}
          ok={ops.dialLagMinutes.p95 === null ? null : ops.dialLagMinutes.p95 <= OPS_THRESHOLDS.dialLagP95Minutes}
          trigger={`over ${OPS_THRESHOLDS.dialLagP95Minutes} min`}
          action="raise the provider plan's calls per second / channels (MAX_CALLS_PER_SECOND, MAX_CONCURRENT_CALLS); spread dials."
        />
        <OpsStat
          label="Busiest 5 minutes"
          value={String(ops.busiestFiveMinutes)}
          detail="Most reminder calls started in any 5-minute window"
          ok={null}
          trigger="above 70% of MAX_CONCURRENT_CALLS"
          action="upgrade the channel plan before peaks reach the limit."
        />
        <OpsStat
          label="Doses unanswered after all retries"
          value={fmtPercent(ops.unansweredAfterRetries.rate)}
          detail={`${ops.unansweredAfterRetries.missed} of ${ops.unansweredAfterRetries.ended} ended doses`}
          ok={ops.unansweredAfterRetries.rate === null ? null : ops.unansweredAfterRetries.rate <= OPS_THRESHOLDS.unansweredRate}
          trigger={`over ${fmtPercent(OPS_THRESHOLDS.unansweredRate, 0)}`}
          action="listen to recordings, review wording and call times with the family; check speech recognition."
        />
        <OpsStat
          label="Doses missed without a call"
          value={String(ops.missedWithoutCall)}
          detail="Engine down at the dose time, or retries cut by the daily cap"
          ok={ops.missedWithoutCall <= OPS_THRESHOLDS.missedWithoutCall}
          trigger="any"
          action="check uptime (engine heartbeat) and the cap: see numbers at the daily cap."
        />
        <OpsStat
          label="Numbers at the daily cap"
          value={String(ops.numbersAtDailyCap)}
          detail="Phone numbers with 6 calls on an IST day"
          ok={ops.numbersAtDailyCap <= OPS_THRESHOLDS.numbersAtDailyCap}
          trigger="any"
          action="review that family's dose times and retry policy (first calls are protected; retries are cut first)."
        />
        <OpsStat
          label="Calls stuck without a final status (now)"
          value={String(ops.stuckCallsNow)}
          detail="Open 15+ minutes after dialling"
          ok={ops.stuckCallsNow <= OPS_THRESHOLDS.stuckCallsNow}
          trigger="any"
          action="the 5-minute sweeper should clear these; if not, check the call engine and provider webhooks."
        />
        <OpsStat
          label="Calls per parent per day"
          value={ops.callsPerParentPerDay === null ? '–' : ops.callsPerParentPerDay.toFixed(2)}
          detail="Reminder calls (incl. retries) per parent with doses"
          ok={null}
          trigger="trend: drives cost per parent"
          action="compare with the plan price; fewer retries or better recognition lower it."
        />
      </div>

      <section className="card">
        <h2>Parent confirmation rate per day (IST)</h2>
        <RateLineChart
          title="Parent confirmation rate per day"
          target={TARGETS.confirmation}
          points={m.confirmationDaily.map((p) => ({ label: p.day, value: p.rate, detail: `${p.numerator} of ${p.denominator}` }))}
        />
      </section>

      <section className="card">
        <h2>Failed call rate per day (IST)</h2>
        <RateLineChart
          title="Failed call rate per day"
          target={TARGETS.failedCalls}
          points={m.failedCallsDaily.map((p) => ({ label: p.day, value: p.rate, detail: `${p.numerator} of ${p.denominator}` }))}
        />
      </section>

      <section className="card">
        <h2>Month-over-month retention of paying families</h2>
        <p className="muted" style={{ marginTop: 0 }}>Share of families paying at the end of the previous month who still pay at the end of this month (current month: as of now).</p>
        <RateBarChart
          title="Month-over-month retention"
          points={m.retentionMonthly.map((p) => ({
            label: p.month,
            value: p.rate,
            detail: `${p.retainedFromPrevious} of ${p.previousPaying} (${p.paying} paying)`,
          }))}
        />
      </section>
    </>
  );
}
