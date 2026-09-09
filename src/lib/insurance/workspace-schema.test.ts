import { describe, it, expect } from 'vitest';
import { parseWorkspaceCommand } from './workspace-schema';
import { createEmptyPolicyDraft } from './workspace-types';
const id = '11111111-1111-4111-8111-111111111111';
describe('browser insurance command boundary', () => {
  it('rejects every trusted processing action and actor injection', () => {
    for (const action of ['register_document', 'finish_document', 'start_extraction', 'finish_extraction'])
      expect(() => parseWorkspaceCommand({ action, payload: {} })).toThrow();
    expect(() => parseWorkspaceCommand({ action: 'overview', payload: { organization_id: id } })).toThrow();
    expect(() => parseWorkspaceCommand({
      action: 'approve_draft', payload: {
        id, revision: 1, confirm_evidence: true, actor_id: id
      }
    })).toThrow();
  });
  it('allows incomplete manual save but requires a stable id and explicit approval confirmation', () => {
    expect(parseWorkspaceCommand({
      action: 'save_draft', payload: {
        id, kind: 'new_policy', payload: createEmptyPolicyDraft(), evidence: {}
      }
    }).action).toBe('save_draft');
    expect(() => parseWorkspaceCommand({
      action: 'approve_draft', payload: {
        id, revision: 1, confirm_evidence: false
      }
    })).toThrow();
  });
});
