import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our theme replaces Tailwind's font sizes, so tailwind-merge must know text-md is a size, not a color.
const merge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["xs", "sm", "md", "lg", "xl", "2xl"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
