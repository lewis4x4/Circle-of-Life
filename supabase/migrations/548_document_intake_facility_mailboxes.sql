-- COL-771 / COL-831: one intake mailbox per facility plus Front Office.
--
-- Brian, 2026-09-25, created six shared mailboxes on circleoflifecommunities.com:
-- homewood.docs, grandecypress.docs, oakridge.docs, plantation.docs,
-- risingoaks.docs and frontoffice.docs. Each facility mailbox names its
-- facility, so mail it receives lands in that facility's queue; Front Office
-- has no facility and lands with the Corporate custodian. A person still
-- reviews and approves every filing, and an authenticated sender route still
-- wins over the mailbox. A mailbox is switched on (active) when its facility
-- is accepted (COL-843), so the five facility mailboxes follow the same
-- one-at-a-time rollout as uploads.
BEGIN;

ALTER TABLE public.document_intake_mailboxes
  ADD COLUMN facility_id uuid REFERENCES public.facilities(id),
  ADD COLUMN label text CHECK (length(label) <= 120);

CREATE OR REPLACE FUNCTION public.document_intake_worker_create_mail_item(p_message uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.document_intake_messages; mb public.document_intake_mailboxes; i public.document_intake_items;
  route public.document_intake_sender_routes; new_id uuid := gen_random_uuid(); target uuid;
BEGIN
  SELECT * INTO m FROM public.document_intake_messages WHERE id = p_message;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO mb FROM public.document_intake_mailboxes WHERE id = m.mailbox_id;
  SELECT * INTO i FROM public.document_intake_items WHERE message_id = m.id AND original_filename = p_payload->>'file_name'
    AND declared_sha256 = p_payload->>'sha256' LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('item_id', i.id, 'path', i.storage_path, 'existing', true, 'verified', i.verified_sha256 IS NOT NULL); END IF;
  -- A sender route counts only for a first-hop authenticated sender.
  IF m.sender_authenticated THEN
    SELECT * INTO route FROM public.document_intake_sender_routes r WHERE r.organization_id = m.organization_id
      AND r.sender_address = m.sender_address AND r.revoked_at IS NULL AND r.effective_from <= current_date;
  END IF;
  -- Sender route first, then the receiving facility mailbox; otherwise the custodian.
  target := coalesce(route.facility_id, mb.facility_id);
  IF NOT haven.document_intake_allowed_mime(lower(p_payload->>'mime')) THEN RAISE EXCEPTION 'Unsupported part' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.document_intake_items (id, organization_id, facility_id, channel, message_id, original_filename, declared_mime, declared_size_bytes,
    declared_sha256, storage_path, sender_address, sender_authenticated, received_at, created_principal)
  VALUES (new_id, m.organization_id, target, 'email', m.id, left(coalesce(nullif(btrim(p_payload->>'file_name'), ''), 'attachment'), 255),
    lower(p_payload->>'mime'), (p_payload->>'size_bytes')::integer, p_payload->>'sha256',
    format('%s/%s/%s/original', m.organization_id, coalesce(target::text, 'unassigned'), new_id),
    m.sender_address, m.sender_authenticated, coalesce(m.received_at, now()), 'mail_receiver')
  RETURNING * INTO i;
  RETURN jsonb_build_object('item_id', i.id, 'path', i.storage_path, 'existing', false, 'verified', false);
END $$;
REVOKE ALL ON FUNCTION public.document_intake_worker_create_mail_item(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_intake_worker_create_mail_item(uuid,jsonb) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
