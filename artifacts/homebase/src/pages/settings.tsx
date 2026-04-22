import { useEffect, useMemo, useState } from "react";
import { addMonths, format, subMonths } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Save,
  Settings as SettingsIcon,
  Trash2,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBudgetDashboard,
  useListBudgetCategories,
  getListBudgetCategoriesQueryKey,
  getGetBudgetDashboardQueryKey,
  getGetHomeSnapshotQueryKey,
  getListTransactionsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

const API_BASE_URL = "https://homebase-ll6f.onrender.com/api";

type DashboardCategory = {
  categoryId: number;
  categoryName: string;
  budgeted: number;
  rollover: number;
  available: number;
  spent: number;
  left: number;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

function money(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function Settings() {
  const now = new Date();
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [budgetDrafts, setBudgetDrafts] = useState<Record<number, string>>({});
  const [savingBudgetId, setSavingBudgetId] = useState<number | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: categories, isLoading } = useListBudgetCategories();
  const { data: dashboard, isLoading: dashboardLoading } = useGetBudgetDashboard(
    { year, month },
    { query: { queryKey: getGetBudgetDashboardQueryKey({ year, month }) } }
  );

  function refresh() {
    queryClient.invalidateQueries({ queryKey: getListBudgetCategoriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBudgetDashboardQueryKey({ year, month }) });
    queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
  }

  useEffect(() => {
    if (!dashboard) return;
    const next: Record<number, string> = {};
    for (const cat of dashboard.categories as DashboardCategory[]) {
      next[cat.categoryId] = String(cat.budgeted ?? 0);
    }
    setBudgetDrafts(next);
  }, [dashboard]);

  const dashboardMap = useMemo(() => {
    const map = new Map<number, DashboardCategory>();
    for (const cat of (dashboard?.categories ?? []) as DashboardCategory[]) {
      map.set(cat.categoryId, cat);
    }
    return map;
  }, [dashboard]);

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      await api("/budget/categories", {
        method: "POST",
        body: JSON.stringify({ name: newCategoryName.trim() }),
      });
      setNewCategoryName("");
      refresh();
      toast({ title: "Category added" });
    } catch {
      toast({ title: "Failed to add category", variant: "destructive" });
    }
  }

  async function handleDeleteCategory(id: number) {
    if (!window.confirm("Delete this category?")) return;

    try {
      await api(`/budget/categories/${id}`, { method: "DELETE" });
      refresh();
      toast({ title: "Category deleted" });
    } catch {
      toast({ title: "Failed to delete category", variant: "destructive" });
    }
  }

  async function handleSaveCategory(id: number) {
    if (!draftName.trim()) return;

    try {
      await api(`/budget/categories/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name: draftName.trim() }),
      });
      setEditingId(null);
      setDraftName("");
      refresh();
      toast({ title: "Category updated" });
    } catch {
      toast({ title: "Failed to update category", variant: "destructive" });
    }
  }

  async function handleSaveBudget(categoryId: number) {
    const budgetAmount = parseFloat(budgetDrafts[categoryId] || "0") || 0;

    try {
      setSavingBudgetId(categoryId);
      await api("/budget/monthly", {
        method: "POST",
        body: JSON.stringify({
          categoryId,
          year,
          month,
          budgetAmount,
        }),
      });
      refresh();
      toast({ title: "Budget updated" });
    } catch {
      toast({ title: "Failed to update budget", variant: "destructive" });
    } finally {
      setSavingBudgetId(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Budget Categories
          </CardTitle>
          <CardDescription>
            Rename categories, delete categories, and edit monthly budget amounts here.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/50 p-3">
            <div className="text-sm font-medium">Budget month</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setViewDate((d) => subMonths(d, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-28 text-center font-medium">{format(viewDate, "MMM yyyy")}</div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setViewDate((d) => addMonths(d, 1))}
                disabled={isCurrentMonth}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <form onSubmit={handleAddCategory} className="flex gap-2">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name..."
              className="bg-background border-border/50"
            />
            <Button type="submit">
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
          </form>

          {isLoading || dashboardLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : categories?.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No categories yet. Add one above.
            </div>
          ) : (
            <div className="space-y-3">
              {categories?.map((cat) => {
                const editing = editingId === cat.id;
                const row = dashboardMap.get(cat.id);

                return (
                  <div
                    key={cat.id}
                    className="rounded-xl border border-border/50 bg-background/50 p-3 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      {!editing ? (
                        <>
                          <div className="min-w-0">
                            <div className="font-medium">{cat.name}</div>
                            <div className="text-xs text-muted-foreground">
                              Available {money(row?.available ?? 0)} · Spent {money(row?.spent ?? 0)} · Left {money(row?.left ?? 0)}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => {
                                setEditingId(cat.id);
                                setDraftName(cat.name);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteCategory(cat.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <Input
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            className="max-w-sm"
                          />
                          <div className="flex gap-2">
                            <Button size="icon" onClick={() => handleSaveCategory(cat.id)}>
                              <Save className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => {
                                setEditingId(null);
                                setDraftName("");
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="grid gap-2 md:grid-cols-[120px_1fr_auto] md:items-center">
                      <div className="text-sm text-muted-foreground">
                        Budget for {format(viewDate, "MMM")}
                      </div>
                      <Input
                        inputMode="decimal"
                        value={budgetDrafts[cat.id] ?? ""}
                        onChange={(e) =>
                          setBudgetDrafts((prev) => ({
                            ...prev,
                            [cat.id]: e.target.value.replace(/[^0-9.]/g, ""),
                          }))
                        }
                        placeholder="0"
                      />
                      <Button
                        onClick={() => handleSaveBudget(cat.id)}
                        disabled={savingBudgetId === cat.id}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {savingBudgetId === cat.id ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
