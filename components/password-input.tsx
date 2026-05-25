"use client"

import { forwardRef, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"

export type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  /** Class for the wrapping <div>; rare — prefer `className` on the input. */
  wrapperClassName?: string
}

/**
 * Text input that swaps between `type="password"` and `type="text"` with an
 * inline eye toggle. Forwards all standard input props and refs so it's a
 * drop-in replacement for a plain `<input type="password" />`.
 *
 * Reserves space on the right of the input for the toggle button via `pr-10`,
 * appended to whatever `className` callers pass so existing styles are
 * preserved.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, wrapperClassName, ...props }, ref) {
    const [visible, setVisible] = useState(false)
    return (
      <div className={cn("relative", wrapperClassName)}>
        <input
          ref={ref}
          {...props}
          type={visible ? "text" : "password"}
          className={cn(className, "pr-10")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus:outline-none focus:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    )
  },
)
