"use client";

import { useRef, useState } from "react";
import { publicReferralSchema, PUBLIC_REFERRAL_RETRY_MESSAGE, PublicReferralSubmissionError, submitPublicReferral, type PublicReferral } from "./public-referral";

type PublicReferralDraft = Omit<Extract<PublicReferral, { kind: "inquiry" }>, "requestKey"> | Omit<Extract<PublicReferral, { kind: "tour" }>, "requestKey">;

export function usePublicReferral() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const requestKey = useRef<string | null>(null);

  async function submit(draft: PublicReferralDraft): Promise<boolean> {
    if (inFlight.current) return false;
    // An uncertain response may already have committed. Keep its identity even
    // after edits so the database can reject changed content without duplicating.
    requestKey.current ??= crypto.randomUUID();
    const parsed = publicReferralSchema.safeParse({ ...draft, requestKey: requestKey.current });
    if (!parsed.success) {
      setError("Check your name, phone, email and request details, then try again.");
      return false;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await submitPublicReferral(parsed.data);
      requestKey.current = null;
      return true;
    } catch (failure) {
      setError(failure instanceof PublicReferralSubmissionError ? failure.message : PUBLIC_REFERRAL_RETRY_MESSAGE);
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { submit, pending, error };
}
