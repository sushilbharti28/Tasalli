import type { Pool, PoolClient } from 'pg';
import { getWritePool } from './db';
import { maskPhone } from './mask';

/**
 * EVERY admin write lives in this module, so it can move to the admin API
 * (apps/admin/admin-api.yaml) by replacing these bodies with HTTP calls.
 *
 * Until then they write to Postgres directly, each in one transaction with an
 * audit_log row (actor_kind = 'admin'). Phone numbers in the audit log are masked.
 *
 *   blockNumber      -> POST   /admin/blocked-numbers
 *   unblockNumber    -> DELETE /admin/blocked-numbers/{phoneRef}
 *   setPersonPaused  -> POST   /admin/people/{personId}/pause | /unpause
 *   addSupportNote   -> POST   /admin/families/{userId}/notes
 */

export type WriteResult = { ok: true } | { ok: false; error: string };

export interface Actor {
  /** The signed-in founder's email, recorded in the audit log. */
  email: string;
}

const E164_RE = /^\+[1-9]\d{7,14}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOTE_MAX_LENGTH = 2000;

async function tx<T>(db: Pool | undefined, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await (db ?? getWritePool()).connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function audit(
  c: PoolClient,
  entity: string,
  entityIdSql: string,
  entityIdParam: string,
  action: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await c.query(
    `insert into audit_log (actor_user_id, actor_kind, entity, entity_id, action, before, after)
     values (null, 'admin', $1, ${entityIdSql}, $3, $4, $5)`,
    [entity, entityIdParam, action, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)],
  );
}

/** Stable uuid for a number-level audit entry, so no full number is stored in the log. */
const NUMBER_ENTITY_ID = `md5('blocked_number:' || $2)::uuid`;

/**
 * Block a number for every account (same effect as key 9, reason 'admin').
 * Idempotent: blocking an already-blocked number keeps the original reason.
 */
export async function blockNumber(phoneE164: string, actor: Actor, db?: Pool): Promise<WriteResult> {
  const phone = phoneE164.replace(/[\s-]/g, '');
  if (!E164_RE.test(phone)) return { ok: false, error: 'Enter the number in international format, e.g. +91 followed by 10 digits.' };
  return tx(db, async (c) => {
    const ins = await c.query(
      `insert into blocked_numbers (phone_e164, reason) values ($1, 'admin')
       on conflict (phone_e164) do nothing returning phone_e164`,
      [phone],
    );
    if (ins.rowCount === 0) return { ok: true } as const;
    await audit(c, 'blocked_number', NUMBER_ENTITY_ID, phone, 'blocked', null, {
      phone: maskPhone(phone),
      reason: 'admin',
      by: actor.email,
    });
    return { ok: true } as const;
  });
}

/** Block the number of a given person (from the person page). */
export async function blockPersonNumber(personId: string, actor: Actor, db?: Pool): Promise<WriteResult> {
  if (!UUID_RE.test(personId)) return { ok: false, error: 'Unknown person.' };
  const { rows } = await (db ?? getWritePool()).query(`select phone_e164 from people where id = $1`, [personId]);
  if (!rows[0]) return { ok: false, error: 'Unknown person.' };
  return blockNumber(rows[0].phone_e164, actor, db);
}

/**
 * Lift a block. Only blocks the founder placed ('admin') can be lifted here.
 * A block from key 9, a stop phrase or a declined consent is the parent's own
 * choice (safety rule 3) and is never undone from the console.
 * Unblocking does not change consent: the person still needs a new consent call.
 */
export async function unblockNumber(phoneRef: string, actor: Actor, db?: Pool): Promise<WriteResult> {
  if (!/^[0-9a-f]{64}$/.test(phoneRef)) return { ok: false, error: 'Unknown number.' };
  return tx(db, async (c) => {
    const { rows } = await c.query(
      `select phone_e164, reason, blocked_at from blocked_numbers
        where encode(digest(phone_e164, 'sha256'), 'hex') = $1
        for update`,
      [phoneRef],
    );
    const row = rows[0];
    if (!row) return { ok: false, error: 'This number is not blocked.' } as const;
    if (row.reason !== 'admin') {
      return {
        ok: false,
        error: `This number was blocked by the parent (${row.reason}). It cannot be unblocked from the console.`,
      } as const;
    }
    await c.query(`delete from blocked_numbers where phone_e164 = $1`, [row.phone_e164]);
    await audit(
      c,
      'blocked_number',
      NUMBER_ENTITY_ID,
      row.phone_e164,
      'unblocked',
      { phone: maskPhone(row.phone_e164), reason: row.reason, blockedAt: row.blocked_at },
      { by: actor.email },
    );
    return { ok: true } as const;
  });
}

/** Pause or resume reminder calls for one person. */
export async function setPersonPaused(personId: string, paused: boolean, actor: Actor, db?: Pool): Promise<WriteResult> {
  if (!UUID_RE.test(personId)) return { ok: false, error: 'Unknown person.' };
  return tx(db, async (c) => {
    const { rows } = await c.query(
      `select paused from people where id = $1 and deleted_at is null for update`,
      [personId],
    );
    if (!rows[0]) return { ok: false, error: 'Unknown person.' } as const;
    if (rows[0].paused === paused) return { ok: true } as const;
    await c.query(`update people set paused = $2 where id = $1`, [personId, paused]);
    await audit(c, 'person', '$2::uuid', personId, paused ? 'paused' : 'unpaused', { paused: !paused }, { paused, by: actor.email });
    return { ok: true } as const;
  });
}

/**
 * Add a support note to a family (optionally about one person).
 * Stored in audit_log (entity 'support_note') until the support_notes table in the
 * contract change request is approved.
 */
export async function addSupportNote(
  userId: string,
  text: string,
  actor: Actor,
  opts: { personId?: string | null; db?: Pool } = {},
): Promise<WriteResult> {
  const body = text.trim();
  if (!UUID_RE.test(userId)) return { ok: false, error: 'Unknown family.' };
  if (body.length === 0) return { ok: false, error: 'Write a note first.' };
  if (body.length > NOTE_MAX_LENGTH) return { ok: false, error: `Notes are limited to ${NOTE_MAX_LENGTH} characters.` };
  const personId = opts.personId && UUID_RE.test(opts.personId) ? opts.personId : null;
  return tx(opts.db, async (c) => {
    const { rows } = await c.query(
      `select 1 from users u where u.id = $1
         and ($2::uuid is null or exists (select 1 from people p where p.id = $2::uuid and p.owner_user_id = u.id))`,
      [userId, personId],
    );
    if (!rows[0]) return { ok: false, error: 'Unknown family.' } as const;
    await audit(c, 'support_note', '$2::uuid', userId, 'note_added', null, { text: body, personId, by: actor.email });
    return { ok: true } as const;
  });
}
