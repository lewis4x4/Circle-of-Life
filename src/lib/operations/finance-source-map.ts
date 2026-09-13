import catalog from "./activity-catalog.json";
import type { FinanceSourceFamily } from "./finance-sources";
const sourceIds = "AL-D04 AL-D17 AL-D19 AL-W08 AL-M07 AL-M09 AL-M12 AL-A09 AL-Q01 AL-N06 AL-N07 AL-N08 AL-N09 AL-C01 AL-C02 AL-C03 AL-C04 AL-C05 AL-C06 AL-C07 AL-C08 AL-C09".split(" ");
const familyMap: Record<string, FinanceSourceFamily[]> = {
  "hfo-al-d04-01": ["payments"], "hfo-al-d17-01": ["census"], "hfo-al-d19-01": ["census"],
  "hfo-al-m07-01": ["census"], "hfo-al-m07-02": ["census"], "hfo-al-m09-01": ["census", "finance_handoff"], "hfo-al-m09-03": ["trust", "finance_handoff"],
  "hfo-al-a09-01": ["census"], "hfo-al-q01-01": ["trust"], "hfo-al-n07-01": ["payments"], "hfo-al-n08-01": ["payments"], "hfo-al-c01-01": ["payments"], "hfo-al-c09-01": ["payments"],
};
const gaps: Record<string,string> = {
  "AL-D04":"Payment context is not a bank deposit or scanned deposit proof.",
  "AL-D17":"Recorded census is not confirmed physical presence, balanced census or billable days.",
  "AL-D19":"Census counts do not establish a reconciled admission/discharge event log.",
  "AL-W08":"DCF sent/delivered acknowledgment is unavailable; retain manual evidence.",
  "AL-M07":"Daily census coverage does not prove balancing approval or saving an approved version.",
  "AL-M09":"End-of-month review and approval remain explicit human work; FPC meaning is unconfirmed.",
  "AL-M12":"MCD meaning and subject are unconfirmed; do not substitute Medicaid.",
  "AL-A09":"Historical admission/discharge log audit is not established by current census counts.",
  "AL-Q01":"Trust period context does not establish mailing or bank reconciliation.",
  "AL-N06":"Payer identity or eligibility is not an application submission receipt.",
  "AL-N07":"A received payment does not establish full first-month satisfaction without approved period and amount rules.",
  "AL-N08":"Native AR context is not an external collections handoff receipt.",
  "AL-N09":"Admission status is not a confirmed immutable admission-log event.",
  "AL-C01":"The meaning of payment secured is unconfirmed; promises and receipts remain distinct.",
  "AL-C02":"Responsible payer authority requires attributable evidence; no approved source is established.",
  "AL-C03":"SSA notification receipt is unavailable; no external dispatch is performed.",
  "AL-C04":"Applicable income verification rules and source remain unconfirmed.",
  "AL-C05":"Executed family-payer signature finality is unavailable; metadata is not a signature.",
  "AL-C06":"Scheduling and completion of a payment conference require distinct evidence.",
  "AL-C07":"Authorization and document linkage remain separate; native effective-date/finality rules are unconfirmed.",
  "AL-C08":"Current recipient and sent/received evidence remain unconfirmed.",
  "AL-C09":"Native AR context is not proof of inclusion in an external collections drive.",
};
export const financeSourceMap = catalog.entries.filter(entry => sourceIds.includes(entry.sourceId)).flatMap(entry => entry.components.map(component => ({
  sourceId: entry.sourceId, key: component.key, id: component.id, label: component.label, kind: component.kind,
  families: familyMap[component.key] ?? [], gap: gaps[entry.sourceId] ?? null,
})));
