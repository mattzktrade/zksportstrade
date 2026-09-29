"use client"

import {
  ENQUIRY_SELECTABLE_STAGE_GROUPS,
  enquirySelectableStageLabel,
  type EnquirySelectableStage,
} from "@/lib/crm/deal-pipeline"

export function EnquirySelectableStageSelect({
  value,
  onChange,
  disabled,
  id,
  className,
  enquiryStagesOnly = false,
}: {
  value: EnquirySelectableStage
  onChange: (stage: EnquirySelectableStage) => void
  disabled?: boolean
  id?: string
  className?: string
  /** Event-only enquiries stay in the enquiry stages until a package is added. */
  enquiryStagesOnly?: boolean
}) {
  const groups = enquiryStagesOnly
    ? ENQUIRY_SELECTABLE_STAGE_GROUPS.filter((group) => group.label === "Enquiry")
    : ENQUIRY_SELECTABLE_STAGE_GROUPS
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as EnquirySelectableStage)}
      className={className}
    >
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.stages.map((stage) => (
            <option key={stage} value={stage}>
              {enquirySelectableStageLabel(stage)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
