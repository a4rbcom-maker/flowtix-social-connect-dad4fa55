import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", SAR: "﷼", EGP: "E£" };

export function formatCurrency(cents: number, currency?: string | null): string {
  const sym = CURRENCY_SYMBOLS[currency ?? "USD"] ?? "$";
  return `${sym}${(cents / 100).toFixed(2)}`;
}
