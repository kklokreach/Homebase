import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTask,
  useListTasks,
  getListTasksQueryKey,
  getGetTodaySummaryQueryKey,
  getGetHomeSnapshotQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { getTaskGroupOptions, type GroupableTask } from "@/lib/task-groups";

const NO_TASK_GROUP_VALUE = "__homebase_no_task_group__";
const NEW_TASK_GROUP_VALUE = "__homebase_new_task_group__";
type TaskListType = "short" | "long" | "weekly";

function findTaskGroupOption(value: string, taskGroupOptions: readonly string[]) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return null;
  return taskGroupOptions.find((group) => group.trim().toLocaleLowerCase() === normalized) ?? null;
}

interface TaskQuickAddProps {
  defaultAssignee?: "me" | "wife" | "us" | null;
  defaultListType?: TaskListType;
  placeholder?: string;
  taskGroupOptions?: string[];
}

export function TaskQuickAdd({
  defaultAssignee = null,
  defaultListType = "short",
  placeholder = "Add a new task...",
  taskGroupOptions: providedTaskGroupOptions,
}: TaskQuickAddProps) {
  const [title, setTitle] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [assignee, setAssignee] = useState<"me" | "wife" | "us" | "null">(defaultAssignee ?? "null");
  const [dueDate, setDueDate] = useState("");
  const [listType, setListType] = useState<TaskListType>(defaultListType);
  const [category, setCategory] = useState("");
  const [categoryMode, setCategoryMode] = useState<"existing" | "new">("existing");
  const [parentTaskId, setParentTaskId] = useState<string>("null");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createTask = useCreateTask();
  const { data: parentTasks } = useListTasks({}, { query: { queryKey: getListTasksQueryKey() } });
  const fallbackTaskGroupOptions = useMemo(
    () => getTaskGroupOptions((parentTasks ?? []) as GroupableTask[]),
    [parentTasks],
  );
  const taskGroupOptions = providedTaskGroupOptions ?? fallbackTaskGroupOptions;
  const matchingCategory = findTaskGroupOption(category, taskGroupOptions);
  const categorySelectValue =
    categoryMode === "new"
      ? NEW_TASK_GROUP_VALUE
      : category.trim()
        ? matchingCategory ?? NEW_TASK_GROUP_VALUE
        : NO_TASK_GROUP_VALUE;

  useEffect(() => {
    setAssignee(defaultAssignee ?? "null");
  }, [defaultAssignee]);

  useEffect(() => {
    setListType(defaultListType);
  }, [defaultListType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || createTask.isPending) return;

    createTask.mutate(
      {
        data: {
          title: title.trim(),
          assignee: assignee === "null" ? null : assignee,
          dueDate: dueDate || null,
          listType,
          category: category.trim() || null,
          parentTaskId: parentTaskId === "null" ? null : Number(parentTaskId),
        } as any,
      },
      {
        onSuccess: () => {
          setTitle("");
          setAssignee(defaultAssignee ?? "null");
          setDueDate("");
          setListType(defaultListType);
          setCategory("");
          setCategoryMode("existing");
          setParentTaskId("null");
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodaySummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
        },
        onError: () => {
          toast({ title: "Failed to add task", variant: "destructive" });
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative group flex items-center">
        <div className="absolute left-4 text-muted-foreground transition-colors group-focus-within:text-primary">
          <Plus className="w-5 h-5" />
        </div>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={placeholder}
          className="h-14 pl-12 pr-32 bg-card border-border/50 shadow-sm rounded-2xl text-base focus-visible:ring-primary focus-visible:border-primary transition-all duration-300"
          disabled={createTask.isPending}
        />
        <div className="absolute right-2 flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 px-3 rounded-xl"
            onClick={() => setShowOptions((open) => !open)}
          >
            Options
            <ChevronDown className={cn("ml-1 h-4 w-4 transition-transform", showOptions && "rotate-180")} />
          </Button>
          <Button
            type="submit"
            size="sm"
            className="h-10 px-4 rounded-xl font-medium transition-all"
            disabled={!title.trim() || createTask.isPending}
          >
            Add
          </Button>
        </div>
      </div>

      {showOptions && (
        <div className="grid gap-3 rounded-2xl border border-border/50 bg-card/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="task-assignee">Assignee</Label>
            <Select value={assignee} onValueChange={(value) => setAssignee(value as "me" | "wife" | "us" | "null")}>
              <SelectTrigger id="task-assignee" className="bg-background">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="null">Unassigned</SelectItem>
                <SelectItem value="me">Patrick</SelectItem>
                <SelectItem value="wife">Lauren</SelectItem>
                <SelectItem value="us">Shared</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-list">List</Label>
            <Select value={listType} onValueChange={(value) => setListType(value as TaskListType)}>
              <SelectTrigger id="task-list" className="bg-background">
                <SelectValue placeholder="Choose list" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="short">Short term</SelectItem>
                <SelectItem value="long">Long term</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-due-date">Due Date</Label>
            <Input
              id="task-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="bg-background"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-category">Group</Label>
            <Select
              value={categorySelectValue}
              onValueChange={(value) => {
                if (value === NO_TASK_GROUP_VALUE) {
                  setCategoryMode("existing");
                  setCategory("");
                  return;
                }

                if (value === NEW_TASK_GROUP_VALUE) {
                  setCategoryMode("new");
                  if (!category.trim() || matchingCategory) setCategory("");
                  return;
                }

                setCategoryMode("existing");
                setCategory(value);
              }}
            >
              <SelectTrigger id="task-category" className="bg-background">
                <SelectValue placeholder="Choose group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TASK_GROUP_VALUE}>No group</SelectItem>
                {taskGroupOptions.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_TASK_GROUP_VALUE}>New group</SelectItem>
              </SelectContent>
            </Select>
            {categorySelectValue === NEW_TASK_GROUP_VALUE && (
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="New group name"
                className="bg-background"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-parent">Parent Task</Label>
            <Select value={parentTaskId} onValueChange={setParentTaskId}>
              <SelectTrigger id="task-parent" className="bg-background">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="null">None</SelectItem>
                {parentTasks?.map((task) => (
                  <SelectItem key={task.id} value={String(task.id)}>
                    {task.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </form>
  );
}
