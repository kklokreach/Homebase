import { useState } from "react";
import { format, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Wallet } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBudgetDashboard,
  useListBudgetCategories,
  useCreateTransaction,
  getGetBudgetDashboardQueryKey,
  getListTransactionsQueryKey,
  getGetHomeSnapshotQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function fmt(n: number, showSign = false) {
  const abs = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  if (showSign && n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

function TransactionForm({ year, month }: { year: number; month: number }) {
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState<string>("null");
  const [showCategory, setShowCategory] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: categories } = useListBudgetCategories();
  const createTransaction = useCreateTransaction();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !merchant || isNaN(Number(amount))) return;

    createTransaction.mutate(
      {
        data: {
          amount: Number(amount),
          merchant,
          categoryId: categoryId === "null" ? null : Number(categoryId),
        },
      },
      {
        onSuccess: () => {
          setAmount("");
          setMerchant("");
          setCategoryId("null");
          setShowCategory(false);
          toast({ title: "Transaction added" });
          queryClient.invalidateQueries({ queryKey: getGetBudgetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
        },
        onError: () => {
          toast({ title: "Failed to add transaction", variant: "destructive" });
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border/50 rounded-2xl px-4 py-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Add spending — {format(new Date(year, month - 1, 1), "MMMM yyyy")}
      </p>
      <div className="flex gap-2 flex-wrap sm:flex-nowrap">
        <div className="relative w-28 shrink-0">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">$</span>
          <Input
            type="number"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="pl-6 font-mono h-10 bg-background border-border/50"
            required
          />
        </div>
        <Input
          placeholder="Merchant"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          className="flex-1 h-10 bg-background border-border/50"
          required
        />
        {showCategory ? (
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="h-10 w-36 bg-background border-border/50">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="null">Uncategorized</SelectItem>
              {categories?.map((cat) => (
                <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-10 text-muted-foreground border-dashed text-sm"
            onClick={() => setShowCategory(true)}
          >
            + Category
          </Button>
        )}
        <Button type="submit" className="h-10 px-5" disabled={createTransaction.isPending || !amount || !merchant}>
          Add
        </Button>
      </div>
    </form>
  );
}

export default function Finances() {
  const now = new Date();
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;

  const { data: dashboard, isLoading } = useGetBudgetDashboard(
    { year, month },
    { query: { queryKey: getGetBudgetDashboardQueryKey({ year, month }) } }
  );

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  return (
    <div className="px-4 pt-5 pb-10 max-w-3xl mx-auto space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-serif font-bold text-foreground">Finances</h1>
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewDate((d) => subMonths(d, 1))}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium w-28 text-center">
            {format(viewDate, "MMM yyyy")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewDate((d) => addMonths(d, 1))}
            disabled={isCurrentMonth}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Quick add */}
      <TransactionForm year={year} month={month} />

      {/* Summary strip */}
      {isLoading || !dashboard ? (
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Budgeted", value: fmt(dashboard.totalBudgeted), color: "" },
              { label: "Rollover", value: fmt(dashboard.totalRollover, true), color: dashboard.totalRollover >= 0 ? "text-primary" : "text-destructive" },
              { label: "Available", value: fmt(dashboard.totalAvailable), color: "text-primary" },
              { label: "Left", value: fmt(dashboard.totalLeft), color: dashboard.totalLeft < 0 ? "text-destructive" : "text-secondary" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-card border border-border/50 rounded-xl px-4 py-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">{label}</p>
                <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
              </div>
            ))}
          </div>

          {/* Spent progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{fmt(dashboard.totalSpent)} spent</span>
              <span>{dashboard.totalAvailable > 0 ? Math.round((dashboard.totalSpent / dashboard.totalAvailable) * 100) : 0}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  dashboard.totalLeft < 0 ? "bg-destructive" : "bg-primary"
                )}
                style={{
                  width: `${dashboard.totalAvailable > 0 ? Math.min(100, (dashboard.totalSpent / dashboard.totalAvailable) * 100) : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Categories table */}
          <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
            {/* Desktop: full table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Budgeted</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rollover</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Spent</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Left</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {dashboard.categories.map((cat) => (
                    <tr key={cat.categoryId} className="hover:bg-muted/10 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-foreground">{cat.categoryName}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-muted-foreground">{fmt(cat.budgeted)}</td>
                      <td className={cn(
                        "px-4 py-3.5 text-right tabular-nums font-medium",
                        cat.rollover > 0 ? "text-primary" : cat.rollover < 0 ? "text-destructive" : "text-muted-foreground"
                      )}>
                        {fmt(cat.rollover, true)}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-foreground">{fmt(cat.available)}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-foreground">{fmt(cat.spent)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={cn(
                          "inline-block tabular-nums px-2 py-0.5 rounded-md font-semibold text-sm",
                          cat.left < 0
                            ? "bg-destructive/10 text-destructive"
                            : cat.left === 0
                            ? "bg-muted/30 text-muted-foreground"
                            : "bg-primary/10 text-primary"
                        )}>
                          {fmt(cat.left)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border/50 bg-muted/10">
                    <td className="px-5 py-3 font-semibold text-foreground text-sm">Total</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(dashboard.totalBudgeted)}</td>
                    <td className={cn(
                      "px-4 py-3 text-right tabular-nums font-semibold",
                      dashboard.totalRollover >= 0 ? "text-primary" : "text-destructive"
                    )}>
                      {fmt(dashboard.totalRollover, true)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-primary">{fmt(dashboard.totalAvailable)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(dashboard.totalSpent)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn(
                        "inline-block tabular-nums px-2 py-0.5 rounded-md font-bold text-sm",
                        dashboard.totalLeft < 0
                          ? "bg-destructive/10 text-destructive"
                          : "bg-primary/10 text-primary"
                      )}>
                        {fmt(dashboard.totalLeft)}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile: card list */}
            <div className="sm:hidden divide-y divide-border/40">
              {dashboard.categories.map((cat) => (
                <div key={cat.categoryId} className="px-4 py-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{cat.categoryName}</span>
                    <span className={cn(
                      "tabular-nums px-2 py-0.5 rounded-md font-semibold text-sm",
                      cat.left < 0
                        ? "bg-destructive/10 text-destructive"
                        : cat.left === 0
                        ? "bg-muted/30 text-muted-foreground"
                        : "bg-primary/10 text-primary"
                    )}>
                      {fmt(cat.left)} left
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Budget <span className="text-foreground font-medium">{fmt(cat.budgeted)}</span></span>
                    <span className={cn(
                      "font-medium",
                      cat.rollover > 0 ? "text-primary" : cat.rollover < 0 ? "text-destructive" : ""
                    )}>
                      {cat.rollover !== 0 && <>Rollover {fmt(cat.rollover, true)}</>}
                    </span>
                    <span>Spent <span className="text-foreground font-medium">{fmt(cat.spent)}</span></span>
                  </div>
                  {/* Mini progress */}
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", cat.left < 0 ? "bg-destructive" : "bg-primary")}
                      style={{ width: `${cat.available > 0 ? Math.min(100, (cat.spent / cat.available) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent transactions for this month */}
          {dashboard.recentTransactions.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Transactions — {format(viewDate, "MMMM")}
              </h2>
              <div className="divide-y divide-border/40 rounded-2xl border border-border/50 bg-card overflow-hidden">
                {dashboard.recentTransactions.map((tx) => (
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
