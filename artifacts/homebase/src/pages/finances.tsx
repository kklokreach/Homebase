import { useState } from "react";
import { format } from "date-fns";
import { Plus, Receipt, TrendingDown, Wallet } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBudgetDashboard,
  useListBudgetCategories,
  useCreateTransaction,
  getGetBudgetDashboardQueryKey,
  getListTransactionsQueryKey,
  getGetHomeSnapshotQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function TransactionForm() {
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState<string>("null");
  const [isExpanded, setIsExpanded] = useState(false);
  
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
        }
      },
      {
        onSuccess: () => {
          setAmount("");
          setMerchant("");
          setCategoryId("null");
          setIsExpanded(false);
          toast({ title: "Transaction added successfully" });
          queryClient.invalidateQueries({ queryKey: getGetBudgetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
        },
        onError: () => {
          toast({ title: "Failed to add transaction", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Card className="bg-primary/5 border-primary/20 overflow-hidden shadow-sm transition-all duration-300">
      <form onSubmit={handleSubmit}>
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-primary flex items-center">
              <Plus className="w-4 h-4 mr-1" /> Quick Add
            </h3>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
            <div className="sm:col-span-3 space-y-1.5">
              <Label className="text-xs uppercase tracking-wider opacity-70">Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">$</span>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pl-7 font-mono text-lg bg-background border-border/50 h-12"
                  required
                />
              </div>
            </div>
            <div className="sm:col-span-5 space-y-1.5">
              <Label className="text-xs uppercase tracking-wider opacity-70">Merchant</Label>
              <Input
                placeholder="Where?"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className="bg-background border-border/50 h-12"
                required
              />
            </div>
            <div className="sm:col-span-4 flex gap-3 h-12">
              {isExpanded ? (
                <div className="flex-1">
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger className="h-12 bg-background border-border/50">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="null">Uncategorized</SelectItem>
                      {categories?.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <Button 
                  type="button" 
                  variant="outline" 
                  className="flex-1 h-12 bg-background border-dashed border-border/60 hover:bg-muted/50 text-muted-foreground"
                  onClick={() => setIsExpanded(true)}
                >
                  + Category
                </Button>
              )}
              <Button type="submit" className="h-12 px-6" disabled={createTransaction.isPending || !amount || !merchant}>
                Add
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Card>
  );
}

export default function Finances() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  
  const { data: dashboard, isLoading } = useGetBudgetDashboard(
    { year: currentYear, month: currentMonth },
    { query: { queryKey: getGetBudgetDashboardQueryKey({ year: currentYear, month: currentMonth }) } }
  );

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-chart-2/10 rounded-xl text-chart-2">
            <Wallet className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Finances</h1>
        </div>
        
        <TransactionForm />
      </header>

      <Tabs defaultValue="monthly" className="w-full">
        <TabsList className="w-full sm:w-auto h-12 p-1 bg-muted/30 rounded-xl border border-border/50 mb-6">
          <TabsTrigger value="monthly" className="px-8 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Monthly Review</TabsTrigger>
          <TabsTrigger value="annual" className="px-8 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Annual Review</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly" className="space-y-8 mt-0 focus-visible:outline-none focus-visible:ring-0">
          {isLoading || !dashboard ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
              </div>
              <Skeleton className="h-64 rounded-xl w-full" />
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-card shadow-sm border-border/50">
                  <CardContent className="p-5 flex flex-col justify-center h-full">
                    <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Budgeted</span>
                    <span className="text-2xl font-serif font-semibold">${dashboard.totalBudgeted.toFixed(0)}</span>
                  </CardContent>
                </Card>
                <Card className="bg-card shadow-sm border-border/50">
                  <CardContent className="p-5 flex flex-col justify-center h-full">
                    <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Available</span>
                    <span className="text-2xl font-serif font-semibold text-primary">${dashboard.totalAvailable.toFixed(0)}</span>
                  </CardContent>
                </Card>
                <Card className="bg-card shadow-sm border-border/50">
                  <CardContent className="p-5 flex flex-col justify-center h-full">
                    <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Spent</span>
                    <span className="text-2xl font-serif font-semibold">${dashboard.totalSpent.toFixed(0)}</span>
                  </CardContent>
                </Card>
                <Card className="bg-card shadow-sm border-border/50">
                  <CardContent className="p-5 flex flex-col justify-center h-full">
                    <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Left</span>
                    <span className={cn(
                      "text-2xl font-serif font-semibold",
                      dashboard.totalLeft < 0 ? "text-destructive" : "text-secondary"
                    )}>
                      ${dashboard.totalLeft.toFixed(0)}
                    </span>
                  </CardContent>
                </Card>
              </div>

              {/* Categories Table */}
              <Card className="bg-card border-border/50 shadow-sm overflow-hidden">
                <CardHeader className="bg-muted/20 border-b border-border/50 py-4 px-6">
                  <CardTitle className="text-base font-medium flex items-center">
                    <Receipt className="w-4 h-4 mr-2 text-muted-foreground" />
                    Categories Overview
                  </CardTitle>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-muted-foreground uppercase tracking-wider bg-muted/10">
                      <tr>
                        <th className="px-6 py-4 font-medium">Category</th>
                        <th className="px-6 py-4 font-medium text-right">Available</th>
                        <th className="px-6 py-4 font-medium text-right">Spent</th>
                        <th className="px-6 py-4 font-medium text-right">Left</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {dashboard.categories.map((cat, i) => (
                        <tr key={cat.categoryId} className="hover:bg-muted/10 transition-colors" style={{ animationDelay: `${i * 30}ms` }}>
                          <td className="px-6 py-4 font-medium text-foreground">{cat.categoryName}</td>
                          <td className="px-6 py-4 text-right font-mono text-muted-foreground">${cat.available.toFixed(0)}</td>
                          <td className="px-6 py-4 text-right font-mono">${cat.spent.toFixed(0)}</td>
                          <td className="px-6 py-4 text-right font-mono">
                            <span className={cn(
                              "px-2.5 py-1 rounded-md font-semibold",
                              cat.left < 0 ? "bg-destructive/10 text-destructive" : 
                              cat.left === 0 ? "bg-muted/30 text-muted-foreground" : "bg-secondary/10 text-secondary"
                            )}>
                              ${cat.left.toFixed(0)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="annual" className="mt-0 pt-8 flex items-center justify-center text-muted-foreground focus-visible:outline-none focus-visible:ring-0">
          <div className="text-center space-y-3 p-12 bg-muted/20 border border-dashed border-border/50 rounded-2xl w-full">
            <TrendingDown className="w-10 h-10 mx-auto text-muted-foreground/50" />
            <h3 className="text-lg font-medium text-foreground">Annual Review</h3>
            <p>This view is under construction.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}