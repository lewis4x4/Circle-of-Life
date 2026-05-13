import type { ModulePromoter, ModuleValues, PromotionContext, PromotionResult } from "./_types.ts";
import {
  asArray,
  asInteger,
  asRecord,
  asString,
  bedLabel,
  compactTables,
  insertPromotionLink,
  isMeaningful,
  moduleValueId,
  normalizeFloor,
  normalizeUnitName,
  roomTypeFromUnitType,
  tableCount,
  valuesDiffer,
} from "./_helpers.ts";

function roomNumber(room: Record<string, unknown>): string | null {
  return asString(room.roomNumber ?? room.room_number ?? room.name);
}

function roomMetadata(room: Record<string, unknown>): Record<string, unknown> {
  return {
    facility_launch: {
      source_room_id: room.id ?? null,
      wing: room.wing ?? null,
      unit_type: room.unitType ?? null,
      care_designation: room.careDesignation ?? null,
      source_status: room.status ?? null,
    },
  };
}

function payloadDiffers(existing: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  return Object.entries(payload).some(([key, value]) => valuesDiffer(existing[key], value));
}

async function findUnit(ctx: PromotionContext, name: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await ctx.admin
    .from("units")
    .select("*")
    .eq("facility_id", ctx.facility_id)
    .eq("organization_id", ctx.organization_id)
    .eq("name", name)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`M3 unit lookup failed for ${name}: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function findRoom(ctx: PromotionContext, number: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await ctx.admin
    .from("rooms")
    .select("*")
    .eq("facility_id", ctx.facility_id)
    .eq("organization_id", ctx.organization_id)
    .eq("room_number", number)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`M3 room lookup failed for ${number}: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function findBed(ctx: PromotionContext, roomId: string, label: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await ctx.admin
    .from("beds")
    .select("*")
    .eq("room_id", roomId)
    .eq("bed_label", label)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`M3 bed lookup failed for ${roomId}/${label}: ${error.message}`);
  return data as Record<string, unknown> | null;
}

