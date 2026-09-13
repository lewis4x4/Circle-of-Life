import type { OperationsActor } from "./auth";
import { readAllOperationRows } from "./read-all";
import { activityCatalog, parseActivityCatalog } from "./activity-catalog";
import { buildFacilityProfile, type FacilityProfileReply, type ProfileConfiguration, type ProfileRequirement } from "./facility-profile";

export async function readFacilityProfile(actor: OperationsActor, facilityId: string, now: Date): Promise<FacilityProfileReply | null> {
  const client = actor.currentActor.client;
  const facility = await client.from("facilities").select("id,name,organization_id,entity_id,timezone").eq("organization_id", actor.organizationId).eq("id", facilityId).is("deleted_at", null).maybeSingle();
  if (facility.error) throw new Error("Facility identity unavailable");
  if (!facility.data) return null;
  const entity = await client.from("entities").select("id,name").eq("organization_id", actor.organizationId).eq("id", facility.data.entity_id).is("deleted_at", null).maybeSingle();
  if (entity.error || !entity.data) throw new Error("Facility entity identity unavailable");
  // The bundled catalog defines the intake contract, not permission to reveal
  // another organization's source. Read actual scoped payloads (including
  // reviewed staging redactions) and reconcile every persisted mapping.
  const sources = await readAllOperationRows<{ id: string; organization_id: string; source_item_id: string; source_file: string; source_sha256: string; source_payload: unknown }>(() => client.from("operation_activity_source_items" as never)
    .select("id,organization_id,source_item_id,source_file,source_sha256,source_payload").eq("organization_id", actor.organizationId).eq("intake_version", activityCatalog.catalogKey).order("id", { ascending: true }));
  const sourceRows = sources.data ?? [];
  if (sources.error || sourceRows.length !== activityCatalog.entries.length || sourceRows.some(row => row.organization_id !== actor.organizationId || row.source_sha256 !== activityCatalog.source.sha256)) throw new Error("Complete authorized profile source unavailable");
  if (sourceRows.some(row => !row.source_payload || typeof row.source_payload !== "object" || (row.source_payload as Record<string, unknown>).sourceId !== row.source_item_id) || new Set(sourceRows.map(row => row.source_file)).size !== 1) throw new Error("Profile source identities changed");
  const bySource = new Map(sourceRows.map(row => [row.source_item_id, row]));
  if (bySource.size !== sourceRows.length) throw new Error("Duplicate profile source identities");
  const catalog = parseActivityCatalog({ ...activityCatalog, source: { ...activityCatalog.source, name: sourceRows[0].source_file }, entries: activityCatalog.entries.map(entry => bySource.get(entry.sourceId)?.source_payload) });
  const mappings = await readAllOperationRows<{ id: string; organization_id: string; source_item_id: string; activity_id: string }>(() => client.from("operation_activity_source_mappings" as never)
    .select("id,organization_id,source_item_id,activity_id").eq("organization_id", actor.organizationId).in("source_item_id", sourceRows.map(row => row.id)).order("id", { ascending: true }));
  const expected = new Set(catalog.entries.flatMap(entry => entry.components.map(component => `${bySource.get(entry.sourceId)!.id}:${component.id}`)));
  const actual = new Set((mappings.data ?? []).map(row => `${row.source_item_id}:${row.activity_id}`));
  if (mappings.error || mappings.data?.length !== expected.size || actual.size !== expected.size || [...actual].some(key => !expected.has(key)) || mappings.data.some(row => row.organization_id !== actor.organizationId)) throw new Error("Profile source mappings are incomplete");
  const [configs, requirements] = await Promise.all([
    readAllOperationRows<ProfileConfiguration>(() => client.from("operation_facility_requirements" as never).select("id,facility_id,activity_id,requirement_version_id,version,status,effective_from,effective_to,applicability,applicability_reason,override_source,approved_by,approved_at,local_required_evidence,local_allowed_recorder_roles,owner_user_id,owner_role,backup_user_id,backup_role,local_procedure,schedule_status,schedule_rule").eq("organization_id", actor.organizationId).eq("facility_id", facilityId).order("id", { ascending: true })),
    readAllOperationRows<ProfileRequirement>(() => client.from("operation_requirement_versions" as never).select("id,activity_id,version,status,effective_from,effective_to,source_authority,published_by,published_at,required_evidence,allowed_recorder_roles,procedure").eq("organization_id", actor.organizationId).order("id", { ascending: true })),
  ]);
  if (configs.error || requirements.error) throw new Error("Profile configuration unavailable; retry the complete read");
  return buildFacilityProfile({ ...facility.data, entity_name: entity.data.name }, configs.data ?? [], requirements.data ?? [], now, actor.appRole === "owner" || actor.appRole === "org_admin", catalog);
}
