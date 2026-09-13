import {it,expect} from 'vitest';
import {saveFacilityRequirementDraftBodySchema} from './requirements';
import {manualOccurrenceBodySchema,enrollBindingBodySchema} from './occurrences';
import {helpHandoverTargetSchema} from './help-handover';
import {preparePayloadSchema} from './evidence';
const homewood='00000000-0000-0000-0002-000000000003';
const entity='00000000-0000-0000-0001-000000000003';
it.each([homewood,entity])('accepts canonical database ID %s without remapping',id=>{
 expect(saveFacilityRequirementDraftBodySchema.safeParse({facility_id:id,activity_id:id,payload:{applicability:'needs_confirmation'}}).success).toBe(true);
 expect(manualOccurrenceBodySchema.safeParse({facility_id:id,activity_id:id,subject_id:id,request_key:'canonical-test-1',payload:{}}).success).toBe(true);
 expect(enrollBindingBodySchema.shape.facility_id.safeParse(id).success).toBe(true);
 expect(helpHandoverTargetSchema.safeParse({facility_id:id,activity_id:id}).success).toBe(true);
 expect(preparePayloadSchema.safeParse({kind:'linked_record',linked_table:'facility_documents',linked_record_id:id}).success).toBe(true);
});
it.each(['','not-a-uuid','00000000-0000-0000-0002-00000000000g','00000000000000000002000000000003',` ${homewood}`,`${homewood}' OR true`,null])('keeps malformed database IDs rejected: %s',id=>{
 expect(manualOccurrenceBodySchema.safeParse({facility_id:id,activity_id:homewood,subject_id:homewood,request_key:'canonical-test-1',payload:{}}).success).toBe(false);
});
