import { format } from "date-fns";
import { ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { useGetHomeSnapshot, getGetHomeSnapshotQueryKey } from "@workspace/api-client-react";
import { TaskItem } from "@/components/task-item";
import { TaskQuickAdd } from "@/components/task-quick-add";
import { Skeleton } from "@/components/ui/skeleton";

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function Home() {
  const { data: snapshot, isLoading, error } = useGetHomeSnapshot({
    query: { queryKey: getGetHomeSnapshotQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="px-4 pt-5 pb-8 space-y-6 max-w-2xl mx-auto">
        <Skeleton className="h-12 w-full rounded-2xl" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) return <div className="px-4 pt-5 max-w-2xl mx-auto text-sm text-destructive">Could not load Homebase. Check that the API is up and DATABASE_URL is set on Render.</div>;
if (!snapshot) return <div className="px-4 pt-5 max-w-2xl mx-auto text-sm text-muted-foreground">No home data returned yet.</div>;

  const { todayTasks, budgetSnapshot, recentTransactions } = snapshot;
  const left = budgetSnapshot.totalLeft;
  const spent = budgetSnapshot.totalSpent;
  const available = budgetSnapshot.totalAvailable;
  const pct = available > 0 ? Math.min(100, Math.round((spent / available) * 100)) : 0;
  const isOver = left < 0;
  const todayDate = format(new Date(), "EEE, MMM d");

  const allTasks = [
    ...todayTasks.me,
    ...todayTasks.wife,
    ...todayTasks.shared,
  ];

  return (
    <div className="flex flex-col min-h-full">
      {/* Sticky quick-add */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/40 px-4 pt-4 pb-3">
        <TaskQuickAdd placeholder="Add a task…" />
      </div>

      <div className="px-4 pt-5 pb-10 space-y-7 max-w-2xl mx-auto w-full">

        {/* Date line */}
        <p className="text-sm text-muted-foreground font-medium tracking-wide">{todayDate}</p>

        {/* Finance snapshot — scannable row */}
        <Link href="/finances">
          <div className="flex items-center justify-between bg-card border border-border/50 rounded-2xl px-5 py-4 hover:border-primary/30 transition-colors cursor-pointer group">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Left this month</p>
              <p className={`text-2xl font-bold tabular-nums ${isOver ? "text-destructive" : "text-foreground"}`}>
                {fmt(left)}
              </p>
            </div>
            <div className="flex items-center gap-6 text-right">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Spent</p>
                <p className="text-base font-semibold tabular-nums text-foreground">{fmt(spent)}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Budget</p>
                <p className="text-base font-semibold tabular-nums text-foreground">{fmt(available)}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </div>
        </Link>

        {/* Progress bar — thin, no label */}
        <div className="h-1 bg-muted rounded-full -mt-4 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isOver ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Today's tasks */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Today</h2>
            <Link href="/tasks">
              <span className="text-xs text-primary hover:underline flex items-center gap-0.5">
                All tasks <ChevronRight className="w-3 h-3" />
              </span>
            </Link>
          </div>

          {allTasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Nothing due today. Enjoy it.
            </div>
          ) : (
            <div className="space-y-2">
              {allTasks.map((task, i) => (
                <TaskItem key={task.id} task={task} index={i} compact />
              ))}
            </div>
          )}
        </section>

        {/* Recent transactions */}
        {recentTransactions.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recent</h2>
              <Link href="/finances">
                <span className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  All spending <ChevronRight className="w-3 h-3" />
                </span>
              </Link>
            </div>
            <div className="divide-y divide-border/40 rounded-2xl border border-border/50 bg-card overflow-hidden">
              {recentTransactions.slice(0, 5).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors">
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium text-foreground truncate">{tx.merchant}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(tx.date + "T00:00:00"), "MMM d")}
                      {tx.categoryName ? ` · ${tx.categoryName}` : ""}
                    </span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-foreground ml-4 shrink-0">
                    {fmt(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
