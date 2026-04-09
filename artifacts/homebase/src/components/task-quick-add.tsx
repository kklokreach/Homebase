import { useState } from "react";
import { Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTask,
  getListTasksQueryKey,
  getGetTodaySummaryQueryKey,
  getGetHomeSnapshotQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface TaskQuickAddProps {
  defaultAssignee?: "me" | "wife" | "us" | null;
  placeholder?: string;
}

export function TaskQuickAdd({ defaultAssignee = null, placeholder = "Add a new task..." }: TaskQuickAddProps) {
  const [title, setTitle] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createTask = useCreateTask();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || createTask.isPending) return;

    createTask.mutate(
      {
        data: {
          title: title.trim(),
          assignee: defaultAssignee,
        },
      },
      {
        onSuccess: () => {
          setTitle("");
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
    <form onSubmit={handleSubmit} className="relative group flex items-center">
      <div className="absolute left-4 text-muted-foreground transition-colors group-focus-within:text-primary">
        <Plus className="w-5 h-5" />
      </div>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        className="h-14 pl-12 pr-24 bg-card border-border/50 shadow-sm rounded-2xl text-base focus-visible:ring-primary focus-visible:border-primary transition-all duration-300"
        disabled={createTask.isPending}
      />
      <Button
        type="submit"
        size="sm"
        className="absolute right-2 h-10 px-4 rounded-xl font-medium transition-all"
        disabled={!title.trim() || createTask.isPending}
      >
        Add
      </Button>
    </form>
  );
}