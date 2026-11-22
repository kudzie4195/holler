import type { Db, SignalRowInput, StoredSignal } from './store';
import { isTriggerStage, STAGE_RANK, type PermitStage } from './stage';
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
 *   plan()      before the insert: a record that is the same project as a stored or earlier record (strong match, lib/signals/project.ts)
 *               is still STORED, but marked data.projectOf = "source:external id" of the project's first record, so it makes no card of
 *               its own (match.ts isFollower). Two permit numbers are two permits: nothing is dropped. A trigger stage (final inspection,
 *               finaled, certificate of occupancy) is written into the data of a row about to be inserted.
 *   record()    after the insert: links the stored rows to their project and logs each follower once (for the quality dashboard).
 *   stages()    after the insert: records each NEW (permit, stage) pair (always, so the history builds from normal scans even while the
 *               stage query is off). Only while HOLLER_STAGE_UPDATES_ENABLED is on, the first trigger stage of a permit makes ONE update,
 *               aimed at the project's first record: it gets data.permitStage, and is returned so the scan can alert the stage trades (new
 *               card for a member who has none, one re-sent alert for a member who does). The same status read again, or the same row
 *               read by the next scan, finds its pair stored and does nothing. A PROBE row (the adapter's stage query, SignalInput.stageProbe)
 *               is never stored: it counts only for a permit that already has a status history and whose stage is not yet in it; a probe
 *               of a permit Holler has never tracked creates nothing at all (no row, no card, no history row, no alert).
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
  /** What to insert: every incoming row (none is dropped), followers marked data.projectOf, a trigger stage written into data. */
  rows: SignalRowInput[];
  /** External ids of rows stored as followers of an earlier record: they make no card or alert. */
  followers: Set<string>;
  /** Probe rows of permits that already have a status history (and a stored row): stage changes only, never inserted. */
  probes: SignalRowInput[];
  /** One entry per follower, for the quality dashboard. Nothing was dropped. */
  drops: DropRecord[];
  /** Rows to link to their project once their signal ids are known (new rows, and stored rows that were never linked). */
  toLink: Array<{ row: SignalRowInput; pk: ProjectKey; root: { source: string; externalId: string } | null; existingId?: number }>;
  /** For a follower (this scan's or one stored earlier), the first record of its project. */
  rootOf: Map<string, Root>;
  /** Existing history per permit id, read before the insert. Null when stage tracking is off for this scan. */
  stageHistory: Map<string, Set<PermitStage>> | null;
}

/** The first record of a project: the one card the project has. */
type Root = { source: string; externalId: string };
type StoredLink = ProjectLinkLite & { root: Root | null };

type DbError = { message?: string; code?: string } | null | undefined;

const TABLES = { stages: 'holler_permit_stages', links: 'holler_project_links', drops: 'holler_dedupe_drops' } as const;

/** The table is not there yet (PostgREST PGRST205 or Postgres 42P01), as the contacts writer tests for its table. */
export function missingTable(e: DbError, table: string): boolean {
  const m = e?.message ?? '';
  return e?.code === '42P01' || e?.code === 'PGRST205' || (m.includes(table) && /does not exist|could not find|schema cache/i.test(m));
}

const CHUNK = 100;
const DROP_RETENTION_DAYS = 30;
export const STAGE_HISTORY_DAYS = 400;

