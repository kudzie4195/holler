import type { Db, SignalRowInput, StoredSignal } from './store';
import { isTriggerStage, type PermitStage } from './stage';
import { projectKeyOf, relationOf, sameProject, sourceFamily, type ProjectKey, type ProjectLinkLite, type Relation } from './project';

/**
 * Scan-time project work (PLAN-2.0 items 2.1 and 2.3): one place that reads and writes the three tables of migration 0025
 * (holler_permit_stages, holler_project_links, holler_dedupe_drops) for one scan.
 *
 * WITHOUT the migration nothing changes. Each table is probed by its first real call; a missing table (or any failed read) turns that
 * part off for the rest of the scan, the rows are inserted exactly as the adapter produced them, and nothing here throws. A scan with no
 * permit rows that carry an address or a stage makes no call at all.
 *
 * What it does, per source and scan:
 *   plan()      before the insert: drops a record that is the same project as a stored or earlier record of the same source (a
 *               duplicate), keeps a record of another source as corroboration (stored, but it makes no card), and writes a trigger
 *               stage (final inspection, finaled, certificate of occupancy) into the data of a row that is about to be inserted.
 *   record()    after the insert: links the stored rows to their project and logs what was dropped, once per record.
 *   stages()    after the insert: records each NEW (permit, stage) pair. The first trigger stage of a permit already stored makes ONE
 *               update: the project row gets data.permitStage, and the row is returned so the scan can match it to the stage trades.
 *               The same status read again, or the same row read by the next scan, finds its pair stored and does nothing.
 * Stored rows are never rewritten in bulk: only the one project row whose stage just changed gets two data keys.
 */

export type DropKind = Relation;

export interface DropRecord {
  source: string;
  externalId: string;
  kind: DropKind;
  ofSource: string;
  ofExternalId: string;
}

export interface ProjectPlan {
  /** What to insert: the incoming rows minus duplicates, with a trigger stage written into data. */
  rows: SignalRowInput[];
  /** External ids of rows that are stored as corroboration: they make no card or alert in this scan. */
  corroborating: Set<string>;
  drops: DropRecord[];
  /** Rows to link to their project once their signal ids are known. */
  toLink: Array<{ row: SignalRowInput; pk: ProjectKey }>;
  /** Existing history per permit id, read before the insert. Null when stage tracking is off for this scan. */
  stageHistory: Map<string, Set<PermitStage>> | null;
}

type DbError = { message?: string; code?: string } | null | undefined;

const TABLES = { stages: 'holler_permit_stages', links: 'holler_project_links', drops: 'holler_dedupe_drops' } as const;

/** The table is not there yet (PostgREST PGRST205 or Postgres 42P01), as the contacts writer tests for its table. */
export function missingTable(e: DbError, table: string): boolean {
  const m = e?.message ?? '';
  return e?.code === '42P01' || e?.code === 'PGRST205' || (m.includes(table) && /does not exist|could not find|schema cache/i.test(m));
}

const CHUNK = 100;
const DROP_RETENTION_DAYS = 30;

