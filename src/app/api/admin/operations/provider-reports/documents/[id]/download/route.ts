import { downloadProviderDocument } from "@/lib/operations/provider-report-documents";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return downloadProviderDocument(request,(await params).id);}
