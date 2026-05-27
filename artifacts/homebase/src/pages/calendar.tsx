import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addDays, addWeeks, format, isSameWeek, isToday, startOfWeek, subWeeks } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  getGetHomeSnapshotQueryKey,
  getGetTodaySummaryQueryKey,
  getListTasksQueryKey,
  useCreateTask,
  useListTasks,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { TaskItem } from "@/components/task-item";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-base";
import { getTaskGroupOptions, type GroupableTask } from "@/lib/task-groups";
import { cn } from "@/lib/utils";

type WeeklyPlanDay = {
  date: string;
  body: string;
  updatedAt: string | null;
};

const WEEK_STARTS_ON = 1;
const AUTOSAVE_DELAY_MS = 700;

function dateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function startOfPlanWeek(date: Date) {
  return startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON });
}

function emptyWeekEntries(weekStartKey: string) {
  const entries: Record<string, string> = {};
  const [year, month, day] = weekStartKey.split("-").map(Number);
  const weekStart = new Date(year, month - 1, day);

  for (let index = 0; index < 7; index += 1) {
    entries[dateKey(addDays(weekStart, index))] = "";
  }

  return entries;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Use the status code if the API did not return a JSON error body.
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

function statusLabel(date: string, entries: Record<string, string>, savedEntries: Record<string, string>, saving: Set<string>) {
  if (saving.has(date)) return "Saving";
  return entries[date] === savedEntries[date] ? "Saved" : "Draft";
}

export default function WeeklyPlanner() {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [savedEntries, setSavedEntries] = useState<Record<string, string>>({});
  const [newTaskTitles, setNewTaskTitles] = useState<Record<string, string>>({});
  const [creatingTaskDate, setCreatingTaskDate] = useState<string | null>(null);
  const [savingDates, setSavingDates] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createTask = useCreateTask();
  const { data: taskData, isLoading: tasksLoading } = useListTasks(undefined, {
    query: { queryKey: getListTasksQueryKey() },
  });

  const weekStart = useMemo(() => startOfPlanWeek(viewDate), [viewDate]);
  const weekStartKey = dateKey(weekStart);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekEnd = weekDays[6] ?? weekStart;
  const weekLabel = `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`;
  const isCurrentWeek = isSameWeek(viewDate, new Date(), { weekStartsOn: WEEK_STARTS_ON });
  const allTasks = useMemo(() => (taskData ?? []) as GroupableTask[], [taskData]);
  const parentTaskOptions = useMemo(
    () => allTasks.map((task) => ({ id: task.id, title: task.title })),
    [allTasks],
  );
  const taskGroupOptions = useMemo(() => getTaskGroupOptions(allTasks), [allTasks]);
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, GroupableTask[]>();

    for (const day of weekDays) {
      grouped.set(dateKey(day), []);
    }

    for (const task of allTasks) {
      if (!task.dueDate) continue;
      const key = String(task.dueDate).slice(0, 10);
      grouped.get(key)?.push(task);
    }

    return grouped;
  }, [allTasks, weekDays]);

  useEffect(() => {
    let cancelled = false;

    async function loadWeek() {
      try {
        setLoading(true);
        setError(null);
        setSavingDates(new Set());

        const data = await api<WeeklyPlanDay[]>(`/weekly-plans?weekStart=${weekStartKey}`);
        const nextEntries = emptyWeekEntries(weekStartKey);

        for (const day of data) {
          nextEntries[day.date] = day.body;
        }

        if (!cancelled) {
          setEntries(nextEntries);
          setSavedEntries(nextEntries);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load weekly plan");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadWeek();
    return () => {
      cancelled = true;
    };
  }, [weekStartKey]);

  const saveDay = useCallback(
    async (date: string, body: string) => {
      setSavingDates((current) => new Set(current).add(date));

      try {
        const saved = await api<WeeklyPlanDay>(`/weekly-plans/${date}`, {
          method: "PUT",
          body: JSON.stringify({ body }),
        });

        setSavedEntries((current) => ({ ...current, [date]: saved.body }));
      } catch (err) {
        toast({
          title: "Failed to save plan",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      } finally {
        setSavingDates((current) => {
          const next = new Set(current);
          next.delete(date);
          return next;
        });
      }
    },
    [toast],
  );

  const saveDirtyEntries = useCallback(() => {
    for (const day of weekDays) {
      const key = dateKey(day);
      const body = entries[key] ?? "";
      if (body !== (savedEntries[key] ?? "")) {
        void saveDay(key, body);
      }
    }
  }, [entries, saveDay, savedEntries, weekDays]);

  useEffect(() => {
    if (loading) return;

    const dirty = weekDays
      .map((day) => dateKey(day))
      .filter((key) => (entries[key] ?? "") !== (savedEntries[key] ?? ""));

    if (dirty.length === 0) return;

    const timer = window.setTimeout(() => {
      for (const key of dirty) {
        void saveDay(key, entries[key] ?? "");
      }
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [entries, loading, saveDay, savedEntries, weekDays]);

  function updateEntry(date: string, body: string) {
    setEntries((current) => ({ ...current, [date]: body }));
  }

  function updateNewTaskTitle(date: string, title: string) {
    setNewTaskTitles((current) => ({ ...current, [date]: title }));
  }

  function refreshTaskQueries() {
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodaySummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
  }

  function createDatedTask(date: string, event: React.FormEvent) {
    event.preventDefault();

    const title = (newTaskTitles[date] ?? "").trim();
    if (!title || createTask.isPending) return;

    setCreatingTaskDate(date);
    createTask.mutate(
      {
        data: {
          title,
          dueDate: date,
          assignee: null,
          category: null,
          parentTaskId: null,
        } as any,
      },
      {
        onSuccess: () => {
          setNewTaskTitles((current) => ({ ...current, [date]: "" }));
          refreshTaskQueries();
        },
        onError: () => {
          toast({ title: "Failed to add task", variant: "destructive" });
        },
        onSettled: () => {
          setCreatingTaskDate(null);
        },
      },
    );
  }

  function goToWeek(date: Date) {
    saveDirtyEntries();
    setViewDate(date);
  }

  return (
    <div className="p-6 md:p-10 space-y-6 animate-in fade-in duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
            <CalendarDays className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Weekly Plan</h1>
            <p className="text-sm text-muted-foreground">{weekLabel}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => goToWeek(subWeeks(viewDate, 1))} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => goToWeek(new Date())} disabled={isCurrentWeek}>
            This Week
          </Button>
          <Button variant="outline" size="icon" onClick={() => goToWeek(addWeeks(viewDate, 1))} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-96 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {weekDays.map((day) => {
            const key = dateKey(day);
            const label = statusLabel(key, entries, savedEntries, savingDates);
            const dayTasks = tasksByDate.get(key) ?? [];
            const taskTitle = newTaskTitles[key] ?? "";
            const isCreatingThisDay = createTask.isPending && creatingTaskDate === key;

            return (
              <section
                key={key}
                className={cn(
                  "flex min-h-96 flex-col rounded-lg border bg-card p-3 shadow-sm",
                  isToday(day) && "border-primary/60 ring-1 ring-primary/30",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-foreground">{isToday(day) ? "Today" : format(day, "EEEE")}</h2>
                    <p className="text-sm text-muted-foreground">{format(day, "MMM d")}</p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-1 text-xs font-medium",
                      label === "Draft"
                        ? "bg-muted text-muted-foreground"
                        : label === "Saving"
                          ? "bg-primary/10 text-primary"
                          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                    )}
                  >
                    {label}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</div>
                  <Textarea
                    value={entries[key] ?? ""}
                    onChange={(event) => updateEntry(key, event.target.value)}
                    onBlur={() => {
                      const body = entries[key] ?? "";
                      if (body !== (savedEntries[key] ?? "")) {
                        void saveDay(key, body);
                      }
                    }}
                    placeholder="Write in the day"
                    className="min-h-36 resize-y border-border/70 bg-background/70 text-sm leading-6"
                  />
                </div>

                <div className="mt-4 flex-1 border-t border-border/60 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tasks</div>
                    <span className="text-xs text-muted-foreground">
                      {dayTasks.length} task{dayTasks.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <form className="mt-2 flex items-center gap-2" onSubmit={(event) => createDatedTask(key, event)}>
                    <Input
                      value={taskTitle}
                      onChange={(event) => updateNewTaskTitle(key, event.target.value)}
                      placeholder="Add task"
                      className="h-9 bg-background text-sm"
                      disabled={createTask.isPending}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      disabled={!taskTitle.trim() || createTask.isPending}
                      aria-label={`Add task for ${format(day, "MMMM d")}`}
                    >
                      <Plus className={cn("h-4 w-4", isCreatingThisDay && "animate-pulse")} />
                    </Button>
                  </form>

                  <div className="mt-3 space-y-2">
                    {tasksLoading ? (
                      <>
                        <Skeleton className="h-10 rounded-xl" />
                        <Skeleton className="h-10 rounded-xl" />
                      </>
                    ) : dayTasks.length > 0 ? (
                      dayTasks.map((task, index) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          index={index}
                          compact
                          parentTaskOptions={parentTaskOptions}
                          taskGroupOptions={taskGroupOptions}
                        />
                      ))
                    ) : (
                      <p className="rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                        No dated tasks.
                      </p>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
