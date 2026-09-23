import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ResidentWithRoom } from "@/lib/caregiver/facility-residents";

import { ResidentAdlCard } from "./ResidentAdlCard";

const resident = (id: string, displayName: string) => ({ id, displayName, roomLabel: "101" }) as unknown as ResidentWithRoom;

describe("ResidentAdlCard labels (COL-658)", () => {
  it("names each card's selects and keeps ids unique across the floor list", () => {
    render(
      <>
        <ResidentAdlCard resident={resident("a", "Resident A")} passesToday={0} busy={false} onSubmit={async () => true} />
        <ResidentAdlCard resident={resident("b", "Resident B")} passesToday={0} busy={false} onSubmit={async () => true} />
      </>,
    );
    const adlTypes = screen.getAllByLabelText("ADL Type");
    const assistance = screen.getAllByLabelText("Assistance");
    expect(adlTypes).toHaveLength(2);
    expect(assistance).toHaveLength(2);
    expect(new Set([...adlTypes, ...assistance].map((el) => el.id)).size).toBe(4);
  });
});
