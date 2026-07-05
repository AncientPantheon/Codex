/**
 * cn — Tailwind class merge helper, cloned verbatim from OuronetUI
 * `src/lib/utils.ts` (the `cn` export). Kept in the package so the ZBOM
 * clone components merge classes identically to My Codex.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
