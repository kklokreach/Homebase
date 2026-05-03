import { Router, type IRouter } from "express";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as ical from "node-ical";
import { config } from "../lib/config";
import { logger } from "../lib/logger";

type Assignee = "me" | "wife" | "us";

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  assignee: Assignee;
};

function normalizeAssignee(value: string): Assignee {
  if (value === "me" || value === "wife" || value === "us") return value;
  return "us";
}

function parseFeedList(raw: string): Array<{ assignee: Assignee; url: string }> {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [maybeAssignee, ...rest] = part.split("=");
      if (rest.length === 0) {
        return { assignee: "us" as Assignee, url: maybeAssignee.trim() };
      }
      return {
        assignee: normalizeAssignee(maybeAssignee.trim()),
        url: rest.join("=").trim(),
      };
    })
    .filter((x) => x.url);
}

function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const maybeMappedIpv4 = normalized.includes(".") ? normalized.split(":").pop() : undefined;

  if (maybeMappedIpv4 && isBlockedIpv4(maybeMappedIpv4)) return true;

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("ff")
  );
}

function isBlockedIpAddress(address: string): boolean {
  const ipType = isIP(address);
  if (ipType === 4) return isBlockedIpv4(address);
  if (ipType === 6) return isBlockedIpv6(address);
  return false;
}

function validateFeedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const ipType = isIP(hostname);

    if (url.protocol !== "https:") return null;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return null;
    if (ipType === 4 && isBlockedIpv4(hostname)) return null;
    if (ipType === 6 && isBlockedIpv6(hostname)) return null;

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function assertPublicHostname(hostname: string) {
  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) throw new Error("Calendar feed host is not allowed");
    return;
  }

  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new Error("Calendar feed host is not allowed");
  }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : 0;

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("Calendar feed is too large");
  }

  if (!response.body) {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maxBytes) {
      throw new Error("Calendar feed is too large");
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Calendar feed is too large");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8");
}

async function fetchCalendarFeed(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.calendar.fetchTimeoutMs);

  try {
    await assertPublicHostname(new URL(url).hostname);

    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: {
        accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
      },
    });

    if (!response.ok) {
      throw new Error(`Calendar feed responded with ${response.status}`);
    }

    const body = await readLimitedText(response, config.calendar.maxFeedBytes);
    return ical.async.parseICS(body);
  } finally {
    clearTimeout(timeout);
  }
}

const router: IRouter = Router();

router.get("/calendar/events", async (_req, res): Promise<void> => {
  const feeds = parseFeedList(process.env.GCAL_ICAL_URLS ?? "")
    .map((feed) => ({ ...feed, url: validateFeedUrl(feed.url) }))
    .filter((feed): feed is { assignee: Assignee; url: string } => feed.url !== null);

  if (feeds.length === 0) {
    res.json([]);
    return;
  }

  const now = new Date();
  const endWindow = new Date();
  endWindow.setDate(endWindow.getDate() + 45);

  const events: CalendarEvent[] = [];

  try {
    for (const feed of feeds) {
      const parsed = await fetchCalendarFeed(feed.url);

      for (const item of Object.values(parsed) as any[]) {
        if (!item || item.type !== "VEVENT" || !item.start) continue;

        const start = new Date(item.start);
        const end = item.end ? new Date(item.end) : new Date(item.start);

        if (end < now || start > endWindow) continue;

        events.push({
          id: String(item.uid ?? `${feed.assignee}-${start.toISOString()}-${item.summary ?? "event"}`),
          title: String(item.summary ?? "Untitled event"),
          start: start.toISOString(),
          end: end.toISOString(),
          location: item.location ? String(item.location) : null,
          assignee: feed.assignee,
        });
      }
    }

    events.sort((a, b) => a.start.localeCompare(b.start));
    res.json(events);
  } catch (error) {
    logger.error({ err: error }, "Failed to load calendar feeds");
    res.status(500).json({ error: "Failed to load calendar feeds" });
  }
});

export default router;
