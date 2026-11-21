import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 shadow-sm outline-none transition-colors placeholder:text-stone-400 focus-visible:border-stone-500 focus-visible:ring-2 focus-visible:ring-stone-400",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
