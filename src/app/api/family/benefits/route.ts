import { listFamilyBenefits } from "@/lib/benefits/family-server";
import { benefitsFailure } from "@/lib/benefits/server";
export async function GET() { try { return await listFamilyBenefits(); } catch { return benefitsFailure(); } }
