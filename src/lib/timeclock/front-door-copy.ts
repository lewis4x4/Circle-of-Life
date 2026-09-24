/** One clock (spec 40 §1) operator copy. Client-safe: shared by the notice and the refusing route. */
export const FRONT_DOOR_CLOCK_COPY = {
  title: "Clock in at the front door",
  body: "This building uses the front-door kiosk. Clock in and out there.",
  refusal: "Clock in at the front door.",
} as const;
