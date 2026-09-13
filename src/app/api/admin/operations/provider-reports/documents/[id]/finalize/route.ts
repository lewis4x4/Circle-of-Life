import { finalizeProviderDocument } from "@/lib/operations/provider-report-documents";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return finalizeProviderDocument(request,(await params).id);}
