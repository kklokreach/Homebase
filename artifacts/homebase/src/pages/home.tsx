import { format } from "date-fns";
import { Calendar, ChevronRight, ListTodo, Wallet } from "lucide-react";
import { Link } from "wouter";
import { useGetHomeSnapshot, getGetHomeSnapshotQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskItem } from "@/components/task-item";
import { TaskQuickAdd } from "@/components/task-quick-add";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

export default function Home() {
  const { data: snapshot, isLoading } = useGetHomeSnapshot({
    query: { queryKey: getGetHomeSnapshotQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 space-y-8 animate-in fade-in duration-500">
        <div className="space-y-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!snapshot) return null;

  const todayDate = format(new Date(), "EEEE, MMMM d");
  const budgetTotal = snapshot.budgetSnapshot.totalAvailable + snapshot.budgetSnapshot.totalSpent;
  const budgetProgress = budgetTotal > 0 
    ? (snapshot.budgetSnapshot.totalSpent / budgetTotal) * 100 
    : 0;

  return (
    <div className="p-6 md:p-10 space-y-10 animate-in fade-in duration-700">
      <header className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground tracking-tight">
          Good morning.
        </h1>
        <p className="text-muted-foreground text-lg flex items-center">
          <Calendar className="w-5 h-5 mr-2 opacity-70" />
          {todayDate}
        </p>
      </header>

      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center text-foreground">
            <ListTodo className="w-5 h-5 mr-2 text-primary" />
            Today's Focus
          </h2>
          <Link href="/tasks">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              See all <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
        
        <TaskQuickAdd placeholder="What needs to happen today?" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
          {/* Me Column */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <h3 className="font-medium text-primary">Me</h3>
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                {snapshot.todayTasks.me.length}
              </span>
            </div>
            <div className="space-y-3">
              {snapshot.todayTasks.me.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center bg-muted/20 rounded-xl border border-dashed border-border/50">
                  All clear for today.
                </div>
              ) : (
                snapshot.todayTasks.me.map((task, i) => (
                  <TaskItem key={task.id} task={task} index={i} />
                ))
              )}
            </div>
          </div>

          {/* Us Column */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <h3 className="font-medium text-chart-3">Us</h3>
              <span className="text-xs bg-chart-3/10 text-chart-3 px-2 py-0.5 rounded-full font-medium">
                {snapshot.todayTasks.shared.length}
              </span>
            </div>
            <div className="space-y-3">
              {snapshot.todayTasks.shared.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center bg-muted/20 rounded-xl border border-dashed border-border/50">
                  Nothing shared today.
                </div>
              ) : (
                snapshot.todayTasks.shared.map((task, i) => (
                  <TaskItem key={task.id} task={task} index={i} />
                ))
              )}
            </div>
          </div>

          {/* Wife Column */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <h3 className="font-medium text-secondary">Wife</h3>
              <span className="text-xs bg-secondary/10 text-secondary px-2 py-0.5 rounded-full font-medium">
                {snapshot.todayTasks.wife.length}
              </span>
            </div>
            <div className="space-y-3">
              {snapshot.todayTasks.wife.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center bg-muted/20 rounded-xl border border-dashed border-border/50">
                  All clear for today.
                </div>
              ) : (
                snapshot.todayTasks.wife.map((task, i) => (
                  <TaskItem key={task.id} task={task} index={i} />
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
        <Card className="bg-card border-border/50 shadow-sm overflow-hidden">
          <CardHeader className="pb-4 bg-muted/20 border-b border-border/50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center font-medium">
                <Wallet className="w-5 h-5 mr-2 text-chart-1" />
                Budget Snapshot
              </CardTitle>
              <Link href="/finances">
                <Button variant="ghost" size="sm" className="h-8">Details</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Available</p>
                <p className="text-2xl font-serif font-semibold text-foreground">
                  ${snapshot.budgetSnapshot.totalAvailable.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Spent</p>
                <p className="text-2xl font-serif font-semibold text-foreground">
                  ${snapshot.budgetSnapshot.totalSpent.toFixed(2)}
                </p>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Month Progress</span>
                <span className="font-medium">{Math.round(budgetProgress)}%</span>
              </div>
              <Progress value={budgetProgress} className="h-2.5 bg-muted" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50 shadow-sm">
          <CardHeader className="pb-4 bg-muted/20 border-b border-border/50">
            <CardTitle className="text-lg flex items-center font-medium">
              Recent Transactions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {snapshot.recentTransactions.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No recent transactions.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {snapshot.recentTransactions.slice(0, 4).map((tx) => (
                  <div key={tx.id} className="flex justify-between items-center p-4 hover:bg-muted/10 transition-colors">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{tx.merchant}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(tx.date), "MMM d")} • {tx.categoryName || "Uncategorized"}
                      </span>
                    </div>
                    <span className="font-medium font-mono">${tx.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}