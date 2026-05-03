import type { Response } from "express";

export function parsePositiveIntParam(
  params: Record<string, string | string[]>,
  name: string,
): number | null {
  const rawValue = params[name];
  const raw = Array.isArray(rawValue) ? rawValue[0] : rawValue;

  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) {
    return null;
  }

  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function sendInvalidId(res: Response, label = "id"): void {
  res.status(400).json({ error: `Invalid ${label}` });
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
