import { NextResponse } from 'next/server';
import { z } from 'zod';
import { actorCanAccessFacility, requireAdminApiActor } from '@/lib/admin/api-auth';
import { logError } from '@/lib/observability/logger';

const TRUSTED_ACTION_ERRORS = new Set([
  'Actor, description and due date required',
  'Meeting unavailable',
  'Meeting action author is not authorized',
  'Meeting facility access required',
  'Action identity already saved with different values',
  'Assignee unavailable in meeting facility',
]);

const actionSchema = z.object({
  id: z.uuid(), description: z.string().trim().min(1).max(8000),
  assigned_to: z.uuid().nullable(), due_date: z.iso.date(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiActor({ allowedRoles: ['owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'nurse'] });
  if ('response' in auth) return auth.response;
  const { actor } = auth;
  let submitted: unknown;
  try { submitted = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const parsed = actionSchema.safeParse(submitted);
  if (!parsed.success) return NextResponse.json({ error: 'Provide an action identity, description, assignee and valid due date.' }, { status: 400 });
  const { id } = await params;
  const meeting = await actor.admin.from('meetings' as never).select('facility_id, organization_id').eq('id', id).is('deleted_at', null).maybeSingle();
  const row = meeting.data as { facility_id: string; organization_id: string } | null;
  if (meeting.error || !row || row.organization_id !== actor.organization_id) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
  if (!(await actorCanAccessFacility(actor, row.facility_id))) return NextResponse.json({ error: 'Meeting facility access required' }, { status: 403 });
  const result = (await actor.admin.rpc('create_meeting_action' as never, {
    p_id: parsed.data.id, p_meeting_id: id, p_description: parsed.data.description,
    p_assigned_to: parsed.data.assigned_to, p_due_date: parsed.data.due_date, p_actor_id: actor.id,
  } as never)) as unknown as { data: string | null; error: { message: string } | null };
  if (result.error || typeof result.data !== 'string') {
    if (result.error) logError('admin.meetings.actions.create', result.error, { action: 'rpc', meetingId: id });
    const error = result.error && TRUSTED_ACTION_ERRORS.has(result.error.message)
      ? result.error.message
      : 'Meeting action could not be saved. Review the meeting and retry.';
    return NextResponse.json({ error }, { status: 409 });
  }
  return NextResponse.json({ id: result.data });
}
