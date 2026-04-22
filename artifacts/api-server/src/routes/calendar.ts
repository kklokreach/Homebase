import { Router, type IRouter } from "express";
import * as ical from "node-ical";

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

const router: IRouter = Router();

router.get("/calendar/events", async (_req, res): Promise<void> => {
  const feeds = parseFeedList(process.env.GCAL_ICAL_URLS ?? "");
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
      const parsed = await ical.async.fromURL(feed.url);

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
    console.error(error);
    res.status(500).json({ error: "Failed to load calendar feeds" });
  }
});

export default router;
