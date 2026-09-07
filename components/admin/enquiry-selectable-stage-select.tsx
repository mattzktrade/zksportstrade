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
}: {
  value: EnquirySelectableStage
  onChange: (stage: EnquirySelectableStage) => void
  disabled?: boolean
  id?: string
  className?: string
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as EnquirySelectableStage)}
      className={className}
    >
      {ENQUIRY_SELECTABLE_STAGE_GROUPS.map((group) => (
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
