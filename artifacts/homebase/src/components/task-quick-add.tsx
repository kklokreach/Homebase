import { useState } from "react";
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

interface TaskQuickAddProps {
  defaultAssignee?: "me" | "wife" | "us" | null;
  placeholder?: string;
}

export function TaskQuickAdd({ defaultAssignee = null, placeholder = "Add a new task..." }: TaskQuickAddProps) {
  const [title, setTitle] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [assignee, setAssignee] = useState<"me" | "wife" | "us" | "null">(defaultAssignee ?? "null");
  const [parentTaskId, setParentTaskId] = useState<string>("null");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createTask = useCreateTask();
  const { data: parentTasks } = useListTasks({}, { query: { queryKey: getListTasksQueryKey() } });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || createTask.isPending) return;

    createTask.mutate(
      {
        data: {
          title: title.trim(),
          assignee: assignee === "null" ? null : assignee,
          parentTaskId: parentTaskId === "null" ? null : Number(parentTaskId),
        } as any,
      },
      {
        onSuccess: () => {
          setTitle("");
          setAssignee("null");
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
        <div className="grid gap-3 rounded-2xl border border-border/50 bg-card/60 p-4 sm:grid-cols-2">
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
