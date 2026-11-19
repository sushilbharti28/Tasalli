import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getReadPool, resetPools } from '@/lib/db';
import { getFamily, getPerson, listBlocked, phoneRef, safeRecordingUrl, searchFamilies } from '@/lib/queries';
import { maskPhone } from '@/lib/mask';
import { ID, NOW, PHONES } from './fixtures';
import { reseed } from './db-helpers';

const FULL_NUMBERS = Object.values(PHONES).map((p) => p.replace('+', ''));

function expectNoFullNumbers(value: unknown) {
  const json = JSON.stringify(value);
  for (const n of FULL_NUMBERS) expect(json).not.toContain(n.slice(-10));
}

beforeAll(reseed);
afterAll(resetPools);

describe('maskPhone', () => {
  it('keeps only the last 4 digits', () => {
    expect(maskPhone('+919876543210')).toBe('+xxxxxxxx3210');
    expect(maskPhone('+14155550123')).toBe('+xxxxxxx0123');
    expect(maskPhone('123')).toBe('xxxx');
    expect(maskPhone(null)).toBe('');
  });
});

describe('read pool', () => {
  it('refuses writes', async () => {
    await expect(
      getReadPool().query(`insert into blocked_numbers (phone_e164, reason) values ('+910000000000', 'admin')`),
    ).rejects.toThrow(/read-only/);
  });
});

describe('searchFamilies', () => {
  it('lists newest families when the query is empty', async () => {
    const all = await searchFamilies('');
    expect(all.map((f) => f.userId)).toEqual([ID.u5, ID.u4, ID.u3, ID.u2, ID.u1]);
    expect(all.find((f) => f.userId === ID.u3)?.deleted).toBe(true);
  });

  it('finds by person nickname, case-insensitive', async () => {
    const r = await searchFamilies('papa');
    expect(r.map((f) => f.userId)).toEqual([ID.u1]);
    expect(r[0].peopleCount).toBe(2);
    expect(r[0].plan).toBe('one_parent');
  });

  it('finds by account name and full name', async () => {
    expect((await searchFamilies('ravi')).map((f) => f.userId)).toEqual([ID.u2]);
    expect((await searchFamilies('Lakshmi')).map((f) => f.userId)).toEqual([ID.u2]);
  });

  it("finds by the last digits of a person's number", async () => {
    expect((await searchFamilies('3210')).map((f) => f.userId)).toEqual([ID.u1]);
  });

  it('finds by a formatted full number of the account holder abroad', async () => {
    expect((await searchFamilies('+1 415 555 0123')).map((f) => f.userId)).toEqual([ID.u2]);
  });

  it('finds by a person id', async () => {
    expect((await searchFamilies(ID.p3)).map((f) => f.userId)).toEqual([ID.u2]);
  });

  it('treats LIKE wildcards literally and ignores 1-character queries', async () => {
    expect(await searchFamilies('%')).toEqual([]);
    expect(await searchFamilies('%%')).toEqual([]);
    expect(await searchFamilies('_a')).toEqual([]);
  });

  it('never returns a full phone number', async () => {
    expectNoFullNumbers(await searchFamilies(''));
  });
});

describe('getFamily', () => {
  it('returns people, subscriptions and flags', async () => {
    const f = await getFamily(ID.u1);
    expect(f).not.toBeNull();
    expect(f!.phoneMasked).toBe('+xxxxxxxx0001');
    expect(f!.people.map((p) => [p.nickname, p.consent, p.blocked])).toEqual([
      ['Papa', 'consented', false],
      ['Mummy', 'pending', false],
    ]);
    expect(f!.subscriptions.map((s) => s.plan)).toEqual(['one_parent', 'trial']);
    expectNoFullNumbers(f);
  });

  it('marks a blocked person', async () => {
    const f = await getFamily(ID.u2);
    expect(f!.people[0]).toMatchObject({ nickname: 'Amma', consent: 'opted_out', blocked: true });
  });

  it('returns null for unknown or malformed ids', async () => {
    expect(await getFamily('99999999-9999-4999-8999-999999999999')).toBeNull();
    expect(await getFamily("1' or '1'='1")).toBeNull();
  });
});

describe('getPerson', () => {
  it('returns consent events newest first and calls with masked numbers', async () => {
    const p = await getPerson(ID.p1, { now: NOW });
    expect(p).not.toBeNull();
    expect(p!.phoneMasked).toBe('+xxxxxxxx3210');
    expect(p!.owner.userId).toBe(ID.u1);
    expect(p!.consentEvents).toHaveLength(1);
    expect(p!.consentEvents[0]).toMatchObject({ result: 'consented', via: 'key', callId: ID.c6 });
    expect(p!.calls).toHaveLength(6);
    expect(p!.calls[0].createdAt.toISOString()).toBe('2026-11-14T14:30:00.000Z');
    expect(p!.activeMedicines).toBe(1);
    expect(p!.doseStats14d).toEqual({ confirmedByParent: 2, confirmedManual: 1, missed: 1, skippedPaused: 0, upcoming: 1 });
    expectNoFullNumbers(p);
  });

  it('plays recordings only for a consented person and only over http(s)', async () => {
    const p = await getPerson(ID.p1, { now: NOW });
    const byProvider = (id: string) => p!.calls.find((c) => c.id === id || c.recordingUrl?.endsWith(id));
    expect(byProvider('c1.mp3')?.recordingUrl).toBe('https://rec.example/c1.mp3');
    const js = p!.calls.find((c) => c.inputValue === 'haan le li');
    expect(js?.hasRecording).toBe(true);
    expect(js?.recordingUrl).toBeNull();

    const optedOut = await getPerson(ID.p3, { now: NOW });
    expect(optedOut!.calls[0].hasRecording).toBe(true);
    expect(optedOut!.calls[0].recordingUrl).toBeNull();
    expect(optedOut!.blocked).toBe(true);
    expect(optedOut!.blockReason).toBe('key_9');
    expect(optedOut!.consentEvents.map((e) => e.result)).toEqual(['opted_out', 'consented']);
  });

  it('safeRecordingUrl rejects non-http schemes', () => {
    expect(safeRecordingUrl('javascript:alert(1)')).toBeNull();
    expect(safeRecordingUrl('data:audio/mp3;base64,AA')).toBeNull();
    expect(safeRecordingUrl('not a url')).toBeNull();
    expect(safeRecordingUrl('https://x.example/a.mp3')).toBe('https://x.example/a.mp3');
  });
});

describe('listBlocked', () => {
  it('lists blocks with masked numbers, refs and who may unblock', async () => {
    const rows = await listBlocked();
    expect(rows.map((r) => [r.phoneMasked, r.reason, r.canUnblock, r.peopleCount])).toEqual([
      ['+xxxxxxxx9999', 'admin', true, 0],
      ['+xxxxxxxx1111', 'key_9', false, 1],
    ]);
    expect(rows[1].phoneRef).toBe(phoneRef(PHONES.p3));
    expectNoFullNumbers(rows);
  });

  it('filters by last digits', async () => {
    expect((await listBlocked({ last4: '1111' })).map((r) => r.reason)).toEqual(['key_9']);
    expect(await listBlocked({ last4: '4242' })).toEqual([]);
  });
});