function chunks<T>(arr: readonly T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const linkTimeOf = (r: Pick<SignalRowInput, 'occurredAt'>): string => r.occurredAt;

const emptyPlan = (rows: SignalRowInput[]): ProjectPlan => ({ rows, followers: new Set(), probes: [], drops: [], toLink: [], rootOf: new Map(), stageHistory: null });

export class ProjectStore {
  /** null = not probed yet, true = a read worked, false = off for this scan. */
  private on: Record<keyof typeof TABLES, boolean | null> = { stages: null, links: null, drops: null };

  constructor(
    private readonly db: Db,
    private readonly log: (m: string) => void,
    private readonly now: Date = new Date(),
    /** HOLLER_STAGE_UPDATES_ENABLED: stage updates (data.permitStage, events, re-sends) happen only while this is true. History is recorded either way. */
    private readonly updates: boolean = false,
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

  async plan(input: SignalRowInput[]): Promise<ProjectPlan> {
    // Probe rows (the adapter's stage query) are never inserted: they are set apart before anything else.
    const probesIn = input.filter((r) => r.stageProbe);
    const rows = input.filter((r) => !r.stageProbe);
    let plan = emptyPlan(rows);
    try {
      await this.planLinks(plan);
      await this.planStages(plan, probesIn);
    } catch (e) {
      // Never fail the scan: hand back the rows exactly as they came.
      this.log(`projects: plan skipped: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`);
      plan = emptyPlan(rows);
      this.on.stages = false;
    }
    return plan;
  }

  /** One cheap read of the stage table, so a scan can tell before fetching whether adapters should make their stage query. Never throws. */
  async stageTrackingAvailable(): Promise<boolean> {
    if (this.on.stages === false) return false;
    try {
      const { error } = await this.db.from(TABLES.stages).select('permit_id').limit(1);
      if (error) {
        this.off('stages', error);
        return false;
      }
      this.on.stages = true;
      return true;
    } catch (e) {
      this.off('stages', { message: e instanceof Error ? e.message : 'unknown' });
      return false;
    }
  }

  private async planLinks(plan: ProjectPlan): Promise<void> {
    if (this.on.links === false) return;
    const keyed = plan.rows.map((row) => ({ row, pk: projectKeyOf(row) })).filter((k): k is { row: SignalRowInput; pk: ProjectKey } => k.pk !== null);
    if (keyed.length === 0) return;
    const keys = [...new Set(keyed.map((k) => k.pk.key))];
    const stored: StoredLink[] = [];
    for (const part of chunks(keys)) {
      const { data, error } = await this.db
        .from(TABLES.links)
        .select('project_key, source, external_id, occurred_at, lat, lon, city, root_source, root_external_id')
        .in('project_key', part);
      if (error) return this.off('links', error);
      for (const r of (data ?? []) as Array<{ project_key: string; source: string; external_id: string; occurred_at: string; lat: number | null; lon: number | null; city: string | null; root_source: string | null; root_external_id: string | null }>) {
        const root = r.root_source && r.root_external_id ? { source: r.root_source, externalId: r.root_external_id } : null;
        stored.push({ key: r.project_key, source: r.source, externalId: r.external_id, occurredAt: r.occurred_at, lat: r.lat, lon: r.lon, city: r.city, root });
        if (root && r.source === keyed[0].row.source) plan.rootOf.set(r.external_id, root);
      }
    }
    this.on.links = true;
    // A stored link whose first record has no link left (pruned) is its own project again.
    const linked = new Set(stored.map((l) => `${l.source}\u0000${l.externalId}`));
    for (const l of stored) {
      if (l.root && !linked.has(`${l.root.source}\u0000${l.root.externalId}`)) {
        plan.rootOf.delete(l.externalId);
        l.root = null;
      }
    }

    // Rows that already have their own link are settled (a re-read): never compared again, never changed.
    const ownSet = new Set(stored.map((l) => `${l.source}\u0000${l.externalId}`));
    const rest = keyed.filter((k) => !ownSet.has(`${k.row.source}\u0000${k.row.externalId}`));
    if (rest.length === 0) return;

    // Rows without a link that are ALREADY in holler_signals were stored before 0025 (or by a scan that had the table off). They are
    // not new records: link them as they are (no comparison, nothing is said about them) and let them stand as project records.
    const existingId = new Map<string, number>();
    const bySource = new Map<string, string[]>();
    for (const k of rest) bySource.set(k.row.source, [...(bySource.get(k.row.source) ?? []), k.row.externalId]);
    for (const [source, ids] of bySource) {
      for (const part of chunks(ids, 200)) {
        const { data, error } = await this.db.from('holler_signals').select('id, external_id').eq('source', source).in('external_id', part);
        if (error) return this.off('links', error);
        for (const r of (data ?? []) as Array<{ id: number; external_id: string }>) existingId.set(`${source}\u0000${r.external_id}`, r.id);
      }
    }

    type Kept = { row: SignalRowInput; pk: ProjectKey; root: Root | null; existingId?: number };
    const kept: Kept[] = [];
    const fresh: Array<{ row: SignalRowInput; pk: ProjectKey }> = [];
    for (const k of rest) {
      const id = existingId.get(`${k.row.source}\u0000${k.row.externalId}`);
      if (id !== undefined) {
        const e = { ...k, root: null, existingId: id };
        kept.push(e);
        plan.toLink.push(e);
      } else fresh.push(k);
    }
    fresh.sort((a, b) => {
      const ta = linkTimeOf(a.row);
      const tb = linkTimeOf(b.row);
      return ta < tb ? -1 : ta > tb ? 1 : a.row.externalId < b.row.externalId ? -1 : a.row.externalId > b.row.externalId ? 1 : 0;
    });
    const followerOf = new Map<string, Root>();
    for (const k of fresh) {
      const probe = { ...k.pk, occurredAt: linkTimeOf(k.row) };
      // Candidates: stored links, then the rows of this batch placed so far. A same-family candidate wins.
      const candidates: Array<{ source: string; externalId: string; root: Root | null }> = [
        ...stored.filter((l) => sameProject(probe, l)).map((l) => ({ source: l.source, externalId: l.externalId, root: l.root })),
        ...kept
          .filter((o) => sameProject(probe, { key: o.pk.key, source: o.row.source, externalId: o.row.externalId, occurredAt: linkTimeOf(o.row), lat: o.pk.lat, lon: o.pk.lon, city: o.pk.city }))
          .map((o) => ({ source: o.row.source, externalId: o.row.externalId, root: o.root })),
      ].filter((c) => !(c.source === k.row.source && c.externalId === k.row.externalId));
      if (candidates.length === 0) {
        const e = { ...k, root: null };
        kept.push(e);
        plan.toLink.push(e);
        continue;
      }
      const family = sourceFamily(k.row.source);
      const first = candidates.find((c) => sourceFamily(c.source) === family) ?? candidates[0];
      const root = first.root ?? { source: first.source, externalId: first.externalId };
      plan.drops.push({ source: k.row.source, externalId: k.row.externalId, kind: relationOf(k.row.source, first.source), ofSource: root.source, ofExternalId: root.externalId });
      plan.followers.add(k.row.externalId);
      plan.rootOf.set(k.row.externalId, root);
      followerOf.set(`${k.row.source}\u0000${k.row.externalId}`, root);
      const e = { ...k, root };
      kept.push(e);
      plan.toLink.push(e);
    }
    if (followerOf.size) {
      plan.rows = plan.rows.map((r) => {
        const root = followerOf.get(`${r.source}\u0000${r.externalId}`);
        return root ? { ...r, data: { ...(r.data ?? {}), projectOf: `${root.source}:${root.externalId}` } } : r;
      });
    }
  }

  private async planStages(plan: ProjectPlan, probesIn: SignalRowInput[]): Promise<void> {
    if (this.on.stages === false) return;
    const withStage = [...plan.rows.filter((r) => r.permitStage), ...probesIn.filter((r) => r.permitStage)];
    if (withStage.length === 0) return;
    const bySource = new Map<string, string[]>();
    for (const r of withStage) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r.externalId]);
    // The history is read by permit id whatever its signal_id is (a pruned signal leaves signal_id null: the history stays).
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
    if (!this.updates) return; // history only: no stage data on a card, no update, no probe
    // A probe counts only for a permit that already has a history and whose stage is not in it yet (a normalized status that differs
    // from what Holler stored). A permit never tracked, or a status already stored (any case, any spacing), creates nothing.
    plan.probes = probesIn.filter((r) => {
      const seen = history.get(`${r.source}\u0000${r.externalId}`);
      return !!r.permitStage && !!seen && seen.size > 0 && !seen.has(r.permitStage);
    });
    // A probe of a FOLLOWER permit (stored as another listing of a project) updates the project's first record: read its stored link.
    if (plan.probes.length && this.on.links !== false) {
      const bySrc = new Map<string, string[]>();
      for (const r of plan.probes) bySrc.set(r.source, [...(bySrc.get(r.source) ?? []), r.externalId]);
      try {
        for (const [source, ids] of bySrc) {
          for (const part of chunks(ids, 200)) {
            const { data, error } = await this.db.from(TABLES.links).select('external_id, root_source, root_external_id').eq('source', source).in('external_id', part);
            if (error) break;
            for (const l of (data ?? []) as Array<{ external_id: string; root_source: string | null; root_external_id: string | null }>) {
              if (l.root_source && l.root_external_id) plan.rootOf.set(l.external_id, { source: l.root_source, externalId: l.root_external_id });
            }
          }
        }
      } catch {
        /* without the link the probe updates the permit's own row, which is still a stored record */
      }
    }
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
          .map((k) => ({ k, id: k.existingId ?? idOf.get(k.row.externalId) }))
          .filter((x): x is { k: ProjectPlan['toLink'][number]; id: number } => typeof x.id === 'number')
          .map(({ k, id }) => ({
            project_key: k.pk.key,
            source: k.row.source,
            external_id: k.row.externalId,
            signal_id: id,
            occurred_at: linkTimeOf(k.row),
            city: k.pk.city,
            lat: k.pk.lat,
            lon: k.pk.lon,
            root_source: k.root?.source ?? null,
            root_external_id: k.root?.externalId ?? null,
          }));
        for (const part of chunks(links)) {
          const { error } = await this.db.from(TABLES.links).upsert(part, { onConflict: 'source,external_id', ignoreDuplicates: true });
          if (error) {
            this.log(`projects: links write skipped: ${error.message.slice(0, 120)}`);
            break;
          }
        }
      }
      // Only followers that were really stored are counted.
      const drops = plan.drops.filter((d) => idOf.has(d.externalId));
      if (drops.length && this.on.drops !== false) {
        const rows = drops.map((d) => ({ source: d.source, external_id: d.externalId, kind: d.kind, of_source: d.ofSource, of_external_id: d.ofExternalId }));
        for (const part of chunks(rows)) {
          const { error } = await this.db.from(TABLES.drops).upsert(part, { onConflict: 'source,external_id', ignoreDuplicates: true });
          if (error) {
            this.off('drops', error);
            break;
          }
          this.on.drops = true;
        }
      }
      const dup = drops.filter((d) => d.kind === 'duplicate').length;
      const cor = drops.length - dup;
      if (dup) this.log(`projects: ${dup} rows are another listing of a project this source already has: stored, no second card`);
      if (cor) this.log(`projects: ${cor} rows corroborate a project from another source: stored, no second card`);
    } catch (e) {
      this.log(`projects: record skipped: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`);
    }
  }

  /**
   * Records new (permit, stage) pairs and returns the stored PROJECT rows that got their ONE stage update in this scan. A follower's stage
   * goes to its project's first record. A row inserted in this scan carries its stage already and is matched as a new card, so it is not
   * returned. `data.permitStage` on the target is the project-level "already updated": a second permit of the project changes nothing.
   */
  async stages(plan: ProjectPlan, inserted: readonly StoredSignal[]): Promise<StoredSignal[]> {
    const events: StoredSignal[] = [];
    try {
      if (!plan.stageHistory || this.on.stages !== true) return events;
      const history = plan.stageHistory;
      const cand = [...plan.rows, ...plan.probes].filter((r) => r.permitStage && !history.get(`${r.source}\u0000${r.externalId}`)?.has(r.permitStage));
      if (cand.length === 0) return events;
      type Sig = StoredSignal & { data?: Record<string, unknown> | null };
      const insertedBy = new Map<string, Sig>(inserted.filter((s) => s.external_id != null).map((s) => [`${s.source}\u0000${s.external_id}`, s as Sig]));
      // Stored rows that were not inserted now (the permit itself, or the first record of its project): read them.
      const need = new Map<string, { source: string; externalId: string }>();
      for (const r of cand) {
        const own = `${r.source}\u0000${r.externalId}`;
        if (!insertedBy.has(own)) need.set(own, { source: r.source, externalId: r.externalId });
        const root = plan.rootOf.get(r.externalId);
        if (root && !insertedBy.has(`${root.source}\u0000${root.externalId}`)) need.set(`${root.source}\u0000${root.externalId}`, root);
      }
      const existing = new Map<string, Sig>();
      const bySource = new Map<string, string[]>();
      for (const n of need.values()) bySource.set(n.source, [...(bySource.get(n.source) ?? []), n.externalId]);
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
          for (const s of (data ?? []) as Sig[]) existing.set(`${source}\u0000${s.external_id}`, s);
        }
      }
      const sigOf = (source: string, externalId: string): { sig: Sig | undefined; fresh: boolean } => {
        const k = `${source}\u0000${externalId}`;
        return insertedBy.has(k) ? { sig: insertedBy.get(k), fresh: true } : { sig: existing.get(k), fresh: false };
      };
      const rows: Array<{ source: string; permit_id: string; stage: PermitStage; signal_id: number; emitted: boolean; first_seen_at: string }> = [];
      type Meta = { stage: PermitStage; target: Sig; targetFresh: boolean; viaRoot: boolean; emitted: boolean; orphan: boolean };
      // emitted: the project's ONE update. A later trigger stage of the same permit (final inspection, then finaled) only refreshes the card line.
      const meta = new Map<string, Meta>();
      for (const r of cand) {
        const own = sigOf(r.source, r.externalId);
        // No stored row (a probe of a permit whose signal was pruned): nothing to update, nothing recorded, nothing announced.
        if (!own.sig || typeof own.sig.id !== 'number') continue;
        let root = plan.rootOf.get(r.externalId);
        let t = root ? sigOf(root.source, root.externalId) : own;
        // A follower whose first record is gone (pruned) stands on its own: its stage goes to itself and it is no longer a follower.
        const orphan = !!root && !t.sig;
        if (orphan) {
          root = undefined;
          t = own;
        }
        const prior = history.get(`${r.source}\u0000${r.externalId}`) ?? new Set<PermitStage>();
        const priorTrigger = [...prior].some((x) => isTriggerStage(x));
        // A permit already stored and never seen before this scan is only a BASELINE (we cannot know when it changed): its stage is
        // recorded, nothing is updated and nothing is emitted. A change needs an earlier recorded stage (probe rows always have one).
        const changed = own.fresh || prior.size > 0;
        const targetStaged = !!t.sig && !t.fresh && isTriggerStage(t.sig.data?.permitStage);
        const stage = r.permitStage as PermitStage;
        const emitted = this.updates && isTriggerStage(stage) && !priorTrigger && changed && !targetStaged;
        // An emitted row names the record that got the update (the project's first record for a follower): the 5-a-day cap
        // (run.ts stageUpdatesToday) counts today's updates through the members' matches on that id, and a follower has none.
        const signalId = emitted && t.sig && typeof t.sig.id === 'number' ? t.sig.id : own.sig.id;
        rows.push({ source: r.source, permit_id: r.externalId, stage, signal_id: signalId, emitted, first_seen_at: this.now.toISOString() });
        // A later trigger stage of an already updated permit only refreshes the card line, and only upward (final inspection never replaces finished).
        const higher = STAGE_RANK[stage] > (isTriggerStage(t.sig?.data?.permitStage) ? STAGE_RANK[t.sig?.data?.permitStage as PermitStage] : 0);
        const lineOnly = this.updates && isTriggerStage(stage) && priorTrigger && !root && !own.fresh && higher;
        if (t.sig && (emitted || lineOnly)) meta.set(`${r.source}\u0000${r.externalId}\u0000${stage}`, { stage, target: t.sig, targetFresh: t.fresh, viaRoot: !!root, emitted, orphan });
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
      const done = new Set<number>();
      for (const [k, m] of meta) {
        // A new card carries its own stage; a project already updated (here or earlier) is not updated again.
        if (!won.has(k) || (m.targetFresh && !m.viaRoot) || done.has(m.target.id)) continue;
        done.add(m.target.id);
        const base = { ...(m.target.data ?? {}) };
        if (m.orphan) delete base.projectOf;
        // permitStageUpdate marks a stage UPDATE of an already stored project: its email and push are written as updates (lib/signals/stage.ts isStageUpdate).
        const data = { ...base, permitStage: m.stage, permitStageAt: at, ...(m.emitted ? { permitStageUpdate: true } : {}) };
        const { error } = await this.db.from('holler_signals').update({ data }).eq('id', m.target.id);
        if (error) {
          this.log(`projects: stage update skipped: ${error.message.slice(0, 120)}`);
          continue;
        }
        if (m.emitted && !m.targetFresh) {
          const st = (typeof data.subtype === 'string' ? data.subtype : null) as string | null;
          events.push({ ...m.target, data: data as StoredSignal['data'], subtype: st } as StoredSignal);
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
      // The status history keeps 400 days (it must outlive the 120 day signal prune, or a pruned permit could be announced twice).
      await this.db.from(TABLES.stages).delete().lt('first_seen_at', new Date(this.now.getTime() - STAGE_HISTORY_DAYS * 86_400_000).toISOString());
    } catch {
      /* best effort */
    }
  }
}

