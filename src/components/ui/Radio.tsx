import * as React from "react"
import { cn } from "@/src/lib/utils"

export interface RadioProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Radio = React.forwardRef<HTMLInputElement, RadioProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        type="radio"
        className={cn(
          "h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-900",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Radio.displayName = "Radio"

export { Radio }
