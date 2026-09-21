import { z } from "zod";

export const PUBLIC_TOUR_TIMES = [
  "10:00 AM (Morning Coffee & Porch)",
  "11:30 AM (Lunch with Residents Included)",
  "02:00 PM (Afternoon Activities & Tea)",
  "04:30 PM (Evening Tour)",
  "Saturday 11:00 AM (Weekend Family Tour)",
] as const;

const common = {
  requestKey: z.string().uuid(),
  facility: z.enum(["plantation", "grande-cypress", "rising-oaks", "oakridge", "homewood"]),
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(7).max(40).regex(/^[+\d\s().-]+$/).refine((value) => value.replace(/\D/g, "").length >= 7),
  email: z.string().trim().email().max(254),
};

export const publicReferralSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("inquiry"), message: z.string().trim().min(1).max(4000) }).strict(),
  z.object({
    ...common,
    kind: z.literal("tour"),
    tourDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
      const date = new Date(`${value}T12:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }),
    tourTime: z.enum(PUBLIC_TOUR_TIMES),
    lunchOption: z.enum(["yes-2", "coffee", "tour-only"]),
  }).strict(),
]);

export type PublicReferral = z.infer<typeof publicReferralSchema>;

export const PUBLIC_REFERRAL_RETRY_MESSAGE = "We could not confirm receipt. Your details are still here. Please try again; retrying the same request will not create a duplicate. You can also call the community directly.";

export class PublicReferralSubmissionError extends Error {}

/** The caller retains this key for an unchanged retry, including a lost response. */
export async function submitPublicReferral(payload: PublicReferral): Promise<void> {
  const response = await fetch("/api/public/referrals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const message = response.status === 403
      ? "This community cannot receive your online request right now. Your details are still here. Please call the community directly."
      : response.status === 400
        ? "Check your name, phone, email and request details, then try again."
        : response.status === 409
          ? "This request changed after it was sent. Please contact the community to confirm receipt before sending a new request."
          : response.status === 429
            ? "Too many requests. Please wait ten minutes before trying again, or call the community directly. Your details are still here."
            : PUBLIC_REFERRAL_RETRY_MESSAGE;
    throw new PublicReferralSubmissionError(message);
  }
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("received" in result) || result.received !== true) {
    throw new Error(PUBLIC_REFERRAL_RETRY_MESSAGE);
  }
}