/**
 * Members who already hold a project's card hear about its stage change ONCE: their existing match goes back to "not yet sent" (the
 * email digest reads notified = false, the push reads pushed_at is null), and the card already shows the new stage line. The caller
 * passes only (project, member) pairs of a stage event, and an event happens once per project (holler_permit_stages primary key), so a
 * repeat scan finds nothing to re-send. Only a card still in New is re-armed: a saved, done or dismissed card keeps its sent marks, so
 * moving it back to New later sends no stale "Update" (final review r17 P2-4). Never throws; returns how many members were passed to an
 * update that succeeded (a card not in New among them is left as it is).
 */
export async function rearmStageAlerts(db: Db, pairs: ReadonlyArray<{ signalId: number; userIds: readonly string[] }>, log: (m: string, signalId: number) => void = () => undefined): Promise<number> {
  let n = 0;
  for (const p of pairs) {
    for (const part of chunks([...p.userIds], 200)) {
      try {
        let { error } = await db.from('holler_matches').update({ notified: false, pushed_at: null }).eq('signal_id', p.signalId).eq('status', 'new').in('user_id', part);
        // Before migration 0020 there is no pushed_at column and no push can have been sent.
        if (error && /pushed_at/i.test(error.message ?? '')) ({ error } = await db.from('holler_matches').update({ notified: false }).eq('signal_id', p.signalId).eq('status', 'new').in('user_id', part));
        if (error) log(`projects: stage alert re-send skipped: ${error.message.slice(0, 120)}`, p.signalId);
        else n += part.length;
      } catch (e) {
        log(`projects: stage alert re-send skipped: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`, p.signalId);
      }
    }
  }
  return n;
}
