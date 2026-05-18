import { useMemo, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTasks,
  getListTasksQueryKey,
  getGetTodaySummaryQueryKey,
  getGetHomeSnapshotQueryKey,
  type ListTasksParams,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskQuickAdd } from "@/components/task-quick-add";
import { TaskItem } from "@/components/task-item";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckSquare, GripVertical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-base";
import { cn } from "@/lib/utils";
import {
  getTaskGroups,
  getTaskGroupOptions,
  orderedTaskIdsFromGroups,
  showTaskGroupHeaders,
  type GroupableTask,
  type TaskGroup,
} from "@/lib/task-groups";

type DragState =
  | { type: "task"; taskId: number; sourceGroupKey: string }
  | { type: "group"; groupKey: string };

type DropPosition = "before" | "after";

type TaskDropTarget = {
  groupKey: string;
  taskId: number;
  position: DropPosition;
} | null;

type GroupDropTarget = {
  groupKey: string;
  position: DropPosition;
} | null;

type TaskView = "all" | NonNullable<ListTasksParams["view"]>;

function cloneTaskGroups(groups: readonly TaskGroup[]) {
  return groups.map((group) => ({ ...group, tasks: [...group.tasks] }));
}

function getDropPosition(event: DragEvent<HTMLElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

export default function Tasks() {
  const [view, setView] = useState<TaskView>("all");
  const [reorderingTaskId, setReorderingTaskId] = useState<number | null>(null);
  const [reorderingGroupKey, setReorderingGroupKey] = useState<string | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [taskDropTarget, setTaskDropTarget] = useState<TaskDropTarget>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<GroupDropTarget>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const taskListParams = view === "all" ? undefined : { view };
  
  const { data: tasks, isLoading } = useListTasks(
    taskListParams,
    { query: { queryKey: getListTasksQueryKey(taskListParams) } }
  );
  const { data: allTasks } = useListTasks(undefined, {
    query: { queryKey: getListTasksQueryKey() },
  });
  const taskItems = useMemo(() => (tasks ?? []) as GroupableTask[], [tasks]);
  const parentTaskOptions = useMemo(
    () =>
      ((allTasks ?? []) as GroupableTask[]).map((task) => ({
        id: task.id,
        title: task.title,
      })),
    [allTasks],
  );
  const taskGroupOptions = useMemo(
    () => getTaskGroupOptions((allTasks ?? []) as GroupableTask[]),
    [allTasks],
  );
  const taskGroups = useMemo(() => getTaskGroups(taskItems), [taskItems]);
  const showGroupHeaders = showTaskGroupHeaders(taskGroups);
  const reorderBusy = reorderingTaskId !== null || reorderingGroupKey !== null;

  function refreshTasks() {
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodaySummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
  }

  function clearDragState() {
    setDragState(null);
    setTaskDropTarget(null);
    setGroupDropTarget(null);
  }

  async function persistTaskOrder(reorderedGroups: TaskGroup[], busy: DragState) {
    try {
      if (busy.type === "task") {
        setReorderingTaskId(busy.taskId);
      } else {
        setReorderingGroupKey(busy.groupKey);
      }

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
      toast({
        title: busy.type === "task" ? "Failed to reorder task" : "Failed to reorder task group",
        variant: "destructive",
      });
    } finally {
      setReorderingTaskId(null);
      setReorderingGroupKey(null);
      clearDragState();
    }
  }

  async function reorderTaskByDrop(
    taskId: number,
    sourceGroupKey: string,
    targetTaskId: number,
    targetGroupKey: string,
    position: DropPosition,
  ) {
    if (taskId === targetTaskId || sourceGroupKey !== targetGroupKey) return;

    const reorderedGroups = cloneTaskGroups(taskGroups);
    const group = reorderedGroups.find((item) => item.key === sourceGroupKey);
    if (!group) return;

    const index = group.tasks.findIndex((task) => task.id === taskId);
    const targetIndex = group.tasks.findIndex((task) => task.id === targetTaskId);
    if (index < 0 || targetIndex < 0) return;

    const [task] = group.tasks.splice(index, 1);
    if (!task) return;

    const targetIndexAfterRemoval = group.tasks.findIndex((item) => item.id === targetTaskId);
    if (targetIndexAfterRemoval < 0) return;

    const insertIndex = position === "after" ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
    group.tasks.splice(insertIndex, 0, task);

    await persistTaskOrder(reorderedGroups, { type: "task", taskId, sourceGroupKey });
  }

  async function moveTask(taskId: number, groupKeyValue: string, direction: "up" | "down") {
    if (reorderBusy) return;

    const reorderedGroups = cloneTaskGroups(taskGroups);
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

    await persistTaskOrder(reorderedGroups, { type: "task", taskId, sourceGroupKey: groupKeyValue });
  }

  async function reorderGroupByDrop(groupKeyValue: string, targetGroupKey: string, position: DropPosition) {
    if (groupKeyValue === targetGroupKey) return;

    const reorderedGroups = cloneTaskGroups(taskGroups);
    const index = reorderedGroups.findIndex((group) => group.key === groupKeyValue);
    if (index < 0) return;

    const [group] = reorderedGroups.splice(index, 1);
    if (!group) return;

    const targetIndexAfterRemoval = reorderedGroups.findIndex((item) => item.key === targetGroupKey);
    if (targetIndexAfterRemoval < 0) return;

    const insertIndex = position === "after" ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
    reorderedGroups.splice(insertIndex, 0, group);

    await persistTaskOrder(reorderedGroups, { type: "group", groupKey: groupKeyValue });
  }

  async function moveGroup(groupKeyValue: string, direction: "up" | "down") {
    if (reorderBusy) return;

    const index = taskGroups.findIndex((group) => group.key === groupKeyValue);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= taskGroups.length) return;

    const reorderedGroups = cloneTaskGroups(taskGroups);
    const currentGroup = reorderedGroups[index];
    const nextGroup = reorderedGroups[nextIndex];
    if (!currentGroup || !nextGroup) return;

    reorderedGroups[index] = nextGroup;
    reorderedGroups[nextIndex] = currentGroup;

    await persistTaskOrder(reorderedGroups, { type: "group", groupKey: groupKeyValue });
  }

  function startTaskDrag(event: DragEvent<HTMLDivElement>, taskId: number, sourceGroupKey: string) {
    if (reorderBusy) {
      event.preventDefault();
      return;
    }

    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `task:${taskId}`);
    setDragState({ type: "task", taskId, sourceGroupKey });
  }

  function handleTaskDragOver(event: DragEvent<HTMLDivElement>, taskId: number, groupKeyValue: string) {
    if (
      dragState?.type !== "task" ||
      dragState.sourceGroupKey !== groupKeyValue ||
      dragState.taskId === taskId ||
      reorderBusy
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setTaskDropTarget({ groupKey: groupKeyValue, taskId, position: getDropPosition(event) });
  }

  function handleTaskDragLeave(event: DragEvent<HTMLDivElement>, taskId: number, groupKeyValue: string) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setTaskDropTarget((current) =>
      current?.groupKey === groupKeyValue && current.taskId === taskId ? null : current,
    );
  }

  function handleTaskDrop(event: DragEvent<HTMLDivElement>, targetTaskId: number, targetGroupKey: string) {
    if (dragState?.type !== "task") return;

    event.preventDefault();
    event.stopPropagation();
    const position =
      taskDropTarget?.groupKey === targetGroupKey && taskDropTarget.taskId === targetTaskId
        ? taskDropTarget.position
        : getDropPosition(event);
    void reorderTaskByDrop(dragState.taskId, dragState.sourceGroupKey, targetTaskId, targetGroupKey, position);
  }

  function startGroupDrag(event: DragEvent<HTMLDivElement>, groupKeyValue: string) {
    if (reorderBusy) {
      event.preventDefault();
      return;
    }

    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `group:${groupKeyValue}`);
    setDragState({ type: "group", groupKey: groupKeyValue });
  }

  function handleGroupDragOver(event: DragEvent<HTMLElement>, groupKeyValue: string) {
    if (dragState?.type !== "group" || dragState.groupKey === groupKeyValue || reorderBusy) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setGroupDropTarget({ groupKey: groupKeyValue, position: getDropPosition(event) });
  }

  function handleGroupDragLeave(event: DragEvent<HTMLElement>, groupKeyValue: string) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setGroupDropTarget((current) => (current?.groupKey === groupKeyValue ? null : current));
  }

  function handleGroupDrop(event: DragEvent<HTMLElement>, targetGroupKey: string) {
    if (dragState?.type !== "group") return;

    event.preventDefault();
    const position =
      groupDropTarget?.groupKey === targetGroupKey ? groupDropTarget.position : getDropPosition(event);
    void reorderGroupByDrop(dragState.groupKey, targetGroupKey, position);
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
        <TaskQuickAdd taskGroupOptions={taskGroupOptions} />
      </header>

      <Tabs
        value={view}
        onValueChange={(v) => {
          setView(v as any);
          setReorderMode(false);
          clearDragState();
        }}
        className="w-full"
      >
        <TabsList className="w-full justify-start h-12 p-1 bg-muted/30 rounded-xl overflow-x-auto flex-nowrap shrink-0 border border-border/50">
          <TabsTrigger value="all" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">All</TabsTrigger>
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
                    onClick={() => {
                      setReorderMode((current) => !current);
                      clearDragState();
                    }}
                  >
                    <ArrowUpDown className="h-4 w-4" />
                    {reorderMode ? "Done" : "Reorder"}
                  </Button>
                </div>
              )}
              {taskGroups.map((group, groupIndex) => (
                <section
                  key={group.key}
                  className={cn(
                    "space-y-2 rounded-xl transition-colors",
                    groupDropTarget?.groupKey === group.key && "bg-primary/5 ring-2 ring-primary/30"
                  )}
                  onDragOver={(event) => handleGroupDragOver(event, group.key)}
                  onDragLeave={(event) => handleGroupDragLeave(event, group.key)}
                  onDrop={(event) => handleGroupDrop(event, group.key)}
                >
                  {showGroupHeaders && (
                    <div
                      className={cn(
                        "flex items-center justify-between gap-3 px-1 pt-2",
                        reorderMode && taskGroups.length > 1 && !reorderBusy && "cursor-grab active:cursor-grabbing",
                        dragState?.type === "group" && dragState.groupKey === group.key && "opacity-50"
                      )}
                      draggable={reorderMode && taskGroups.length > 1 && !reorderBusy}
                      aria-grabbed={
                        reorderMode && taskGroups.length > 1
                          ? dragState?.type === "group" && dragState.groupKey === group.key
                          : undefined
                      }
                      onDragStart={(event) => startGroupDrag(event, group.key)}
                      onDragEnd={clearDragState}
                    >
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-muted-foreground">{group.label}</h2>
                        <div className="text-xs text-muted-foreground">
                          {group.tasks.length} task{group.tasks.length === 1 ? "" : "s"}
                        </div>
                      </div>
                      {reorderMode && taskGroups.length > 1 && (
                        <div className="flex shrink-0 items-center gap-1">
                          <div
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground",
                              reorderBusy ? "opacity-40" : "hover:text-foreground"
                            )}
                            aria-label={`Drag ${group.label} group`}
                          >
                            <GripVertical className="h-4 w-4" />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              void moveGroup(group.key, "up");
                            }}
                            disabled={groupIndex === 0 || reorderBusy}
                            aria-label={`Move ${group.label} group up`}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              void moveGroup(group.key, "down");
                            }}
                            disabled={groupIndex === taskGroups.length - 1 || reorderBusy}
                            aria-label={`Move ${group.label} group down`}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {group.tasks.map((task, i) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      index={i}
                      dragEnabled={reorderMode && !reorderBusy}
                      showDragHandle={reorderMode}
                      isDragging={dragState?.type === "task" && dragState.taskId === task.id}
                      isDropTarget={taskDropTarget?.groupKey === group.key && taskDropTarget.taskId === task.id}
                      isReordering={reorderBusy}
                      canMoveUp={reorderMode && !reorderBusy && i > 0}
                      canMoveDown={reorderMode && !reorderBusy && i < group.tasks.length - 1}
                      onMoveUp={reorderMode ? () => void moveTask(task.id, group.key, "up") : undefined}
                      onMoveDown={reorderMode ? () => void moveTask(task.id, group.key, "down") : undefined}
                      onDragStart={(event) => startTaskDrag(event, task.id, group.key)}
                      onDragOver={(event) => handleTaskDragOver(event, task.id, group.key)}
                      onDragLeave={(event) => handleTaskDragLeave(event, task.id, group.key)}
                      onDrop={(event) => handleTaskDrop(event, task.id, group.key)}
                      onDragEnd={clearDragState}
                      parentTaskOptions={parentTaskOptions}
                      taskGroupOptions={taskGroupOptions}
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
