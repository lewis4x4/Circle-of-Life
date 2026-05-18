/**
 * record-detail — Record Detail surface primitives
 *
 * Surface treatment per surface-map.md:
 *   Mix: Attio 50% · Mercury 25% · Stripe 15% · Linear 10%
 *   Row height: 38px · Padding: 14px · Section radius: xl · Hover lift: 2px on tiles only
 *   Emphasis: DATA — "Everything about one thing, organized for reading and editing."
 *
 * Usage:
 *   import { RecordDetailHeader, RecordDetailSection, DetailRow } from "@/design-system/components/record-detail";
 */

export { RecordDetailHeader } from "./RecordDetailHeader";
export type { RecordDetailHeaderProps } from "./RecordDetailHeader";

export { RecordDetailSection } from "./RecordDetailSection";
export type { RecordDetailSectionProps } from "./RecordDetailSection";
export { DetailRow, isRecordDetailEmptyValue } from "./DetailRow";
export type { DetailRowProps } from "./DetailRow";

export { SectionLabel, FieldLabel } from "./QuietLabels";
