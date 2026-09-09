import { describe, expect, it } from 'vitest';
import { parseServicingCommand } from './servicing-schema';
import { createEmptyServicingPayload, SERVICING_KINDS, type ServicingKind } from './servicing-types';
const id = '11111111-1111-4111-8111-111111111111';
function save(kind: ServicingKind, payload: unknown = createEmptyServicingPayload(kind)) {
  return {
    action: 'save',
    payload: {
      id,
      kind,
      title: 'Draft review',
      entity_id: id,
      facility_id: null,
      policy_id: null,
      document_id: null,
      owner_id: null,
      due_date: null,
      payload
    }
  };
}
describe('servicing command validation', () => {
  it.each(SERVICING_KINDS)('retains incomplete %s drafts without manufacturing facts', kind => {
    const command = parseServicingCommand(save(kind));
    expect(command.payload).toMatchObject({
      id,
      kind,
      payload: createEmptyServicingPayload(kind)
    });
  });
  it('rejects server-owned actor, snapshots, review status, revision lineage and event metadata', () => {
    for (const fields of [{
      actor_id: id
    }, {
      organization_id: id
    }, {
      display_names: { entity: 'Forged insured', vendor: 'Forged vendor' }
    }, {
      status: 'approved'
    }, {
      source_record_id: id
    }, {
      event_metadata: {
        acknowledgment: 'forged'
      }
    }]) {
      const request = save('claim_matter');
      expect(() => parseServicingCommand({
        ...request,
        payload: {
          ...request.payload,
          ...fields
        }
      })).toThrow();
    }
    expect(() => parseServicingCommand(save('renewal_package', {
      ...createEmptyServicingPayload('renewal_package'),
      policy_snapshot: {
        verification_status: 'verified'
      }
    }))).toThrow();
  });
  it('keeps unknown carrier amounts distinct from zero and rejects noninteger, unsafe or negative amounts', () => {
    const claim = {
      claim_reference: 'Claim A',
      loss_date: null,
      paid_cents: null,
      reserve_cents: 0,
      recovery_cents: null,
      expense_cents: null,
      incurred_cents: null,
      incurred_includes_expenses: null,
      page: null
    };
    const payload = {
      ...createEmptyServicingPayload('loss_report'),
      claims: [claim]
    };
    expect(parseServicingCommand(save('loss_report', payload)).payload).toMatchObject({
      payload: {
        claims: [{
          paid_cents: null,
          reserve_cents: 0
        }]
      }
    });
    for (const amount of [-1, 1.25, 2147483648, Number.MAX_SAFE_INTEGER + 1, '100']) {
      expect(() => parseServicingCommand(save('loss_report', {
        ...payload,
        claims: [{
          ...claim,
          paid_cents: amount
        }]
      }))).toThrow();
    }
  });
  it('requires the explicit no-loss fields and preserves payroll basis separately', () => {
    const missing: Record<string, unknown> = createEmptyServicingPayload('loss_report');
    delete missing.no_losses_confirmed;
    expect(() => parseServicingCommand(save('loss_report', missing))).toThrow();
    const workforce = {
      ...createEmptyServicingPayload('workforce_exposure'),
      manual_source_reason: 'Broker-reviewed aggregate statement',
      rows: [{
        state: 'WV',
        class_code: '1234',
        actual_payroll_cents: null,
        estimated_payroll_cents: 90000,
        basis_note: 'Estimate only'
      }]
    };
    expect(parseServicingCommand(save('workforce_exposure', workforce)).payload).toMatchObject({
      payload: workforce
    });
  });
  it('rejects unknown states, employee-level fields, noncalendar dates and source page zero', () => {
    expect(() => parseServicingCommand(save('workforce_exposure', {
      ...createEmptyServicingPayload('workforce_exposure'),
      employee_names: ['Private']
    }))).toThrow();
    expect(() => parseServicingCommand(save('vendor_evidence', {
      ...createEmptyServicingPayload('vendor_evidence'),
      endorsement_page: 0
    }))).toThrow();
    expect(() => parseServicingCommand(save('claim_matter', {
      ...createEmptyServicingPayload('claim_matter'),
      loss_date: '2026-02-30'
    }))).toThrow();
    expect(() => parseServicingCommand(save('workforce_exposure', {
      ...createEmptyServicingPayload('workforce_exposure'),
      rows: [{
        state: 'XX',
        class_code: '',
        estimated_payroll_cents: null,
        actual_payroll_cents: null,
        basis_note: ''
      }]
    }))).toThrow();
  });
  it('requires expected versions for transitions, revisions and exports', () => {
    for (const action of ['transition', 'revise', 'export']) expect(() => parseServicingCommand({
      action,
      payload: {
        id
      }
    })).toThrow();
    expect(parseServicingCommand({
      action: 'transition',
      payload: {
        id,
        version: 3,
        status: 'acknowledged',
        recipient: 'Broker',
        acknowledgment: 'Recorded receipt',
        reported_date: '2026-09-01'
      }
    }).payload).toMatchObject({
      version: 3,
      reported_date: '2026-09-01'
    });
    expect(() => parseServicingCommand({
      action: 'transition',
      payload: {
        id,
        version: 3,
        status: 'acknowledged',
        payload: {
          reported_date: '2026-09-01'
        }
      }
    })).toThrow();
  });
});


it('allows audited operational reassignment without approved content or event forgery', () => {
  const payload = { id, version: 4, owner_id: null, due_date: null, note: 'Reassign after staff departure' };
  expect(parseServicingCommand({ action: 'reassign', payload }).payload).toEqual(payload);
  for (const forged of [{ payload: { recipient: 'Changed' } }, { display_names: { owner: 'Forged' } }, { event_metadata: { actor: id } }, { actor_id: id }]) {
    expect(() => parseServicingCommand({ action: 'reassign', payload: { ...payload, ...forged } })).toThrow();
  }
  for (const invalid of [{ note: ' ' }, { version: 0 }, { owner_id: 'invalid' }, { due_date: '2026-02-30' }]) {
    expect(() => parseServicingCommand({ action: 'reassign', payload: { ...payload, ...invalid } })).toThrow();
  }
  expect(() => parseServicingCommand({ action: 'reassign', payload: { id, version: 4, note: 'Owner and due date omitted' } })).toThrow();
});
