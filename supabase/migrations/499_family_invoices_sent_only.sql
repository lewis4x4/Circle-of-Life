-- COL-709 (Brian, 2026-09-23): families see sent invoices only, never drafts.
--
-- family_see_own_invoices (028, initplan-wrapped by 482) let a family member
-- with can_view_financial read every invoice for the resident, drafts
-- included. The portal now filters too, but the rule belongs in the policy so
-- no other read path can show a draft.
--
-- "Sent" matches wasInvoiceSent in src/lib/billing/receivables.ts: every
-- billed status (sent, partial, overdue, paid) plus written_off, which is only
-- reached from a sent invoice. A void is shown only when it carries sent_at;
-- most voids are drafts that were never sent (57 Homewood drafts, COL-678).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER POLICY family_see_own_invoices ON public.invoices
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND (SELECT haven.app_role()) = 'family'::public.app_role
    AND (
      status IN ('sent', 'partial', 'overdue', 'paid', 'written_off')
      OR (status = 'void' AND sent_at IS NOT NULL)
    )
    AND haven.can_access_resident(resident_id)
    AND EXISTS (
      SELECT 1
      FROM public.family_resident_links frl
      WHERE frl.user_id = (SELECT auth.uid())
        AND frl.resident_id = invoices.resident_id
        AND frl.can_view_financial = true
        AND frl.revoked_at IS NULL
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
