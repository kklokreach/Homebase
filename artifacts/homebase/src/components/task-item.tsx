import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Clock, Edit2, Trash2, User, Users } from "lucide-react";
import { format } from "date-fns";
import {
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

interface TaskItemProps {
  task: Task;
  index?: number;
  compact?: boolean;
}

export function TaskItem({ task, index = 0, compact = false }: TaskItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editAssignee, setEditAssignee] = useState<string>(task.assignee || "null");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const completeTask = useCompleteTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const handleComplete = (checked: boolean) => {
    completeTask.mutate(
      { id: task.id, data: { completed: checked } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodaySummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
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
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodaySummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
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
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodaySummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
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
        return <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20"><User className="w-3 h-3 mr-1" /> Me</Badge>;
      case "wife":
        return <Badge variant="secondary" className="bg-secondary/10 text-secondary border-secondary/20"><User className="w-3 h-3 mr-1" /> Wife</Badge>;
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
  const assigneeLabel: Record<string, string> = { me: "Me", wife: "Her", us: "Us" };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(
        "group bg-card border rounded-xl overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-bottom-2",
        isOpen ? "shadow-md" : "hover:shadow-sm hover:border-primary/20",
        task.completed && "opacity-50"
      )}
      style={{ animationFillMode: "both", animationDelay: `${index * 50}ms` }}
    >
      <div className={cn("flex items-center gap-3", compact ? "px-3 py-2.5" : "p-3 sm:p-4")}>
        <Checkbox
          checked={task.completed}
          onCheckedChange={handleComplete}
          className="w-5 h-5 rounded-full border-muted-foreground/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-all shrink-0"
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
            
            {!compact && (task.assignee || task.dueDate) && !isOpen && (
              <div className="flex items-center gap-2 mt-1.5 opacity-80">
                {getAssigneeBadge()}
                {task.dueDate && (
                  <div className="flex items-center text-xs text-muted-foreground">
                    <Clock className="w-3 h-3 mr-1" />
                    {format(new Date(task.dueDate), "MMM d")}
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleTrigger>

        {/* Compact: assignee pill + due date inline */}
        {compact && !isOpen && (
          <div className="flex items-center gap-2 shrink-0">
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
          </div>
        )}
      </div>

      <CollapsibleContent className="px-4 pb-4 pt-0">
        <div className="pt-4 border-t border-border/50 animate-in fade-in duration-300">
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
                    <SelectItem value="me">Me</SelectItem>
                    <SelectItem value="wife">Wife</SelectItem>
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
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}