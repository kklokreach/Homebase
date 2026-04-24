import { useState } from "react";
import { useListTasks, getListTasksQueryKey } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskQuickAdd } from "@/components/task-quick-add";
import { TaskItem } from "@/components/task-item";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckSquare } from "lucide-react";

export default function Tasks() {
  const [view, setView] = useState<"today" | "upcoming" | "mine" | "wife" | "shared">("today");
  
  const { data: tasks, isLoading } = useListTasks(
    { view },
    { query: { queryKey: getListTasksQueryKey({ view }) } }
  );

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

      <Tabs value={view} onValueChange={(v) => setView(v as any)} className="w-full">
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
          ) : tasks?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 bg-muted/10 rounded-2xl border border-dashed border-border/50">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-2">
                <CheckSquare className="w-6 h-6 opacity-80" />
              </div>
              <h3 className="text-lg font-medium text-foreground">All caught up</h3>
              <p className="text-muted-foreground max-w-sm">No tasks found for this view. Enjoy the downtime or add something new.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks?.map((task, i) => (
                <TaskItem key={task.id} task={task} index={i} />
              ))}
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
