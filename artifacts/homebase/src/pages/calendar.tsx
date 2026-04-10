import { useMemo, useRef, useEffect } from "react";
import { format, isToday, isTomorrow, addDays, startOfDay, isSameDay, parseISO } from "date-fns";
import { CalendarDays, Clock, ExternalLink, MapPin, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Mock data ──────────────────────────────────────────────────────────────

const TODAY = startOfDay(new Date());
const d = (offset: number, h: number, m = 0) => {
  const dt = addDays(TODAY, offset);
  dt.setHours(h, m, 0, 0);
  return dt;
};

type Assignee = "me" | "wife" | "us";

interface CalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location?: string;
  assignee: Assignee;
  tag: "appointment" | "school" | "social" | "errand" | "recurring";
  notes?: string;
}

const MOCK_EVENTS: CalEvent[] = [
  // Today
  { id: "e1",  title: "Dentist — checkup",          start: d(0, 10, 0),  end: d(0, 11, 0),  location: "Bright Smiles Dental",     assignee: "me",   tag: "appointment" },
  { id: "e2",  title: "School pickup",               start: d(0, 15, 15), end: d(0, 15, 45), location: "Lincoln Elementary",        assignee: "wife", tag: "school" },
  { id: "e3",  title: "Dinner — The Hamiltons",      start: d(0, 18, 30), end: d(0, 21, 0),  location: "Ember & Oak",              assignee: "us",   tag: "social" },
  // Tomorrow
  { id: "e4",  title: "Grocery pickup — Costco",     start: d(1,  9, 0),  end: d(1, 10, 0),  location: "Costco, Oak Ave",          assignee: "me",   tag: "errand" },
  { id: "e5",  title: "Emma — swim lesson",          start: d(1, 16, 0),  end: d(1, 17, 0),  location: "Aqua Center",              assignee: "wife", tag: "school" },
  // Day +2
  { id: "e6",  title: "Car service",                 start: d(2, 8, 30),  end: d(2, 10, 0),  location: "Quick Lube, Maple St",     assignee: "me",   tag: "errand" },
  { id: "e7",  title: "Date night — Niko's",         start: d(2, 19, 0),  end: d(2, 22, 0),  location: "Niko's Kitchen",           assignee: "us",   tag: "social" },
  // Day +3
  { id: "e8",  title: "Pediatrician — annual visit", start: d(3, 11, 0),  end: d(3, 11, 45), location: "Riverside Pediatrics",     assignee: "wife", tag: "appointment" },
  // Day +4
  { id: "e9",  title: "HOA meeting",                 start: d(4, 18, 0),  end: d(4, 19, 30), assignee: "us", tag: "recurring" },
  { id: "e10", title: "Soccer practice — Ethan",     start: d(4, 16, 30), end: d(4, 17, 30), location: "Riverside Fields",         assignee: "wife", tag: "school" },
  // Day +6
  { id: "e11", title: "HVAC inspection",             start: d(6, 9, 0),   end: d(6, 10, 0),  location: "Home",                    assignee: "me",   tag: "errand" },
  { id: "e12", title: "Brunch — Mom & Dad",          start: d(6, 11, 0),  end: d(6, 13, 0),  location: "The Grind Café",           assignee: "us",   tag: "social" },
  // Day +7
  { id: "e13", title: "Therapy session",             start: d(7, 14, 0),  end: d(7, 15, 0),  location: "Mind + Matter Wellness",  assignee: "wife", tag: "appointment" },
  // Day +9
  { id: "e14", title: "Vision checkup",              start: d(9, 10, 30), end: d(9, 11, 15), location: "Clear Vision Eye Care",    assignee: "me",   tag: "appointment" },
  // Day +11
  { id: "e15", title: "Emma — school recital",       start: d(11, 18, 0), end: d(11, 20, 0), location: "Lincoln Auditorium",       assignee: "us",   tag: "school" },
  // Day +13
  { id: "e16", title: "Landscaping — spring cleanup",start: d(13, 8, 0),  end: d(13, 12, 0), location: "Home",                    assignee: "me",   tag: "errand" },
  { id: "e17", title: "Book club",                   start: d(13, 19, 30),end: d(13, 21, 30), assignee: "wife", tag: "social" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const TAG_STYLES: Record<CalEvent["tag"], string> = {
  appointment: "bg-rose-100 text-rose-700",
  school:      "bg-sky-100 text-sky-700",
  social:      "bg-amber-100 text-amber-700",
  errand:      "bg-stone-100 text-stone-600",
  recurring:   "bg-violet-100 text-violet-700",
};

const ASSIGNEE_DOT: Record<Assignee, string> = {
  me:   "bg-primary",
  wife: "bg-secondary",
  us:   "bg-chart-3",
};

const ASSIGNEE_LABEL: Record<Assignee, React.ReactNode> = {
  me:   <span className="flex items-center gap-0.5 text-primary"><User className="w-3 h-3" /> Me</span>,
  wife: <span className="flex items-center gap-0.5 text-secondary"><User className="w-3 h-3" /> Wife</span>,
  us:   <span className="flex items-center gap-0.5 text-chart-3"><Users className="w-3 h-3" /> Both</span>,
};

function dayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEEE, MMM d");
}

// ── Event card ────────────────────────────────────────────────────────────

function EventCard({ event }: { event: CalEvent }) {
  const duration = Math.round((event.end.getTime() - event.start.getTime()) / 60000);
  return (
    <div className="flex gap-3 group">
      {/* Assignee dot + time column */}
      <div className="flex flex-col items-center gap-1 pt-1 w-14 shrink-0">
        <div className={cn("w-2.5 h-2.5 rounded-full mt-0.5", ASSIGNEE_DOT[event.assignee])} />
        <span className="text-[11px] tabular-nums text-muted-foreground leading-tight">
          {format(event.start, "h:mm")}
          <span className="text-muted-foreground/60 text-[10px]">{format(event.start, "a")}</span>
        </span>
      </div>

      {/* Card body */}
      <div className="flex-1 bg-card border border-border/50 rounded-xl px-4 py-3 mb-2 transition-all hover:shadow-sm hover:border-primary/20">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold text-foreground leading-snug">{event.title}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {event.location && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[180px]">{event.location}</span>
                </span>
              )}
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3 shrink-0" />
                {duration < 60 ? `${duration}m` : `${Math.floor(duration / 60)}h${duration % 60 ? ` ${duration % 60}m` : ""}`}
              </span>
            </div>
          </div>
          {/* Assignee + tag */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className="text-[11px] font-medium">{ASSIGNEE_LABEL[event.assignee]}</span>
            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide", TAG_STYLES[event.tag])}>
              {event.tag}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Calendar() {
  const todayRef = useRef<HTMLDivElement>(null);

  // Group events by day
  const grouped = useMemo(() => {
    const sorted = [...MOCK_EVENTS].sort((a, b) => a.start.getTime() - b.start.getTime());
    const map = new Map<string, CalEvent[]>();
    for (const ev of sorted) {
      const key = format(ev.start, "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return Array.from(map.entries()).map(([key, events]) => ({
      date: parseISO(key),
      events,
    }));
  }, []);

  // Scroll today into view on first mount
  useEffect(() => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="px-4 pt-5 pb-12 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-serif font-bold text-foreground">Calendar</h1>
        </div>
        <span className="text-xs text-muted-foreground bg-muted/50 border border-border/50 rounded-full px-3 py-1 font-medium">
          {format(TODAY, "MMMM yyyy")}
        </span>
      </div>

      {/* Google Calendar connect banner */}
      <div className="flex items-center justify-between gap-3 bg-primary/5 border border-primary/20 rounded-2xl px-4 py-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-foreground">Connect Google Calendar</p>
          <p className="text-xs text-muted-foreground">Your real events will appear here once connected.</p>
        </div>
        <button
          disabled
          className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted/60 border border-border/50 rounded-full px-3 py-1.5 cursor-not-allowed"
        >
          Coming soon
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {(["me", "wife", "us"] as Assignee[]).map((a) => (
          <div key={a} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className={cn("w-2 h-2 rounded-full", ASSIGNEE_DOT[a])} />
            <span className="capitalize">{a === "us" ? "Both" : a === "wife" ? "Wife" : "Me"}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 ml-auto flex-wrap">
          {(Object.keys(TAG_STYLES) as CalEvent["tag"][]).map((tag) => (
            <span key={tag} className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide", TAG_STYLES[tag])}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Agenda */}
      <div className="space-y-6">
        {grouped.map(({ date, events }) => {
          const isCurrentDay = isSameDay(date, TODAY);
          return (
            <div key={format(date, "yyyy-MM-dd")} ref={isCurrentDay ? todayRef : undefined}>
              {/* Day header */}
              <div className="flex items-center gap-3 mb-3">
                <div className={cn(
                  "flex flex-col items-center justify-center w-9 h-9 rounded-xl shrink-0",
                  isCurrentDay ? "bg-primary text-primary-foreground" : "bg-muted/40 text-foreground"
                )}>
                  <span className="text-[10px] font-bold uppercase leading-none">{format(date, "EEE")}</span>
                  <span className="text-base font-bold leading-none mt-0.5">{format(date, "d")}</span>
                </div>
                <div>
                  <p className={cn("text-sm font-semibold", isCurrentDay ? "text-primary" : "text-foreground")}>
                    {dayLabel(date)}
                  </p>
                  <p className="text-xs text-muted-foreground">{events.length} event{events.length !== 1 ? "s" : ""}</p>
                </div>
                {isCurrentDay && (
                  <div className="ml-auto">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-1 rounded-full">
                      Today
                    </span>
                  </div>
                )}
              </div>

              {/* Events for this day */}
              <div className="ml-1">
                {events.map((ev) => <EventCard key={ev.id} event={ev} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
