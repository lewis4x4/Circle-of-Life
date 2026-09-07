const USER_FUNCTIONS = [
  "boldsign-send-contract",
  "document-admin",
  "exec-nlq-executor",
  "exec-report-generator",
  "exec-scenario-solver",
  "facility-launch-parser",
  "facility-launch-import",
  "facility-launch-promote",
  "grace-execute-flow-step",
  "grace-orchestrator",
  "grace-transcribe",
  "grace-tts",
  "grace-undo-flow-run",
  "ingest",
  "knowledge-agent",
  "haven-ai-router",
] as const;

function repoUrl(relativePath: string): URL {
  return new URL(`../../../${relativePath}`, import.meta.url);
}

function handlerSlice(functionName: string, source: string): string {
  const marker = functionName === "facility-launch-promote"
    ? "export function createHandler"
    : functionName === "boldsign-send-contract"
    ? "export async function handleBoldSignSend"
    : functionName === "haven-ai-router"
    ? "export async function handleRequest"
    : functionName === "knowledge-agent"
    ? "export async function handleKnowledgeRequest"
    : functionName === "grace-transcribe"
    ? "export async function handleGraceTranscribe"
    : functionName === "grace-tts"
    ? "export async function handleGraceTts"
    : "Deno.serve";
  const index = source.indexOf(marker);
  if (index < 0) throw new Error(`${functionName} handler marker missing`);
  return source.slice(index);
}

function serviceKeyAliases(source: string): string[] {
  const aliases = new Set(["SUPABASE_SERVICE_ROLE_KEY"]);
  const declaration =
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*Deno\.env\.get\(["']SUPABASE_SERVICE_ROLE_KEY["']\)/g;
  for (const match of source.matchAll(declaration)) aliases.add(match[1]!);
  return [...aliases];
}

Deno.test("user Edge functions resolve current actor before constructing a service client", async () => {
  for (const functionName of USER_FUNCTIONS) {
    const source = await Deno.readTextFile(
      repoUrl(`supabase/functions/${functionName}/index.ts`),
    );
    const handler = handlerSlice(functionName, source);
    const directGuardIndex = handler.indexOf("requireCurrentActor");
    const injectedGuardIndex = handler.indexOf(
      "actorAuth = await authorizeActor(req)",
    );
    const guardIndex = directGuardIndex >= 0
      ? directGuardIndex
      : injectedGuardIndex;
    if (guardIndex < 0) {
      throw new Error(`${functionName} does not use the current actor guard`);
    }
    const aliasPattern = serviceKeyAliases(source)
      .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const directServiceClient = new RegExp(
      `createClient\\s*\\([^,]+,\\s*(?:${aliasPattern})\\b`,
      "g",
    ).exec(handler);
    const injectedServiceClientIndex = handler.indexOf(
      "admin = adminFactory()",
    );
    const serviceClientIndex = directServiceClient?.index ??
      injectedServiceClientIndex;
    if (serviceClientIndex >= 0 && serviceClientIndex < guardIndex) {
      throw new Error(`${functionName} constructs service client before guard`);
    }
    if (
      source.includes("admin.auth.getUser") ||
      source.includes('.from("user_profiles")')
    ) {
      throw new Error(
        `${functionName} retains stale service-role auth/profile lookup`,
      );
    }
  }
});

Deno.test("router provider modules carry explicit live authorization contracts", async () => {
  for (
    const relativePath of [
      "supabase/functions/_shared/router-intent.ts",
      "supabase/functions/_shared/router-dispatch.ts",
      "supabase/functions/haven-ai-router/tools.ts",
    ]
  ) {
    const source = await Deno.readTextFile(repoUrl(relativePath));
    if (
      !source.includes("revalidate") || !source.includes("CurrentActorError")
    ) {
      throw new Error(
        `${relativePath} can swallow or bypass current authority`,
      );
    }
  }
});

Deno.test("user and machine Edge endpoint modes remain explicit and separate", async () => {
  const config = await Deno.readTextFile(repoUrl("supabase/config.toml"));
  for (const functionName of USER_FUNCTIONS) {
    const block = new RegExp(
      `\\[functions\\.(?:"${functionName}"|${functionName})\\]\\s+verify_jwt = true`,
    );
    if (!block.test(config)) {
      throw new Error(`${functionName} is not explicitly verify_jwt=true`);
    }
  }

  for (
    const functionName of [
      "dispatch-push",
      "report-scheduler",
      "ar-aging-check",
      "boldsign-webhook",
    ]
  ) {
    const block = new RegExp(
      `\\[functions\\.(?:"${functionName}"|${functionName})\\]\\s+verify_jwt = false`,
    );
    if (!block.test(config)) {
      throw new Error(`${functionName} lost its explicit machine/webhook mode`);
    }
  }
});

Deno.test("provider endpoints use provider-aware sanitized rejection handling", async () => {
  for (
    const functionName of [
      "boldsign-send-contract",
      "grace-transcribe",
      "grace-tts",
    ]
  ) {
    const source = await Deno.readTextFile(
      repoUrl(`supabase/functions/${functionName}/index.ts`),
    );
    if (!source.includes("currentActorOrProviderErrorResponse")) {
      throw new Error(`${functionName} can misreport rejected fetch as auth`);
    }
  }
});
