export const runtime = "nodejs";

import { handleAgentMailWebhook } from "@/lib/inbound-mail/webhook";

export async function POST(request: Request) {
  return handleAgentMailWebhook(request, { secret: process.env.AGENTMAIL_WEBHOOK_SECRET, apiKey: process.env.AGENTMAIL_API_KEY });
}
