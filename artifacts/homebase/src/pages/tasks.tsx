import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTasks,
  getListTasksQueryKey,
  getGetTodaySummaryQueryKey,
  getGetHomeSnapshotQueryKey,
} from "@workspace/api-client-react";
import type { Task } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskQuickAdd } from "@/components/task-quick-add";
import { TaskItem } from "@/components/task-item";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, CheckSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-base";

type GroupableTask = Task & {
  parentTaskId?: number | null;
  sortOrder?: number;
  category?: string | null;
};

type TaskGroup = {
  key: string;
  label: string;
  tasks: GroupableTask[];
};

function taskGroupLabel(category?: string | null) {
  return category?.trim() || "Ungrouped";
}

function taskGroupKey(label: string) {
  return label.trim().toLocaleLowerCase();
}

function orderedTaskIdsFromGroups(groups: TaskGroup[]) {
  return groups.flatMap((group) => group.tasks.map((task) => task.id));
}

export default function Tasks() {
  const [view, setView] = useState<"today" | "upcoming" | "mine" | "wife" | "shared">("today");
  const [reorderingTaskId, setReorderingTaskId] = useState<number | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: tasks, isLoading } = useListTasks(
    { view },
    { query: { queryKey: getListTasksQueryKey({ view }) } }
  );
  const taskItems = useMemo(() => (tasks ?? []) as GroupableTask[], [tasks]);
  const taskGroups = useMemo<TaskGroup[]>(() => {
    const groups = new Map<string, TaskGroup>();

    for (const task of taskItems) {
      const label = taskGroupLabel(task.category);
      const key = taskGroupKey(label);

      if (!groups.has(key)) {
        groups.set(key, { key, label, tasks: [] });
      }

      groups.get(key)!.tasks.push(task);
    }

    return Array.from(groups.values());
  }, [taskItems]);
  const showGroupHeaders =
    taskGroups.length > 1 || taskGroups.some((group) => group.label !== "Ungrouped");

  function refreshTasks() {
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodaySummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
  }

  async function moveTask(taskId: number, groupKeyValue: string, direction: "up" | "down") {
    const reorderedGroups = taskGroups.map((group) => ({
      ...group,
      tasks: [...group.tasks],
    }));
    const group = reorderedGroups.find((item) => item.key === groupKeyValue);
    if (!group) return;

    const index = group.tasks.findIndex((task) => task.id === taskId);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= group.tasks.length) return;

    const currentTask = group.tasks[index];
    const nextTask = group.tasks[nextIndex];
    if (!currentTask || !nextTask) return;
    group.tasks[index] = nextTask;
    group.tasks[nextIndex] = currentTask;

    try {
      setReorderingTaskId(taskId);
      const res = await apiFetch("/api/tasks/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentTaskId: null,
          orderedIds: orderedTaskIdsFromGroups(reorderedGroups),
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      refreshTasks();
    } catch {
      toast({ title: "Failed to reorder task", variant: "destructive" });
    } finally {
      setReorderingTaskId(null);
    }
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
            <CheckSquare className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Tasks</h1>
        </div>
        <TaskQuickAdd />
      </header>

      <Tabs
        value={view}
        onValueChange={(v) => {
          setView(v as any);
          setReorderMode(false);
        }}
        className="w-full"
      >
        <TabsList className="w-full justify-start h-12 p-1 bg-muted/30 rounded-xl overflow-x-auto flex-nowrap shrink-0 border border-border/50">
          <TabsTrigger value="today" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Today</TabsTrigger>
          <TabsTrigger value="upcoming" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Upcoming</TabsTrigger>
          <TabsTrigger value="mine" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Patrick</TabsTrigger>
          <TabsTrigger value="wife" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Lauren</TabsTrigger>
          <TabsTrigger value="shared" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Shared</TabsTrigger>
        </TabsList>

        <div className="mt-8">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          ) : taskItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 bg-muted/10 rounded-2xl border border-dashed border-border/50">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-2">
                <CheckSquare className="w-6 h-6 opacity-80" />
              </div>
              <h3 className="text-lg font-medium text-foreground">All caught up</h3>
              <p className="text-muted-foreground max-w-sm">No tasks found for this view. Enjoy the downtime or add something new.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {taskItems.length > 1 && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant={reorderMode ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setReorderMode((current) => !current)}
                  >
                    <ArrowUpDown className="h-4 w-4" />
                    {reorderMode ? "Done" : "Reorder"}
                  </Button>
                </div>
              )}
              {taskGroups.map((group) => (
                <section key={group.key} className="space-y-2">
                  {showGroupHeaders && (
                    <div className="flex items-center justify-between gap-3 px-1 pt-2">
                      <h2 className="text-sm font-semibold text-muted-foreground">{group.label}</h2>
                      <div className="text-xs text-muted-foreground">
                        {group.tasks.length} task{group.tasks.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  )}

                  {group.tasks.map((task, i) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      index={i}
                      canMoveUp={reorderMode && i > 0}
                      canMoveDown={reorderMode && i < group.tasks.length - 1}
                      isReordering={reorderingTaskId === task.id}
                      onMoveUp={reorderMode ? () => moveTask(task.id, group.key, "up") : undefined}
                      onMoveDown={reorderMode ? () => moveTask(task.id, group.key, "down") : undefined}
                    />
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
