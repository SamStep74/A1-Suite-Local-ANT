import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn — class-name composer. Resolves Tailwind class conflicts (`p-2 p-4` → `p-4`)
 * so density / theme / variant props don't produce duplicate utility classes.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
