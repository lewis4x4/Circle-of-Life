import type { ModulePromoter, ModuleValues, PromotionContext, PromotionResult } from "./_types.ts";
import {
  asArray,
  asInteger,
  asRecord,
  asString,
  bedLabel,
  compactTables,
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
    const unitsByName = new Map<string, { floor: number; roomCount: number; sort_order: number }>();
    const normalizedRooms = rawRooms.map((sourceRoom, index) => {
      const number = roomNumber(sourceRoom)!;
      const bedCount = Math.max(1, asInteger(sourceRoom.bedCount) ?? 1);
      const unitName = normalizeUnitName(sourceRoom);
      const normalized = {
        sourceRoom,
        number,
        bedCount,
        unitName,
        roomPayload: {
          room_number: number,
          unit_name: unitName,
          room_type: roomTypeFromUnitType(sourceRoom.unitType, bedCount),
          max_occupancy: bedCount,
          floor_number: normalizeFloor(sourceRoom.floor),
          sort_order: index,
          launch_profile_metadata: roomMetadata(sourceRoom),
        },
      };

      const existing = unitsByName.get(unitName) ?? { floor: normalizeFloor(sourceRoom.floor), roomCount: 0, sort_order: unitsByName.size };
      existing.floor = Math.min(existing.floor, normalizeFloor(sourceRoom.floor));
      existing.roomCount += 1;
      unitsByName.set(unitName, existing);
      return normalized;
    });

    const normalizedUnits = Array.from(unitsByName.entries()).map(([name, unit]) => ({
      name,
      floor_number: unit.floor,
      sort_order: unit.sort_order,
    }));

    const normalizedBeds = normalizedRooms.flatMap((room) =>
      Array.from({ length: room.bedCount }, (_, bedIndex) => ({
        room_number: room.number,
        bed_label: bedLabel(bedIndex),
        bed_type: "alf_intermediate",
        status: "available",
      }))
    );

    if (!ctx.dry_run) {
      const { data, error } = await ctx.admin.rpc("promote_facility_launch_m3", {
        p_organization_id: ctx.organization_id,
        p_facility_id: ctx.facility_id,
        p_actor_user_id: ctx.actor_user_id,
        p_run_item_id: ctx.run_item_id,
        p_module_value_id: moduleRoomsValueId,
        p_units: normalizedUnits,
        p_rooms: normalizedRooms.map((room) => room.roomPayload),
        p_beds: normalizedBeds,
      });
      if (error) throw new Error(`M3 RPC failed: ${error.message}`);

      const rpc = asRecord(data);
      const unitsCreated = asInteger(rpc.units_created) ?? 0;
      const unitsNoop = asInteger(rpc.units_noop) ?? 0;
      const roomsCreated = asInteger(rpc.rooms_created) ?? 0;
      const roomsNoop = asInteger(rpc.rooms_noop) ?? 0;
      const bedsCreated = asInteger(rpc.beds_created) ?? 0;
      const bedsNoop = asInteger(rpc.beds_noop) ?? 0;
      warnings.push(...asArray(rpc.warnings).map((warning) => String(warning)));

      const writes = unitsCreated + roomsCreated + bedsCreated;
      return {
        module_code: "M3",
        status: warnings.length > 0 && writes === 0 ? "partial" : "promoted",
        summary: writes > 0
          ? `Promoted ${unitsCreated} unit(s), ${roomsCreated} room(s), ${bedsCreated} bed(s).`
          : "Units, rooms, and beds already current.",
        tables_touched: compactTables([
          tableCount("units", unitsCreated, 0, unitsNoop),
          tableCount("rooms", roomsCreated, 0, roomsNoop),
          tableCount("beds", bedsCreated, 0, bedsNoop),
        ]),
        warnings,
        errors,
        prerequisites_unmet: [],
      };
    }

    let unitsCreated = 0;
    let unitsNoop = 0;
    const unitIds = new Map<string, string>();
    for (const unit of normalizedUnits) {
      const existing = await findUnit(ctx, unit.name);
      if (!existing) {
        unitsCreated += 1;
        unitIds.set(unit.name, `dry-run-unit-${unit.name}`);
      } else {
        unitIds.set(unit.name, String(existing.id));
        if (payloadDiffers(existing, { floor_number: unit.floor_number, sort_order: unit.sort_order })) {
          warnings.push(`unit '${unit.name}' already exists with differing operational values; intake values were skipped to avoid overwriting live data.`);
        }
        unitsNoop += 1;
      }
    }

    let roomsCreated = 0;
    let roomsNoop = 0;
    let bedsCreated = 0;
    let bedsNoop = 0;

    for (const room of normalizedRooms) {
      const unitId = unitIds.get(room.unitName);
      const existingRoom = await findRoom(ctx, room.number);
      let roomId: string;
      const roomPayload = {
        facility_id: ctx.facility_id,
        organization_id: ctx.organization_id,
        unit_id: unitId,
        room_number: room.roomPayload.room_number,
        room_type: room.roomPayload.room_type,
        max_occupancy: room.roomPayload.max_occupancy,
        floor_number: room.roomPayload.floor_number,
        sort_order: room.roomPayload.sort_order,
        launch_profile_metadata: room.roomPayload.launch_profile_metadata,
      };

      if (!existingRoom) {
        roomsCreated += 1;
        roomId = `dry-run-room-${room.number}`;
      } else {
        roomId = String(existingRoom.id);
        if (payloadDiffers(existingRoom, roomPayload)) {
          warnings.push(`room '${room.number}' already exists with differing operational values; intake values were skipped to avoid overwriting live data.`);
        }
        roomsNoop += 1;
      }

      for (let bedIndex = 0; bedIndex < room.bedCount; bedIndex++) {
        const label = bedLabel(bedIndex);
        const existingBed = roomId.startsWith("dry-run-room-") ? null : await findBed(ctx, roomId, label);
        if (!existingBed) {
          bedsCreated += 1;
        } else if (payloadDiffers(existingBed, { bed_type: "alf_intermediate" })) {
          warnings.push(`bed '${room.number}/${label}' already exists with differing operational values; intake values were skipped to avoid overwriting live data.`);
          bedsNoop += 1;
        } else {
          bedsNoop += 1;
        }
      }
    }

    const writes = unitsCreated + roomsCreated + bedsCreated;
    return {
      module_code: "M3",
      status: warnings.length > 0 && writes === 0 ? "partial" : "promoted",
      summary: writes > 0
        ? `Promoted ${unitsCreated} unit(s), ${roomsCreated} room(s), ${bedsCreated} bed(s).`
        : "Units, rooms, and beds already current.",
      tables_touched: compactTables([
        tableCount("units", unitsCreated, 0, unitsNoop),
        tableCount("rooms", roomsCreated, 0, roomsNoop),
        tableCount("beds", bedsCreated, 0, bedsNoop),
      ]),
      warnings,
      errors,
      prerequisites_unmet: [],
    };
  },
};
