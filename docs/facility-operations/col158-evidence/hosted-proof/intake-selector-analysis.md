# COL158 browser selector failure and bounded repair

Initial browser intake on source30b2a45d created exactly one native contact through the actual UI/HTTP200. It then timed out selecting Document type with getByLabel exact. No document prepare/upload/finalize request occurred. Current readonly DB readback shows contacts1,versions0,documents0 and no pendingbrowser mutation.

A separate readonly browser inspection found getByLabel('Document type',exact) count0 and getByRole('combobox',name='Document type',exact) count1. The failed screenshot shows the select control present. This is an automation selector mismatch, not a document upload or application failure.

The runner-only repair uses actual combobox accessible roles for select controls. A retry verifies the retained contact ID in the exact patient/task reply and skips contact creation. It explicitly reloads provider reports and validates current task/resident/complete/can_intake/contact binding before entering document intake. The existing successful contact creation stays attributed to the initial attempt; the retry does not claim a new contact operation. The original FAIL report/screenshot, attempt log, DOM counts and zero-document readback are retained.

No application, schema370, native data or private fixture identity changes. Hosted retry still requires independent review, commit and exact-source binding of the existing fixture. No new users, contacts, upload objects or policy activation occurred during this repair.
