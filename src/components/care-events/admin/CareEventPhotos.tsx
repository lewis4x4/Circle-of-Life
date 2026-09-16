"use client";

import { ImageOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PHOTO_UNAVAILABLE_LINE } from "@/lib/care-events/admin-copy";
import { signCareEventPhotos, type SignedPhoto } from "@/lib/care-events/admin-data";
import { createClient } from "@/lib/supabase/client";

type PhotoState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; photos: SignedPhoto[] };

/** Thumbnails from care_events.answers.attachments through short-lived signed URLs. */
export function CareEventPhotos({ paths }: { paths: readonly string[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<PhotoState>({ kind: "idle" });
  const key = paths.join("|");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const wanted = key.split("|");
    void signCareEventPhotos(supabase, wanted).then((photos) => {
      if (!cancelled) setState({ kind: "ready", photos });
    });
    return () => {
      cancelled = true;
    };
  }, [key, supabase]);

  if (paths.length === 0) return null;

  if (state.kind !== "ready") {
    return (
      <div className="flex gap-2" aria-busy="true" aria-label="Loading photos">
        {paths.map((path) => (
          <div key={path} className="size-20 animate-pulse rounded-[var(--radius)] bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Photos">
      {state.photos.map((photo, index) =>
        photo.url ? (
          <li key={photo.path}>
            <a href={photo.url} target="_blank" rel="noreferrer" className="block rounded-[var(--radius)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed URL with a 5 minute life; next/image cannot optimize it */}
              <img
                src={photo.url}
                alt={`Photo ${index + 1} from the report`}
                className="size-20 rounded-[var(--radius)] border border-border object-cover"
              />
            </a>
          </li>
        ) : (
          <li
            key={photo.path}
            className="flex size-20 flex-col items-center justify-center gap-1 rounded-[var(--radius)] border border-dashed border-border text-center text-muted-foreground"
          >
            <ImageOff className="size-4" aria-hidden />
            <span className="text-[11px] leading-tight">{PHOTO_UNAVAILABLE_LINE}</span>
          </li>
        ),
      )}
    </ul>
  );
}
