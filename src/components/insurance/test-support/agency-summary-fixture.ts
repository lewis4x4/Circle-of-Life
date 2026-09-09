import type { AgencySummaryResponse } from "../agency-summary-contract";
export function agencySummaryFixture(ttlMs = 60_000): AgencySummaryResponse {
  const now = Date.now();
  return {
    live_connection_enabled: false,
    read_at: new Date(now).toISOString(),
    connections: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Synthetic agency connection",
        provider_instance: "InsureFlow synthetic source",
        source_integration_id: "22222222-2222-4222-8222-222222222222",
        mode: "synthetic",
        enabled: true,
        state: "healthy",
        revision: 1,
        last_authorization_check_at: new Date(now - 1000).toISOString(),
        authorization_valid_until: new Date(now + ttlMs).toISOString(),
        incomplete_summary_count: 0,
        summaries: [
          {
            source_policy_id: "33333333-3333-4333-8333-333333333333",
            release_id: "44444444-4444-4444-8444-444444444444",
            source_sequence: "9007199254740993",
            source_released_at: new Date(now - 10000).toISOString(),
            received_at: new Date(now - 2000).toISOString(),
            mapped_entity_id: "55555555-5555-4555-8555-555555555555",
            mapped_entity_name: "Synthetic mapped entity",
            summary: {
              policy_number: "IF-SYN-42",
              carrier: "Synthetic source carrier",
              line_of_business: "Commercial package",
              named_insured: "Synthetic source insured wording",
              effective_date: "2026-01-01",
              expiration_date: "2027-01-01",
              premium: 90000.75,
              status: "source descriptive status",
            },
          },
        ],
      },
    ],
  };
}
