import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isInMealWindow, type Meal } from '@tasalli/contracts';
import { DateTime } from 'luxon';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { Clock, CLOCK } from '../common/clock';
import { Db, Queryable } from '../db/db.service';
import { DoseGenerator } from '../doses/dose-generator.service';
import { localToday } from '../doses/dose-times';
import { PeopleService, PersonRow } from '../people/people.service';
import { EventsService } from '../queues/events.service';
import { findLookAlikes, LookAlikeCandidate, LookAlikeConflict } from './look-alike';
import { MedicineCreateDto, NOT_FOR_KIND, REQUIRED_FOR_KIND } from './medicines.dto';
import { SCRIPT_PREVIEWER, ScriptPreviewer } from './script-previewer';

export interface MedicineRow {
  id: string;
  person_id: string;
  kind: 'tablet' | 'capsule' | 'syrup' | 'other';
  strip_name: string;
  strength_text: string | null;
  spoken_name: string;
  colour_primary: string | null;
  colour_secondary: string | null;
  shape: string | null;
  size: string | null;
  marking: string | null;
  kept_in: string | null;
  pack_colour: string | null;
  print_colour: string | null;
  cap_colour: string | null;
  number_label: number | null;
  say_printed_name: boolean;
  extra_instruction: string | null;
  active: boolean;
}

export interface ScheduleRow {
  id: string;
  medicine_id: string;
  local_time: string; // 'HH:MM:SS'
  amount_text: string;
  food: 'before' | 'after' | 'with' | 'any';
  meal: Meal | null;
  days_of_week: number[];
  start_date: string;
  end_date: string | null;
}

const SCHEDULE_COLUMNS = `id, medicine_id, local_time::text, amount_text, food, meal, days_of_week, start_date::text, end_date::text`;
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export function medicineToApi(m: MedicineRow, schedules: ScheduleRow[]) {
  return {
    id: m.id,
    active: m.active,
    kind: m.kind,
    stripName: m.strip_name,
    strengthText: m.strength_text ?? undefined,
    spokenName: m.spoken_name,
    appearance: {
      colourPrimary: m.colour_primary ?? undefined,
      colourSecondary: m.colour_secondary ?? undefined,
      shape: m.shape ?? undefined,
      size: m.size ?? undefined,
      marking: m.marking ?? undefined,
      keptIn: m.kept_in ?? undefined,
      packColour: m.pack_colour ?? undefined,
      printColour: m.print_colour ?? undefined,
      capColour: m.cap_colour ?? undefined,
    },
    numberLabel: m.number_label,
    sayPrintedName: m.say_printed_name,
    extraInstruction: m.extra_instruction ?? undefined,
    schedules: schedules.map((s) => ({
      localTime: s.local_time.slice(0, 5),
      amountText: s.amount_text,
      food: s.food,
      meal: s.meal,
      daysOfWeek: s.days_of_week,
      startDate: s.start_date,
      endDate: s.end_date,
    })),
  };
}

/** Only appearance fields and the family's own disambiguation choices go into the comparison (safety rule 2). */
function toCandidate(m: MedicineRow): LookAlikeCandidate {
  return {
    id: m.id,
    appearance: {
      kind: m.kind,
      colourPrimary: m.colour_primary,
      colourSecondary: m.colour_secondary,
      shape: m.shape,
      size: m.size,
      marking: m.marking,
      keptIn: m.kept_in,
      packColour: m.pack_colour,
      printColour: m.print_colour,
      capColour: m.cap_colour,
    },
    numberLabel: m.number_label,
    sayPrintedName: m.say_printed_name,
  };
}

interface NormalisedSchedule {
  localTime: string;
  amountText: string;
  food: string;
  meal: Meal | null;
  daysOfWeek: number[];
  startDate: string;
  /** False when the app left startDate out (then it defaults to the person's today). */
  startDateGiven: boolean;
  endDate: string | null;
}

