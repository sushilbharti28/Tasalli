import { Injectable } from '@nestjs/common';
import { Queryable } from '../db/db.service';

export type ActorKind = 'user' | 'system' | 'admin';

export interface AuditEntry {
  actorUserId: string | null;
  actorKind: ActorKind;
  entity: 'user' | 'person' | 'medicine' | 'dose' | 'consent' | 'subscription';
  entityId: string;
  action: string;
  before?: object | null;
  after?: object | null;
}

const PHONE_KEYS = new Set(['phone_e164', 'phone', 'phoneE164']);

/** Snapshots never hold full phone numbers (safety rule 8). */
function scrub(value: object | null | undefined): object | null {
  if (!value) return null;
  return JSON.parse(
    JSON.stringify(value, (key, v) => (PHONE_KEYS.has(key) && typeof v === 'string' ? `***${v.slice(-4)}` : v)),
  );
}

/**
 * Audit log for medicines, consents and manual actions (#31).
 * Always written in the same transaction as the change it records.
 */
@Injectable()
export class AuditService {
  async record(q: Queryable, e: AuditEntry): Promise<void> {
    await q.query(
      `insert into audit_log (actor_user_id, actor_kind, entity, entity_id, action, before, after)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [e.actorUserId, e.actorKind, e.entity, e.entityId, e.action, scrub(e.before), scrub(e.after)],
    );
  }
}
