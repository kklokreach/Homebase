import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, ChevronDown, Clock, Edit2, ListChecks, Plus, Trash2, User, Users } from "lucide-react";
import { format } from "date-fns";
import {
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useCompleteTask,
  getListTasksQueryKey,
  getGetTodaySummaryQueryKey,
  getGetHomeSnapshotQueryKey,
} from "@workspace/api-client-react";
import type { Task } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type TaskWithSubtasks = Task & {
  parentTaskId?: number | null;
  sortOrder?: number;
  subtaskSummary?: {
    total: number;
    completed: number;
    progress: number;
  };
  subtasks?: TaskWithSubtasks[];
};

interface TaskItemProps {
  task: TaskWithSubtasks;
  index?: number;
  compact?: boolean;
  isSubtask?: boolean;
}

export function TaskItem({ task, index = 0, compact = false, isSubtask = false }: TaskItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [editTitle, setEditTitle] = useState(task.title);
  const [editAssignee, setEditAssignee] = useState<string>(task.assignee || "null");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createTask = useCreateTask();
  const completeTask = useCompleteTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const hasSubtasks = (task.subtaskSummary?.total ?? 0) > 0 || (task.subtasks?.length ?? 0) > 0;
  const subtaskSummary = task.subtaskSummary ?? {
    total: task.subtasks?.length ?? 0,
    completed: task.subtasks?.filter((subtask) => subtask.completed).length ?? 0,
    progress:
      (task.subtasks?.length ?? 0) > 0
        ? (task.subtasks?.filter((subtask) => subtask.completed).length ?? 0) / (task.subtasks?.length ?? 1)
        : 0,
  };

  const invalidateTaskQueries = () => {
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodaySummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
  };

  const handleComplete = (checked: boolean) => {
    if (hasSubtasks) return;
    completeTask.mutate(
      { id: task.id, data: { completed: checked } },
      {
        onSuccess: () => {
          invalidateTaskQueries();
        },
        onError: () => {
          toast({ title: "Failed to update task", variant: "destructive" });
        },
      }
    );
  };

  const handleSave = () => {
    updateTask.mutate(
      {
        id: task.id,
        data: {
          title: editTitle,
          assignee: editAssignee === "null" ? null : (editAssignee as any),
        },
      },
      {
        onSuccess: () => {
          setIsEditing(false);
          invalidateTaskQueries();
        },
        onError: () => {
          toast({ title: "Failed to save task", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = () => {
    deleteTask.mutate(
      { id: task.id },
      {
        onSuccess: () => {
          invalidateTaskQueries();
        },
        onError: () => {
          toast({ title: "Failed to delete task", variant: "destructive" });
        },
      }
    );
  };

  const getAssigneeBadge = () => {
    if (!task.assignee) return null;
    
    switch (task.assignee) {
      case "me":
        return <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20"><User className="w-3 h-3 mr-1" /> Patrick</Badge>;
      case "wife":
        return <Badge variant="secondary" className="bg-secondary/10 text-secondary border-secondary/20"><User className="w-3 h-3 mr-1" /> Lauren</Badge>;
      case "us":
        return <Badge variant="secondary" className="bg-chart-3/10 text-chart-3 border-chart-3/20"><Users className="w-3 h-3 mr-1" /> Us</Badge>;
      default:
        return null;
    }
  };

  const assigneeColors: Record<string, string> = {
    me: "bg-primary text-primary-foreground",
    wife: "bg-secondary text-secondary-foreground",
    us: "bg-chart-3/80 text-white",
  };
  const assigneeLabel: Record<string, string> = { me: "Patrick", wife: "Lauren", us: "Us" };

  const handleCreateSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim() || createTask.isPending) return;

    createTask.mutate(
      {
        data: {
          title: newSubtaskTitle.trim(),
          assignee: task.assignee ?? null,
          parentTaskId: task.id,
        } as any,
      },
      {
        onSuccess: () => {
          setNewSubtaskTitle("");
          setIsOpen(true);
          invalidateTaskQueries();
        },
        onError: () => {
          toast({ title: "Failed to add subtask", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(
        "group bg-card border rounded-xl overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-bottom-2",
        isOpen ? "shadow-md" : "hover:shadow-sm hover:border-primary/20",
        task.completed && "opacity-50",
        isSubtask && "border-border/60 bg-background/70"
      )}
      style={{ animationFillMode: "both", animationDelay: `${index * 50}ms` }}
    >
      <div className={cn("flex items-center gap-3", compact ? "px-3 py-2.5" : "p-3 sm:p-4")}>
        <Checkbox
          checked={task.completed}
          onCheckedChange={handleComplete}
          disabled={hasSubtasks}
          className="w-5 h-5 rounded-full border-muted-foreground/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-all shrink-0 disabled:opacity-70"
        />
        
        <CollapsibleTrigger asChild>
          <div className="flex-1 cursor-pointer select-none min-w-0">
            <div className={cn(
              "transition-all duration-300 truncate",
              compact ? "text-sm font-medium" : "text-base font-medium",
              task.completed ? "line-through text-muted-foreground" : "text-foreground"
            )}>
              {task.title}
            </div>
            
            {!compact && ((task.assignee || task.dueDate) || hasSubtasks) && !isOpen && (
              <div className="flex flex-wrap items-center gap-2 mt-1.5 opacity-80">
                {getAssigneeBadge()}
                {task.dueDate && (
                  <div className="flex items-center text-xs text-muted-foreground">
                    <Clock className="w-3 h-3 mr-1" />
                    {format(new Date(task.dueDate), "MMM d")}
                  </div>
                )}
                {hasSubtasks && (
                  <div className="flex items-center text-xs text-muted-foreground">
                    <ListChecks className="w-3 h-3 mr-1" />
                    {subtaskSummary.completed}/{subtaskSummary.total}
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleTrigger>

        {/* Compact: assignee pill + due date inline */}
        {compact && !isOpen && (
          <div className="flex items-center gap-2 shrink-0">
            {hasSubtasks && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {subtaskSummary.completed}/{subtaskSummary.total}
              </span>
            )}
            {task.dueDate && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {format(new Date(task.dueDate + "T00:00:00"), "MMM d")}
              </span>
            )}
            {task.assignee && (
              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none", assigneeColors[task.assignee] || "bg-muted text-muted-foreground")}>
                {assigneeLabel[task.assignee] || task.assignee}
              </span>
            )}
            {(hasSubtasks || task.notes || task.dueDate || task.assignee) && (
              <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            )}
          </div>
        )}
      </div>

      <CollapsibleContent className="px-4 pb-4 pt-0">
        <div className="pt-4 border-t border-border/50 animate-in fade-in duration-300">
          {hasSubtasks && !isEditing && (
            <div className="mb-4 space-y-3">
              <div className="rounded-xl bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="font-medium">Subtasks</div>
                  <div className="text-muted-foreground">
                    {subtaskSummary.completed}/{subtaskSummary.total} complete
                  </div>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.round(subtaskSummary.progress * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {isEditing ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label>Assignee</Label>
                <Select value={editAssignee} onValueChange={setEditAssignee}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="null">Unassigned</SelectItem>
                    <SelectItem value="me">Patrick</SelectItem>
                    <SelectItem value="wife">Lauren</SelectItem>
                    <SelectItem value="us">Us</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button size="sm" onClick={handleSave}>Save Changes</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              {task.notes && (
                <div className="w-full mb-2 text-foreground/80 bg-muted/30 p-3 rounded-lg text-sm whitespace-pre-wrap">
                  {task.notes}
                </div>
              )}
              
              <div className="w-full flex items-center justify-between mt-2 pt-2">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider font-semibold opacity-50 mb-1">Assignee</span>
                    <div>{getAssigneeBadge() || <span className="text-xs">Unassigned</span>}</div>
                  </div>
                  
                  {task.dueDate && (
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider font-semibold opacity-50 mb-1">Due Date</span>
                      <div className="flex items-center text-xs text-foreground font-medium">
                        <Clock className="w-3.5 h-3.5 mr-1.5 text-primary" />
                        {format(new Date(task.dueDate), "MMM d, yyyy")}
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setIsEditing(true)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={handleDelete}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {!isSubtask && (
                <div className="w-full mt-4 space-y-3">
                  <form onSubmit={handleCreateSubtask} className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Plus className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        value={newSubtaskTitle}
                        onChange={(e) => setNewSubtaskTitle(e.target.value)}
                        placeholder="Add subtask"
                        className="pl-9"
                        disabled={createTask.isPending}
                      />
                    </div>
                    <Button type="submit" size="sm" disabled={!newSubtaskTitle.trim() || createTask.isPending}>
                      Add
                    </Button>
                  </form>

                  {(task.subtasks?.length ?? 0) > 0 && (
                    <div className="space-y-2 pl-1">
                      {task.subtasks!.map((subtask, subtaskIndex) => (
                        <TaskItem
                          key={subtask.id}
                          task={subtask}
                          index={subtaskIndex}
                          compact
                          isSubtask
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