export const M3_PROMOTER: ModulePromoter = {
  moduleCode: "M3",
  description: "Promote room and bed inventory into units, rooms, and beds.",
  prerequisites: ["facility"],
  canPromote(values: ModuleValues) {
    return { ready: asArray(values.rooms).length > 0, missing: asArray(values.rooms).length > 0 ? [] : ["rooms"] };
  },
  async promote(ctx: PromotionContext, values: ModuleValues): Promise<PromotionResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const rawRooms = asArray(values.rooms).map(asRecord).filter((room) => roomNumber(room));
    if (rawRooms.length === 0) {
      return {
        module_code: "M3",
        status: "skipped",
        summary: "No valid rooms found in intake.",
        tables_touched: compactTables([tableCount("units"), tableCount("rooms"), tableCount("beds")]),
        warnings,
        errors,
        prerequisites_unmet: ["rooms"],
      };
    }

    const moduleRoomsValueId = moduleValueId(ctx, "rooms");
    const unitsByName = new Map<string, { floor: number; roomCount: number }>();
    for (const room of rawRooms) {
      const name = normalizeUnitName(room);
      const existing = unitsByName.get(name) ?? { floor: normalizeFloor(room.floor), roomCount: 0 };
      existing.floor = Math.min(existing.floor, normalizeFloor(room.floor));
      existing.roomCount += 1;
      unitsByName.set(name, existing);
    }

    let unitsCreated = 0;
    let unitsUpdated = 0;
    let unitsNoop = 0;
    const unitIds = new Map<string, string>();
    let unitSort = 0;
    for (const [name, unit] of unitsByName) {
      const existing = await findUnit(ctx, name);
      const payload = {
        facility_id: ctx.facility_id,
        organization_id: ctx.organization_id,
        name,
        floor_number: unit.floor,
        sort_order: unitSort++,
      };
      if (!existing) {
        if (ctx.dry_run) {
          unitsCreated += 1;
          unitIds.set(name, `dry-run-unit-${name}`);
        } else {
          const { data, error } = await ctx.admin.from("units").insert({
            ...payload,
            created_by: ctx.actor_user_id,
            updated_by: ctx.actor_user_id,
          }).select("id").single();
          if (error || !data?.id) throw new Error(`M3 unit insert failed for ${name}: ${error?.message ?? "missing id"}`);
          unitsCreated += 1;
          unitIds.set(name, String(data.id));
          await insertPromotionLink(ctx, {
            target_table: "units",
            target_row_id: String(data.id),
            action: "insert",
            before_value: null,
            after_value: payload,
            module_value_id: moduleRoomsValueId,
          });
        }
      } else {
        unitIds.set(name, String(existing.id));
        if (payloadDiffers(existing, { floor_number: payload.floor_number, sort_order: payload.sort_order })) {
          warnings.push(`unit '${name}' already exists with differing operational values; intake values were skipped to avoid overwriting live data.`);
          unitsNoop += 1;
        } else {
          unitsNoop += 1;
        }
      }
    }

    let roomsCreated = 0;
    let roomsUpdated = 0;
    let roomsNoop = 0;
    let bedsCreated = 0;
    let bedsUpdated = 0;
    let bedsNoop = 0;

    for (let index = 0; index < rawRooms.length; index++) {
      const sourceRoom = rawRooms[index];
      const number = roomNumber(sourceRoom)!;
      const bedCount = Math.max(1, asInteger(sourceRoom.bedCount) ?? 1);
      const unitName = normalizeUnitName(sourceRoom);
      const unitId = unitIds.get(unitName);
      const roomPayload = {
        facility_id: ctx.facility_id,
        organization_id: ctx.organization_id,
        unit_id: unitId,
        room_number: number,
        room_type: roomTypeFromUnitType(sourceRoom.unitType, bedCount),
        max_occupancy: bedCount,
        floor_number: normalizeFloor(sourceRoom.floor),
        sort_order: index,
        launch_profile_metadata: roomMetadata(sourceRoom),
      };

      const existingRoom = await findRoom(ctx, number);
      let roomId: string;
      if (!existingRoom) {
        if (ctx.dry_run) {
          roomsCreated += 1;
          roomId = `dry-run-room-${number}`;
        } else {
          const { data, error } = await ctx.admin.from("rooms").insert({
            ...roomPayload,
            created_by: ctx.actor_user_id,
            updated_by: ctx.actor_user_id,
          }).select("id").single();
          if (error || !data?.id) throw new Error(`M3 room insert failed for ${number}: ${error?.message ?? "missing id"}`);
          roomsCreated += 1;
          roomId = String(data.id);
          await insertPromotionLink(ctx, {
            target_table: "rooms",
            target_row_id: roomId,
            action: "insert",
            before_value: null,
            after_value: roomPayload,
            module_value_id: moduleRoomsValueId,
          });
        }
      } else {
        roomId = String(existingRoom.id);
        if (payloadDiffers(existingRoom, roomPayload)) {
          warnings.push(`room '${number}' already exists with differing operational values; intake values were skipped to avoid overwriting live data.`);
          roomsNoop += 1;
        } else {
          roomsNoop += 1;
        }
      }

      for (let bedIndex = 0; bedIndex < bedCount; bedIndex++) {
        const label = bedLabel(bedIndex);
        const existingBed = ctx.dry_run && roomId.startsWith("dry-run-room-") ? null : await findBed(ctx, roomId, label);
        const bedPayload = {
          room_id: roomId,
          facility_id: ctx.facility_id,
          organization_id: ctx.organization_id,
          bed_label: label,
          bed_type: "alf_intermediate",
          status: "available",
        };
        if (!existingBed) {
          if (ctx.dry_run) {
            bedsCreated += 1;
          } else {
            const { data, error } = await ctx.admin.from("beds").insert({
              ...bedPayload,
              created_by: ctx.actor_user_id,
              updated_by: ctx.actor_user_id,
            }).select("id").single();
            if (error || !data?.id) throw new Error(`M3 bed insert failed for ${number}/${label}: ${error?.message ?? "missing id"}`);
            bedsCreated += 1;
            await insertPromotionLink(ctx, {
              target_table: "beds",
              target_row_id: String(data.id),
              action: "insert",
              before_value: null,
              after_value: bedPayload,
              module_value_id: moduleRoomsValueId,
            });
          }
        } else if (payloadDiffers(existingBed, { bed_type: bedPayload.bed_type })) {
          warnings.push(`bed '${number}/${label}' already exists with differing operational values; intake values were skipped to avoid overwriting live data.`);
          bedsNoop += 1;
        } else {
          bedsNoop += 1;
        }
      }
    }

    const writes = unitsCreated + unitsUpdated + roomsCreated + roomsUpdated + bedsCreated + bedsUpdated;
    return {
      module_code: "M3",
      status: warnings.length > 0 && writes === 0 ? "partial" : "promoted",
      summary: writes > 0
        ? `Promoted ${unitsCreated + unitsUpdated} unit(s), ${roomsCreated + roomsUpdated} room(s), ${bedsCreated + bedsUpdated} bed(s).`
        : "Units, rooms, and beds already current.",
      tables_touched: compactTables([
        tableCount("units", unitsCreated, unitsUpdated, unitsNoop),
        tableCount("rooms", roomsCreated, roomsUpdated, roomsNoop),
        tableCount("beds", bedsCreated, bedsUpdated, bedsNoop),
      ]),
      warnings,
      errors,
      prerequisites_unmet: [],
    };
  },
};
