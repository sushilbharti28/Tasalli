import { Client } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetPools } from '@/lib/db';
import { listBlocked, listSupportNotes, phoneRef } from '@/lib/queries';
import { addSupportNote, blockNumber, blockPersonNumber, NOTE_MAX_LENGTH, setPersonPaused, unblockNumber } from '@/lib/writes';
import { ID, PHONES } from './fixtures';
import { reseed, testDbUrl } from './db-helpers';

const actor = { email: 'founder@example.com' };

async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: testDbUrl() });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

beforeEach(reseed);
afterAll(resetPools);

describe('blockNumber', () => {
  it('rejects numbers that are not E.164', async () => {
    expect(await blockNumber('98765 43210', actor)).toMatchObject({ ok: false });
    expect(await blockNumber("+91'; drop table users;--", actor)).toMatchObject({ ok: false });
  });

  it('blocks a new number for every account and audits it with a masked number', async () => {
    expect(await blockNumber('+91 98111 22222', actor)).toEqual({ ok: true });
    const [row] = await sql(`select reason from blocked_numbers where phone_e164 = $1`, [PHONES.p4]);
    expect(row.reason).toBe('admin');
    const audits = await sql(`select actor_kind, entity, action, after from audit_log where entity = 'blocked_number'`);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_kind: 'admin', action: 'blocked' });
    expect(audits[0].after).toEqual({ phone: '+xxxxxxxx2222', reason: 'admin', by: actor.email });
    expect(JSON.stringify(audits)).not.toContain('9811122222');
  });

  it("keeps the parent's reason when the number is already blocked", async () => {
    expect(await blockNumber(PHONES.p3, actor)).toEqual({ ok: true });
    const [row] = await sql(`select reason from blocked_numbers where phone_e164 = $1`, [PHONES.p3]);
    expect(row.reason).toBe('key_9');
    expect(await sql(`select 1 from audit_log`)).toHaveLength(0);
  });

  it('blocks by person id', async () => {
    expect(await blockPersonNumber(ID.p1, actor)).toEqual({ ok: true });
    expect((await listBlocked({ last4: '3210' }))[0]).toMatchObject({ reason: 'admin', peopleCount: 1 });
  });
});

describe('unblockNumber', () => {
  it('lifts an admin block', async () => {
    expect(await unblockNumber(phoneRef(PHONES.adminBlocked), actor)).toEqual({ ok: true });
    expect(await sql(`select 1 from blocked_numbers where phone_e164 = $1`, [PHONES.adminBlocked])).toHaveLength(0);
    const [audit] = await sql(`select action, before from audit_log where entity = 'blocked_number'`);
    expect(audit.action).toBe('unblocked');
    expect(audit.before.phone).toBe('+xxxxxxxx9999');
  });

  it('never lifts a block the parent asked for (key 9)', async () => {
    const r = await unblockNumber(phoneRef(PHONES.p3), actor);
    expect(r.ok).toBe(false);
    expect(await sql(`select 1 from blocked_numbers where phone_e164 = $1`, [PHONES.p3])).toHaveLength(1);
    expect(await sql(`select 1 from audit_log`)).toHaveLength(0);
  });

  it('rejects unknown or malformed refs', async () => {
    expect((await unblockNumber('0'.repeat(64), actor)).ok).toBe(false);
    expect((await unblockNumber('not-a-ref', actor)).ok).toBe(false);
  });
});

describe('setPersonPaused', () => {
  it('pauses and resumes with one audit row per change', async () => {
    expect(await setPersonPaused(ID.p1, true, actor)).toEqual({ ok: true });
    expect(await setPersonPaused(ID.p1, true, actor)).toEqual({ ok: true }); // no-op
    let [p] = await sql(`select paused from people where id = $1`, [ID.p1]);
    expect(p.paused).toBe(true);

    expect(await setPersonPaused(ID.p1, false, actor)).toEqual({ ok: true });
    [p] = await sql(`select paused from people where id = $1`, [ID.p1]);
    expect(p.paused).toBe(false);

    const audits = await sql(`select entity, entity_id, action from audit_log order by id`);
    expect(audits).toEqual([
      { entity: 'person', entity_id: ID.p1, action: 'paused' },
      { entity: 'person', entity_id: ID.p1, action: 'unpaused' },
    ]);
  });

  it('rejects unknown and deleted people', async () => {
    expect((await setPersonPaused('99999999-9999-4999-8999-999999999999', true, actor)).ok).toBe(false);
    await sql(`update people set deleted_at = now() where id = $1`, [ID.p2]);
    expect((await setPersonPaused(ID.p2, true, actor)).ok).toBe(false);
  });
});

describe('addSupportNote', () => {
  it('saves a note and lists it newest first', async () => {
    expect(await addSupportNote(ID.u1, 'Called Asha, Papa prefers 9:30.', actor)).toEqual({ ok: true });
    expect(await addSupportNote(ID.u1, '  Second note  ', actor, { personId: ID.p1 })).toEqual({ ok: true });
    const notes = await listSupportNotes(ID.u1);
    expect(notes.map((n) => [n.text, n.personId, n.by])).toEqual([
      ['Second note', ID.p1, actor.email],
      ['Called Asha, Papa prefers 9:30.', null, actor.email],
    ]);
    expect(await listSupportNotes(ID.u2)).toEqual([]);
  });

  it('validates text and ownership', async () => {
    expect((await addSupportNote(ID.u1, '   ', actor)).ok).toBe(false);
    expect((await addSupportNote(ID.u1, 'x'.repeat(NOTE_MAX_LENGTH + 1), actor)).ok).toBe(false);
    // person belongs to another family
    expect((await addSupportNote(ID.u1, 'hello', actor, { personId: ID.p3 })).ok).toBe(false);
    expect((await addSupportNote('99999999-9999-4999-8999-999999999999', 'hello', actor)).ok).toBe(false);
    expect(await sql(`select 1 from audit_log`)).toHaveLength(0);
  });
});