function chunks<T>(arr: readonly T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const emptyPlan = (rows: SignalRowInput[]): ProjectPlan => ({ rows, corroborating: new Set(), drops: [], toLink: [], stageHistory: null });

export class ProjectStore {
  /** null = not probed yet, true = a read worked, false = off for this scan. */
  private on: Record<keyof typeof TABLES, boolean | null> = { stages: null, links: null, drops: null };

  constructor(
    private readonly db: Db,
    private readonly log: (m: string) => void,
    private readonly now: Date = new Date(),
  ) {}

  private off(which: keyof typeof TABLES, e: DbError): void {
    if (this.on[which] === false) return;
    this.on[which] = false;
    this.log(
      missingTable(e, TABLES[which])
        ? `projects: ${TABLES[which]} is missing (apply migration 0025); this part is off and records are stored as before`
        : `projects: ${TABLES[which]} read skipped: ${(e?.message ?? 'unknown').slice(0, 120)}`,
    );
  }

  // ---- before the insert ---------------------------------------------------------------------------------------------------------

  async plan(rows: SignalRowInput[]): Promise<ProjectPlan> {
    const plan = emptyPlan(rows);
    try {
      await this.planLinks(plan);
      await this.planStages(plan);
    } catch (e) {
      // Never fail the scan: hand back the rows exactly as they came.
      this.log(`projects: plan skipped: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`);
      return emptyPlan(rows);
    }
    return plan;
  }

  private async planLinks(plan: ProjectPlan): Promise<void> {
    if (this.on.links === false) return;
    const keyed = plan.rows.map((row) => ({ row, pk: projectKeyOf(row) })).filter((k): k is { row: SignalRowInput; pk: ProjectKey } => k.pk !== null);
    if (keyed.length === 0) return;
    const keys = [...new Set(keyed.map((k) => k.pk.key))];
    const stored: ProjectLinkLite[] = [];
    for (const part of chunks(keys)) {
      const { data, error } = await this.db
        .from(TABLES.links)
        .select('project_key, source, external_id, occurred_at, lat, lon, city')
        .in('project_key', part);
      if (error) return this.off('links', error);
      for (const r of (data ?? []) as Array<{ project_key: string; source: string; external_id: string; occurred_at: string; lat: number | null; lon: number | null; city: string | null }>) {
        stored.push({ key: r.project_key, source: r.source, externalId: r.external_id, occurredAt: r.occurred_at, lat: r.lat, lon: r.lon, city: r.city });
      }
    }
    this.on.links = true;

    const dropped = new Set<SignalRowInput>();
    // Rows that already have their own link are the keepers of their project (a re-read): never compared, never dropped.
    const own = (row: SignalRowInput) => stored.some((l) => l.source === row.source && l.externalId === row.externalId);
    const kept: Array<{ row: SignalRowInput; pk: ProjectKey }> = keyed.filter((k) => own(k.row));
    const rest = keyed.filter((k) => !own(k.row)).sort((a, b) => (a.row.externalId < b.row.externalId ? -1 : a.row.externalId > b.row.externalId ? 1 : 0));
    for (const k of rest) {
      const probe = { ...k.pk, occurredAt: k.row.occurredAt };
      // Candidates: stored links, then rows of this batch kept so far. A same-family candidate wins (it makes this a duplicate).
      const candidates: Array<{ source: string; externalId: string }> = [
        ...stored.filter((l) => sameProject(probe, l)).map((l) => ({ source: l.source, externalId: l.externalId })),
        ...kept
          .filter((o) => o.row !== k.row && sameProject(probe, { key: o.pk.key, source: o.row.source, externalId: o.row.externalId, occurredAt: o.row.occurredAt, lat: o.pk.lat, lon: o.pk.lon, city: o.pk.city }))
          .map((o) => ({ source: o.row.source, externalId: o.row.externalId })),
      ].filter((c) => !(c.source === k.row.source && c.externalId === k.row.externalId));
      if (candidates.length === 0) {
        kept.push(k);
        continue;
      }
      const family = sourceFamily(k.row.source);
      const first = candidates.find((c) => sourceFamily(c.source) === family) ?? candidates[0];
      const kind = relationOf(k.row.source, first.source);
      plan.drops.push({ source: k.row.source, externalId: k.row.externalId, kind, ofSource: first.source, ofExternalId: first.externalId });
      if (kind === 'duplicate') dropped.add(k.row);
      else {
        plan.corroborating.add(k.row.externalId);
        kept.push(k);
      }
    }
    // Re-read rows whose own link exists may be corroboration decided in an earlier scan: they are already stored, nothing to do.
    plan.rows = plan.rows.filter((r) => !dropped.has(r));
    plan.toLink = kept.filter((k) => !own(k.row) && !dropped.has(k.row));
  }

  private async planStages(plan: ProjectPlan): Promise<void> {
    if (this.on.stages === false) return;
    const withStage = plan.rows.filter((r) => r.permitStage);
    if (withStage.length === 0) return;
    const bySource = new Map<string, string[]>();
    for (const r of withStage) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r.externalId]);
    const history = new Map<string, Set<PermitStage>>();
    for (const [source, ids] of bySource) {
      for (const part of chunks(ids, 200)) {
        const { data, error } = await this.db.from(TABLES.stages).select('permit_id, stage').eq('source', source).in('permit_id', part);
        if (error) return this.off('stages', error);
        for (const r of (data ?? []) as Array<{ permit_id: string; stage: PermitStage }>) {
          const key = `${source}\u0000${r.permit_id}`;
          history.set(key, (history.get(key) ?? new Set()).add(r.stage));
        }
      }
    }
    this.on.stages = true;
    plan.stageHistory = history;
    // A row about to be inserted that already shows a trigger stage carries it, so its first card says so.
    const at = this.now.toISOString();
    plan.rows = plan.rows.map((r) =>
      r.permitStage && isTriggerStage(r.permitStage) ? { ...r, data: { ...(r.data ?? {}), permitStage: r.permitStage, permitStageAt: at } } : r,
    );
  }

  // ---- after the insert ----------------------------------------------------------------------------------------------------------

  async record(plan: ProjectPlan, inserted: readonly StoredSignal[]): Promise<void> {
    try {
      const idOf = new Map(inserted.filter((s) => s.external_id != null).map((s) => [s.external_id as string, s.id]));
      if (plan.toLink.length && this.on.links === true) {
        const links = plan.toLink
          .filter((k) => idOf.has(k.row.externalId))
          .map((k) => ({
            project_key: k.pk.key,
            source: k.row.source,
            external_id: k.row.externalId,
            signal_id: idOf.get(k.row.externalId),
            occurred_at: k.row.occurredAt,
            city: k.pk.city,
            lat: k.pk.lat,
            lon: k.pk.lon,
          }));
        for (const part of chunks(links)) {
          const { error } = await this.db.from(TABLES.links).upsert(part, { onConflict: 'source,external_id', ignoreDuplicates: true });
          if (error) {
            this.log(`projects: links write skipped: ${error.message.slice(0, 120)}`);
            break;
          }
        }
      }
      if (plan.drops.length && this.on.drops !== false) {
        const rows = plan.drops.map((d) => ({ source: d.source, external_id: d.externalId, kind: d.kind, of_source: d.ofSource, of_external_id: d.ofExternalId }));
        for (const part of chunks(rows)) {
          const { error } = await this.db.from(TABLES.drops).upsert(part, { onConflict: 'source,external_id', ignoreDuplicates: true });
          if (error) {
            this.off('drops', error);
            break;
          }
          this.on.drops = true;
        }
        const dup = plan.drops.filter((d) => d.kind === 'duplicate').length;
        if (dup) this.log(`projects: ${dup} rows were the same project as another record of the same source and were not stored`);
        if (plan.corroborating.size) this.log(`projects: ${plan.corroborating.size} rows corroborate a project from another source: stored, no second card`);
      }
    } catch (e) {
      this.log(`projects: record skipped: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`);
    }
  }

  /**
   * Records new (permit, stage) pairs and returns the stored project rows that got their ONE stage update in this scan (existing
   * projects only: a row inserted in this scan carries its stage already and is matched as a new card).
   */
  async stages(plan: ProjectPlan, inserted: readonly StoredSignal[]): Promise<StoredSignal[]> {
    const events: StoredSignal[] = [];
    try {
      if (!plan.stageHistory || this.on.stages !== true) return events;
      const history = plan.stageHistory;
      const cand = plan.rows.filter((r) => r.permitStage && !(history.get(`${r.source}\u0000${r.externalId}`)?.has(r.permitStage)));
      if (cand.length === 0) return events;
      const insertedBy = new Map(inserted.filter((s) => s.external_id != null).map((s) => [`${s.source}\u0000${s.external_id}`, s]));
      // Stored rows that were not inserted now: read them (id and the fields matching needs).
      const need = cand.filter((r) => !insertedBy.has(`${r.source}\u0000${r.externalId}`));
      const existing = new Map<string, StoredSignal & { data?: Record<string, unknown> | null }>();
      const bySource = new Map<string, string[]>();
      for (const r of need) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r.externalId]);
      for (const [source, ids] of bySource) {
        for (const part of chunks(ids, 200)) {
          const { data, error } = await this.db
            .from('holler_signals')
            .select('id, source, kind, external_id, title, summary, categories, lat, lon, state, severity, occurred_at, place_slug, data')
            .eq('source', source)
            .in('external_id', part);
          if (error) {
            this.log(`projects: stage read skipped: ${error.message.slice(0, 120)}`);
            return events;
          }
          for (const s of (data ?? []) as Array<StoredSignal & { data?: Record<string, unknown> | null }>) existing.set(`${source}\u0000${s.external_id}`, s);
        }
      }
      const rows: Array<{ source: string; permit_id: string; stage: PermitStage; signal_id: number; emitted: boolean }> = [];
      const meta = new Map<string, { row: SignalRowInput; fresh: boolean; sig: StoredSignal & { data?: Record<string, unknown> | null }; emitted: boolean; changed: boolean }>();
      for (const r of cand) {
        const k = `${r.source}\u0000${r.externalId}`;
        const fresh = insertedBy.has(k);
        const sig = (insertedBy.get(k) ?? existing.get(k)) as (StoredSignal & { data?: Record<string, unknown> | null }) | undefined;
        if (!sig || typeof sig.id !== 'number') continue;
        const prior = history.get(k) ?? new Set<PermitStage>();
        const priorTrigger = [...prior].some((s) => isTriggerStage(s));
        // A permit already stored and never seen before this scan is only a BASELINE (we cannot know when it changed): its stage is
        // recorded, nothing is updated and nothing is emitted. A change needs an earlier recorded stage.
        const changed = fresh || prior.size > 0;
        const emitted = isTriggerStage(r.permitStage) && !priorTrigger && changed;
        rows.push({ source: r.source, permit_id: r.externalId, stage: r.permitStage as PermitStage, signal_id: sig.id, emitted });
        meta.set(`${k}\u0000${r.permitStage}`, { row: r, fresh, sig, emitted, changed });
      }
      if (rows.length === 0) return events;
      const won = new Set<string>();
      for (const part of chunks(rows)) {
        const { data, error } = await this.db
          .from(TABLES.stages)
          .upsert(part, { onConflict: 'source,permit_id,stage', ignoreDuplicates: true })
          .select('source, permit_id, stage');
        if (error) {
          this.log(`projects: stage write skipped: ${error.message.slice(0, 120)}`);
          return events;
        }
        // Only the rows this call really inserted count: a second scan racing this one gets none back.
        for (const r of (data ?? []) as Array<{ source: string; permit_id: string; stage: string }>) won.add(`${r.source}\u0000${r.permit_id}\u0000${r.stage}`);
      }
      const at = this.now.toISOString();
      for (const [k, m] of meta) {
        if (!won.has(k) || !m.row.permitStage || !isTriggerStage(m.row.permitStage) || m.fresh || !m.changed) continue;
        const data = { ...(m.sig.data ?? {}), permitStage: m.row.permitStage, permitStageAt: at };
        const { error } = await this.db.from('holler_signals').update({ data }).eq('id', m.sig.id);
        if (error) {
          this.log(`projects: stage update skipped: ${error.message.slice(0, 120)}`);
          continue;
        }
        if (m.emitted) {
          const st = (typeof data.subtype === 'string' ? data.subtype : null) as string | null;
          events.push({ ...m.sig, data: data as StoredSignal['data'], subtype: st } as StoredSignal);
        }
      }
    } catch (e) {
      this.log(`projects: stages skipped: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`);
    }
    return events;
  }

  /** Daily housekeeping: the duplicate log keeps 30 days. Best effort; a missing table is fine. */
  async pruneOld(): Promise<void> {
    try {
      const cutoff = new Date(this.now.getTime() - DROP_RETENTION_DAYS * 86_400_000).toISOString();
      await this.db.from(TABLES.drops).delete().lt('dropped_at', cutoff);
    } catch {
      /* best effort */
    }
  }
}
