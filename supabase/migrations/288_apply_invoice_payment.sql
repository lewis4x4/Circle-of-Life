-- ══════════════════════════════════════════════════════════
-- 261 — Atomic invoice payment application RPC
-- ══════════════════════════════════════════════════════════
--
-- The payment form previously reconciled invoices.amount_paid / balance_due via
-- a client-side read-modify-write off a snapshot loaded at resident-select time.
-- Two payments against the same invoice (two tabs / a stale snapshot) could lose
-- an update. This function applies a payment atomically under a row lock, so the
-- clamp and the increment read the live balance.
--
-- SECURITY INVOKER (default): the caller's RLS on `invoices` still applies — the
-- same authorization as the prior client UPDATE — and audit triggers fire as
-- usual. Idempotent to deploy (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.apply_invoice_payment(
  p_invoice_id uuid,
  p_amount_cents int
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance int;
  v_applied int;
BEGIN
  SELECT balance_due INTO v_balance
    FROM public.invoices
   WHERE id = p_invoice_id AND deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    -- No accessible / non-deleted invoice. The (unapplied) payment row has
    -- already been recorded by the caller; there is nothing to reconcile.
    RETURN;
  END IF;

  v_applied := LEAST(GREATEST(0, p_amount_cents), GREATEST(0, v_balance));

  UPDATE public.invoices
     SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
         balance_due = GREATEST(0, v_balance - v_applied),
         status      = CASE WHEN v_balance - v_applied <= 0
                            THEN 'paid'::invoice_status
                            ELSE 'partial'::invoice_status END,
         updated_at  = now()
   WHERE id = p_invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_invoice_payment(uuid, int) TO authenticated;
