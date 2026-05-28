import { notFound } from "next/navigation";

import { uiV2 } from "@/lib/flags";
import { loadV2List, type V2ListId } from "@/lib/v2-lists";
import type { V2PaginationInput } from "@/lib/v2-pagination";

import { W2ListClient } from "./W2ListClient";

export async function V2ListPage({
  listId,
  searchParams,
}: {
  listId: V2ListId;
  searchParams?: Promise<V2PaginationInput> | V2PaginationInput;
}) {
  if (!uiV2()) notFound();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const load = await loadV2List(listId, resolvedSearchParams);
  return (
    <W2ListClient
      listId={load.listId}
      rows={load.rows}
      source={load.source}
      generatedAt={load.generatedAt}
      pagination={load.pagination}
    />
  );
}
