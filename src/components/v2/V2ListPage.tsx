import { notFound } from "next/navigation";

import { uiV2 } from "@/lib/flags";
import { loadV2List, type V2ListId } from "@/lib/v2-lists";

import { W2ListClient } from "./W2ListClient";

export async function V2ListPage({ listId }: { listId: V2ListId }) {
  if (!uiV2()) notFound();
  const load = await loadV2List(listId);
  return (
    <W2ListClient
      listId={load.listId}
      rows={load.rows}
      source={load.source}
      generatedAt={load.generatedAt}
    />
  );
}
