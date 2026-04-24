import { useEffect, useMemo, useState } from "react";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { CalendarDays, Clock, MapPin, User, Users } from "lucide-react";

const API_BASE_URL = "https://homebase-ll6f.onrender.com";

type Assignee = "me" | "wife" | "us";

type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  assignee: Assignee;
};

function assigneeLabel(value: Assignee): string {
  if (value === "wife") return "Lauren";
  if (value === "me") return "Patrick";
  return "Both";
}

function dayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEEE, MMM d");
}

export default function Calendar() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`${API_BASE_URL}/api/calendar/events`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as CalEvent[];
        if (!cancelled) setEvents(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load calendar");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, CalEvent[]>();

    for (const ev of events) {
      const key = ev.start.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        date: parseISO(key),
        items: items.sort((a, b) => a.start.localeCompare(b.start)),
      }));
  }, [events]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-5 w-5" />
          <div>
            <h1 className="text-2xl font-semibold">Calendar</h1>
            <p className="text-sm text-muted-foreground">
              Google Calendar (read-only)
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          Loading calendar…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border bg-card p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {!loading && !error && grouped.length === 0 && (
        <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          No upcoming events found.
        </div>
      )}

      {!loading &&
        !error &&
        grouped.map(({ date, items }) => (
          <section key={date.toISOString()} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{dayLabel(date)}</h2>
              <span className="text-sm text-muted-foreground">
                {items.length} event{items.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="space-y-3">
              {items.map((event) => (
                <div
                  key={event.id}
                  className="rounded-2xl border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{event.title}</div>
                      <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {format(new Date(event.start), "h:mm a")} –{" "}
                          {format(new Date(event.end), "h:mm a")}
                        </span>

                        {event.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-4 w-4" />
                            {event.location}
                          </span>
                        )}

                        <span className="inline-flex items-center gap-1">
                          {event.assignee === "us" ? (
                            <Users className="h-4 w-4" />
                          ) : (
                            <User className="h-4 w-4" />
                          )}
                          {assigneeLabel(event.assignee)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