@Injectable()
export class MedicinesService {
  constructor(
    private readonly db: Db,
    private readonly people: PeopleService,
    private readonly audit: AuditService,
    private readonly doses: DoseGenerator,
    private readonly events: EventsService,
    @Inject(SCRIPT_PREVIEWER) private readonly previewer: ScriptPreviewer,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async schedulesFor(q: Queryable, medicineIds: string[], today: string): Promise<ScheduleRow[]> {
    // Current schedules only: ones ended by an edit (end_date before today) are history.
    const { rows } = await q.query<ScheduleRow>(
      `select ${SCHEDULE_COLUMNS} from schedules
        where medicine_id = any($1::uuid[]) and (end_date is null or end_date >= $2::date)
        order by local_time, created_at`,
      [medicineIds, today],
    );
    return rows;
  }

  async list(user: AuthUser, personId: string) {
    const person = await this.people.getOwned(this.db, user.id, personId);
    const meds = (await this.db.query<MedicineRow>('select * from medicines where person_id = $1 order by active desc, created_at', [personId])).rows;
    const schedules = await this.schedulesFor(this.db, meds.map((m) => m.id), localToday(this.clock.now(), person.time_zone));
    return meds.map((m) => medicineToApi(m, schedules.filter((s) => s.medicine_id === m.id)));
  }

  /** Loads a medicine and checks the signed-in user owns its person. 404 otherwise. */
  private async getOwned(q: Queryable, user: AuthUser, medicineId: string, forUpdate = false) {
    const m = await this.db.one<MedicineRow>(
      q,
      `select m.* from medicines m join people p on p.id = m.person_id
        where m.id = $1 and p.owner_user_id = $2 and p.deleted_at is null ${forUpdate ? 'for update of m' : ''}`,
      [medicineId, user.id],
    );
    if (!m) throw new NotFoundException();
    const person = await this.people.getOwned(q, user.id, m.person_id);
    return { medicine: m, person };
  }

  private validate(dto: MedicineCreateDto, person: PersonRow): NormalisedSchedule[] {
    const bad = NOT_FOR_KIND[dto.kind].filter((f) => dto.appearance?.[f] != null);
    if (bad.length) throw new BadRequestException(`Not used for ${dto.kind}: ${bad.join(', ')}`);
    const a = dto.appearance ?? {};
    const missing = REQUIRED_FOR_KIND[dto.kind].filter((f) => a[f] == null || String(a[f]).trim() === '');
    if (a.keptIn === 'strip' && (a.packColour == null || a.packColour.trim() === '') && !missing.includes('packColour')) missing.push('packColour');
    if (missing.length) throw new BadRequestException(`Needed for ${dto.kind}: appearance.${missing.join(', appearance.')}`);
    const today = localToday(this.clock.now(), person.time_zone);
    const seen = new Set<string>();
    return dto.schedules.map((s) => {
      if (seen.has(s.localTime)) throw new BadRequestException(`Two schedules at ${s.localTime}`);
      seen.add(s.localTime);
      const startDate = s.startDate ?? today;
      if (!DateTime.fromISO(startDate).isValid) throw new BadRequestException('startDate is not a real date');
      if (s.endDate && !DateTime.fromISO(s.endDate).isValid) throw new BadRequestException('endDate is not a real date');
      if (s.endDate && s.endDate < startDate) throw new BadRequestException('endDate is before startDate');
      const meal = s.meal ?? null;
      if (meal && !isInMealWindow(meal, s.localTime)) {
        throw new BadRequestException({ statusCode: 400, code: 'outside_meal_window', message: `${s.localTime} is outside the ${meal} times` });
      }
      return {
        localTime: s.localTime,
        amountText: s.amountText,
        food: s.food,
        meal,
        daysOfWeek: [...(s.daysOfWeek ?? ALL_DAYS)].sort(),
        startDate,
        startDateGiven: s.startDate !== undefined,
        endDate: s.endDate ?? null,
      };
    });
  }

  private async checkNumberLabel(q: Queryable, personId: string, label: number | null | undefined, selfId: string | null) {
    if (label == null) return;
    const clash = await this.db.one(
      q,
      'select 1 from medicines where person_id = $1 and active and number_label = $2 and ($3::uuid is null or id <> $3)',
      [personId, label, selfId],
    );
    if (clash) throw new BadRequestException(`Number ${label} is already used for another medicine`);
  }

  private medicineValues(dto: MedicineCreateDto) {
    const a = dto.appearance ?? {};
    return [
      dto.kind, dto.stripName, dto.strengthText ?? null, dto.spokenName,
      a.colourPrimary ?? null, a.colourSecondary ?? null, a.shape ?? null, a.size ?? null, a.marking ?? null,
      a.keptIn ?? null, a.packColour ?? null, a.printColour ?? null, a.capColour ?? null,
      dto.numberLabel ?? null, dto.sayPrintedName ?? false, dto.extraInstruction ?? null,
    ];
  }

  private async insertSchedules(q: Queryable, medicineId: string, schedules: NormalisedSchedule[]) {
    for (const s of schedules) {
      await q.query(
        `insert into schedules (medicine_id, local_time, amount_text, food, meal, days_of_week, start_date, end_date)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [medicineId, s.localTime, s.amountText, s.food, s.meal, s.daysOfWeek, s.startDate, s.endDate],
      );
    }
  }

  private async lookAlikes(q: Queryable, m: MedicineRow, person: PersonRow): Promise<LookAlikeConflict[]> {
    const others = (await q.query<MedicineRow>('select * from medicines where person_id = $1 and active and id <> $2', [m.person_id, m.id])).rows;
    return findLookAlikes(toCandidate(m), others.map(toCandidate), person.can_read_strip);
  }

  async create(user: AuthUser, personId: string, dto: MedicineCreateDto) {
    const result = await this.db.tx(async (c) => {
      const person = await this.people.getOwned(c, user.id, personId, true);
      const schedules = this.validate(dto, person);
      await this.checkNumberLabel(c, personId, dto.numberLabel, null);
      const m = (await this.db.one<MedicineRow>(
        c,
        `insert into medicines (person_id, kind, strip_name, strength_text, spoken_name, colour_primary, colour_secondary, shape, size,
           marking, kept_in, pack_colour, print_colour, cap_colour, number_label, say_printed_name, extra_instruction, created_by_user_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning *`,
        [personId, ...this.medicineValues(dto), user.id],
      ))!;
      await this.insertSchedules(c, m.id, schedules);
      await this.audit.record(c, { actorUserId: user.id, actorKind: 'user', entity: 'medicine', entityId: m.id, action: 'created', after: { ...m, schedules } });
      await this.doses.generate(c, personId); // no-op unless consented (safety rule 3)
      const lookAlike = await this.lookAlikes(c, m, person);
      const current = await this.schedulesFor(c, [m.id], localToday(this.clock.now(), person.time_zone));
      return { medicine: medicineToApi(m, current), lookAlike };
    });
    await this.events.dosesChanged(personId, 'medicine_changed', this.doses.window());
    return result;
  }

  /**
   * Full replace. Unchanged schedules are kept as they are. Changed or removed ones are
   * ended yesterday (their past doses stay as history) and their future doses removed;
   * new ones are added and doses regenerated.
   */
  async update(user: AuthUser, medicineId: string, dto: MedicineCreateDto) {
    const { result, personId } = await this.db.tx(async (c) => {
      const { medicine: before, person } = await this.getOwned(c, user, medicineId, true);
      if (!before.active) throw new BadRequestException('This medicine was stopped; add it again instead');
      const wanted = this.validate(dto, person);
      await this.checkNumberLabel(c, person.id, dto.numberLabel, medicineId);
      const today = localToday(this.clock.now(), person.time_zone);
      const existing = await this.schedulesFor(c, [medicineId], today);

      const same = (e: ScheduleRow, w: NormalisedSchedule) =>
        e.local_time.slice(0, 5) === w.localTime &&
        e.amount_text === w.amountText &&
        e.food === w.food &&
        (e.meal ?? null) === w.meal &&
        JSON.stringify([...e.days_of_week].sort()) === JSON.stringify(w.daysOfWeek) &&
        (e.end_date ?? null) === w.endDate &&
        (!w.startDateGiven || e.start_date === w.startDate);
      const keep = new Set<string>();
      const toAdd: NormalisedSchedule[] = [];
      for (const w of wanted) {
        const match = existing.find((e) => !keep.has(e.id) && same(e, w));
        if (match) keep.add(match.id);
        else toAdd.push(w);
      }
      const ended = existing.filter((s) => !keep.has(s.id)).map((s) => s.id);
      if (ended.length) {
        const yesterday = DateTime.fromISO(today).minus({ days: 1 }).toISODate();
        await c.query('update schedules set end_date = $2 where id = any($1::uuid[])', [ended, yesterday]);
        await this.doses.clearFuture(c, person.id, ended);
      }
      await this.insertSchedules(c, medicineId, toAdd);

      const after = (await this.db.one<MedicineRow>(
        c,
        `update medicines set kind = $2, strip_name = $3, strength_text = $4, spoken_name = $5, colour_primary = $6, colour_secondary = $7,
           shape = $8, size = $9, marking = $10, kept_in = $11, pack_colour = $12, print_colour = $13, cap_colour = $14,
           number_label = $15, say_printed_name = $16, extra_instruction = $17, updated_at = now()
         where id = $1 returning *`,
        [medicineId, ...this.medicineValues(dto)],
      ))!;
      await this.audit.record(c, {
        actorUserId: user.id, actorKind: 'user', entity: 'medicine', entityId: medicineId, action: 'updated',
        before: { ...before, schedules: existing }, after: { ...after, schedules: wanted },
      });
      await this.doses.generate(c, person.id);
      const lookAlike = await this.lookAlikes(c, after, person);
      const current = await this.schedulesFor(c, [medicineId], today);
      return { result: { medicine: medicineToApi(after, current), lookAlike }, personId: person.id };
    });
    await this.events.dosesChanged(personId, 'medicine_changed', this.doses.window());
    return result;
  }

  async stop(user: AuthUser, medicineId: string): Promise<void> {
    const personId = await this.db.tx(async (c) => {
      const { medicine, person } = await this.getOwned(c, user, medicineId, true);
      if (!medicine.active) return person.id;
      await c.query('update medicines set active = false, updated_at = now() where id = $1', [medicineId]);
      const scheduleIds = (await c.query<{ id: string }>('select id from schedules where medicine_id = $1', [medicineId])).rows.map((r) => r.id);
      await this.doses.clearFuture(c, person.id, scheduleIds);
      await this.audit.record(c, { actorUserId: user.id, actorKind: 'user', entity: 'medicine', entityId: medicineId, action: 'stopped', before: { active: true }, after: { active: false } });
      return person.id;
    });
    await this.events.dosesChanged(personId, 'medicine_stopped', this.doses.window());
  }

  async preview(user: AuthUser, medicineId: string) {
    const { medicine: m, person } = await this.getOwned(this.db, user, medicineId);
    const [s] = await this.schedulesFor(this.db, [m.id], localToday(this.clock.now(), person.time_zone));
    return this.previewer.preview({
      personName: person.nickname,
      language: person.language,
      spokenName: m.spoken_name,
      amountText: s?.amount_text ?? '',
      food: s?.food ?? 'any',
      extraInstruction: m.extra_instruction,
      disambiguator: { numberLabel: m.number_label, sayPrintedName: m.say_printed_name, stripName: m.strip_name },
    });
  }
}
