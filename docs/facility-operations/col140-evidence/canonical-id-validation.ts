import {z} from 'zod';
import {saveFacilityRequirementDraftBodySchema} from '../../../src/lib/operations/requirements';
import {manualOccurrenceBodySchema,enrollBindingBodySchema} from '../../../src/lib/operations/occurrences';
import {helpHandoverTargetSchema} from '../../../src/lib/operations/help-handover';
const canonical='00000000-0000-0000-0002-000000000003';
const random='11111111-1111-4111-8111-111111111111';
const fields=[['z.string().uuid / COL151 POST export facility_id',z.string().uuid()],['facility-requirements POST facility_id',saveFacilityRequirementDraftBodySchema.shape.facility_id],['manual occurrence POST facility_id',manualOccurrenceBodySchema.shape.facility_id],['binding enrollment POST facility_id',enrollBindingBodySchema.shape.facility_id],['help/handover target facility_id',helpHandoverTargetSchema.shape.facility_id]] as const;
console.log(JSON.stringify({canonical,results:fields.map(([surface,schema])=>({surface,canonicalAccepted:schema.safeParse(canonical).success,randomFixtureAccepted:schema.safeParse(random).success,errors:schema.safeParse(canonical).error?.issues.map(e=>e.message)}))},null,2));
