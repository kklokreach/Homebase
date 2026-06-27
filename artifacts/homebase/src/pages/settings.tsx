import { useEffect, useMemo, useState, type FormEvent } from "react";
import { addMonths, format, subMonths } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Trash2,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetBudgetDashboardQueryKey,
  getGetHomeSnapshotQueryKey,
  getListBudgetCategoriesQueryKey,
  getListTransactionsQueryKey,
  useGetBudgetDashboard,
  useListBudgetCategories,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-base";
import { cn } from "@/lib/utils";

type BudgetCategory = {
  id: number;
  name: string;
  groupName?: string | null;
  sortOrder: number;
};

type DashboardCategory = {
  categoryId: number;
  categoryName: string;
  budgeted: number;
  computedRollover: number;
  rolloverOverride?: number | null;
  rollover: number;
  available: number;
  spent: number;
  left: number;
};

type DashboardWithIncome = {
  incomeAmount?: number;
  incomeRemaining?: number;
  totalBudgeted?: number;
  categories: DashboardCategory[];
};

type CategoryGroup = {
  key: string;
  label: string;
  categories: BudgetCategory[];
  budgeted: number;
  rollover: number;
  available: number;
  spent: number;
  left: number;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api${path}`, {
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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function cleanSignedMoneyInput(value: string) {
  const negative = value.trimStart().startsWith("-");
  const cleaned = value.replace(/[^0-9.]/g, "");
  const [first, ...rest] = cleaned.split(".");
  const amount = rest.length === 0 ? first : `${first}.${rest.join("")}`;
  return negative ? `-${amount}` : amount;
}

function cleanMoneyInput(value: string) {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const [first, ...rest] = cleaned.split(".");
  return rest.length === 0 ? first : `${first}.${rest.join("")}`;
}

function parseMoneyDraft(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupLabel(groupName?: string | null) {
  return groupName?.trim() || "Ungrouped";
}

function groupKey(label: string) {
  return label.trim().toLocaleLowerCase();
}

function orderedIdsFromGroups(groups: CategoryGroup[]) {
  return groups.flatMap((group) => group.categories.map((cat) => cat.id));
}

export default function Settings() {
  const now = new Date();
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryGroup, setNewCategoryGroup] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftGroup, setDraftGroup] = useState("");
  const [budgetDrafts, setBudgetDrafts] = useState<Record<number, string>>({});
  const [rolloverDrafts, setRolloverDrafts] = useState<Record<number, string>>({});
  const [touchedRolloverIds, setTouchedRolloverIds] = useState<Set<number>>(() => new Set());
  const [savingBudgetId, setSavingBudgetId] = useState<number | null>(null);
  const [reorderingCategoryId, setReorderingCategoryId] = useState<number | null>(null);
  const [reorderingGroupKey, setReorderingGroupKey] = useState<string | null>(null);
  const [incomeDraft, setIncomeDraft] = useState("");
  const [savingIncome, setSavingIncome] = useState(false);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: categories, isLoading } = useListBudgetCategories();
  const { data: dashboard, isLoading: dashboardLoading } = useGetBudgetDashboard(
    { year, month },
    { query: { queryKey: getGetBudgetDashboardQueryKey({ year, month }) } },
  );
  const dashboardView = dashboard as DashboardWithIncome | undefined;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: getListBudgetCategoriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBudgetDashboardQueryKey({ year, month }) });
    queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
  }

  useEffect(() => {
    if (!dashboardView) return;
    const nextBudgets: Record<number, string> = {};
    const nextRollovers: Record<number, string> = {};
    for (const cat of dashboardView.categories as DashboardCategory[]) {
      nextBudgets[cat.categoryId] = String(cat.budgeted ?? 0);
      nextRollovers[cat.categoryId] = String(cat.rollover ?? 0);
    }
    setBudgetDrafts(nextBudgets);
    setRolloverDrafts(nextRollovers);
    setTouchedRolloverIds(new Set());
  }, [dashboardView]);

  useEffect(() => {
    if (!dashboardView) return;
    setIncomeDraft(String(dashboardView.incomeAmount ?? 0));
  }, [dashboardView?.incomeAmount, year, month]);

  const dashboardMap = useMemo(() => {
    const map = new Map<number, DashboardCategory>();
    for (const cat of (dashboardView?.categories ?? []) as DashboardCategory[]) {
      map.set(cat.categoryId, cat);
    }
    return map;
  }, [dashboardView]);

  const totalBudgetDrafted = useMemo(() => {
    const categoryList = (categories ?? []) as BudgetCategory[];
    if (categoryList.length === 0) {
      return dashboardView?.totalBudgeted ?? 0;
    }

    return categoryList.reduce((sum, cat) => {
      const draft = budgetDrafts[cat.id];
      const savedAmount = dashboardMap.get(cat.id)?.budgeted ?? 0;
      return sum + (draft === undefined ? savedAmount : parseMoneyDraft(draft));
    }, 0);
  }, [budgetDrafts, categories, dashboardMap, dashboardView?.totalBudgeted]);
  const plannedIncomeAmount = parseMoneyDraft(incomeDraft);
  const budgetedIncomeRemaining = plannedIncomeAmount - totalBudgetDrafted;
  const budgetedIncomeState =
    Math.abs(budgetedIncomeRemaining) < 0.005
      ? "balanced"
      : budgetedIncomeRemaining < 0
      ? "over"
      : "under";
  const budgetedIncomeLabel =
    budgetedIncomeState === "balanced"
      ? "Fully planned"
      : budgetedIncomeState === "over"
      ? "Over planned"
      : "Left to plan";
  const budgetedIncomeSummary =
    budgetedIncomeState === "balanced"
      ? budgetedIncomeLabel
      : `${budgetedIncomeLabel} ${money(Math.abs(budgetedIncomeRemaining))}`;

  const categoryGroups = useMemo<CategoryGroup[]>(() => {
    const groups = new Map<string, CategoryGroup>();

    for (const cat of (categories ?? []) as BudgetCategory[]) {
      const label = groupLabel(cat.groupName);
      const key = groupKey(label);

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          categories: [],
          budgeted: 0,
          rollover: 0,
          available: 0,
          spent: 0,
          left: 0,
        });
      }

      const group = groups.get(key)!;
      const row = dashboardMap.get(cat.id);

      group.categories.push(cat);
      group.budgeted += row?.budgeted ?? 0;
      group.rollover += row?.rollover ?? 0;
      group.available += row?.available ?? 0;
      group.spent += row?.spent ?? 0;
      group.left += row?.left ?? 0;
    }

    return Array.from(groups.values());
  }, [categories, dashboardMap]);

  async function handleAddCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      await api("/budget/categories", {
        method: "POST",
        body: JSON.stringify({
          name: newCategoryName.trim(),
          groupName: newCategoryGroup.trim() || null,
        }),
      });
      setNewCategoryName("");
      setNewCategoryGroup("");
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
      setSavingBudgetId(id);
      await Promise.all([
        api(`/budget/categories/${id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: draftName.trim(),
            groupName: draftGroup.trim() || null,
          }),
        }),
        api("/budget/monthly", {
          method: "POST",
          body: JSON.stringify(monthlyBudgetPayload(id)),
        }),
      ]);
      setEditingId(null);
      setDraftName("");
      setDraftGroup("");
      refresh();
      toast({ title: "Category saved" });
    } catch {
      toast({ title: "Failed to save category", variant: "destructive" });
    } finally {
      setSavingBudgetId(null);
    }
  }

  async function saveCategoryOrder(
    orderedIds: number[],
    successTitle: string,
  ) {
    await api<void>("/budget/categories/reorder", {
      method: "PUT",
      body: JSON.stringify({ orderedIds }),
    });
    refresh();
    toast({ title: successTitle });
  }

  async function reorderGroup(groupKeyValue: string, direction: "up" | "down") {
    const index = categoryGroups.findIndex((group) => group.key === groupKeyValue);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= categoryGroups.length) return;

    const reordered = categoryGroups.map((group) => ({
      ...group,
      categories: [...group.categories],
    }));
    const currentGroup = reordered[index];
    const nextGroup = reordered[nextIndex];
    if (!currentGroup || !nextGroup) return;
    reordered[index] = nextGroup;
    reordered[nextIndex] = currentGroup;

    try {
      setReorderingGroupKey(groupKeyValue);
      await saveCategoryOrder(
        orderedIdsFromGroups(reordered),
        "Group order updated",
      );
    } catch {
      toast({ title: "Failed to reorder group", variant: "destructive" });
    } finally {
      setReorderingGroupKey(null);
    }
  }

  async function reorderCategory(categoryId: number, groupKeyValue: string, direction: "up" | "down") {
    const reordered = categoryGroups.map((group) => ({
      ...group,
      categories: [...group.categories],
    }));
    const group = reordered.find((item) => item.key === groupKeyValue);
    if (!group) return;

    const index = group.categories.findIndex((cat) => cat.id === categoryId);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= group.categories.length) return;

    const currentCategory = group.categories[index];
    const nextCategory = group.categories[nextIndex];
    if (!currentCategory || !nextCategory) return;
    group.categories[index] = nextCategory;
    group.categories[nextIndex] = currentCategory;

    try {
      setReorderingCategoryId(categoryId);
      await saveCategoryOrder(
        orderedIdsFromGroups(reordered),
        "Category order updated",
      );
    } catch {
      toast({ title: "Failed to reorder category", variant: "destructive" });
    } finally {
      setReorderingCategoryId(null);
    }
  }

  async function handleSaveBudget(categoryId: number) {
    try {
      setSavingBudgetId(categoryId);
      await api("/budget/monthly", {
        method: "POST",
        body: JSON.stringify(monthlyBudgetPayload(categoryId)),
      });
      refresh();
      toast({ title: "Budget updated" });
    } catch {
      toast({ title: "Failed to update budget", variant: "destructive" });
    } finally {
      setSavingBudgetId(null);
    }
  }

  function monthlyBudgetPayload(categoryId: number) {
    const body: {
      categoryId: number;
      year: number;
      month: number;
      budgetAmount: number;
      rolloverOverride?: number | null;
    } = {
      categoryId,
      year,
      month,
      budgetAmount: parseMoneyDraft(budgetDrafts[categoryId]),
    };

    if (touchedRolloverIds.has(categoryId)) {
      body.rolloverOverride = parseMoneyDraft(rolloverDrafts[categoryId]);
    }

    return body;
  }

  async function handleUseAutomaticRollover(categoryId: number) {
    const row = dashboardMap.get(categoryId);

    try {
      setSavingBudgetId(categoryId);
      await api("/budget/monthly", {
        method: "POST",
        body: JSON.stringify({
          categoryId,
          year,
          month,
          budgetAmount: parseMoneyDraft(budgetDrafts[categoryId]),
          rolloverOverride: null,
        }),
      });
      setRolloverDrafts((prev) => ({
        ...prev,
        [categoryId]: String(row?.computedRollover ?? 0),
      }));
      setTouchedRolloverIds((prev) => {
        const next = new Set(prev);
        next.delete(categoryId);
        return next;
      });
      refresh();
      toast({ title: "Rollover set to automatic" });
    } catch {
      toast({ title: "Failed to reset rollover", variant: "destructive" });
    } finally {
      setSavingBudgetId(null);
    }
  }

  async function saveIncome(e: FormEvent) {
    e.preventDefault();
    const amount = parseFloat(incomeDraft || "0") || 0;

    try {
      setSavingIncome(true);
      await api("/budget/income", {
        method: "PUT",
        body: JSON.stringify({ year, month, amount }),
      });
      refresh();
      toast({ title: "Income updated" });
    } catch {
      toast({ title: "Failed to update income", variant: "destructive" });
    } finally {
      setSavingIncome(false);
    }
  }

  const reorderBusy = reorderingCategoryId !== null || reorderingGroupKey !== null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Budget Settings
          </CardTitle>
          <CardDescription>
            Manage income, category groups, category order, and monthly budget amounts here.
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

          <form
            onSubmit={saveIncome}
            className="grid gap-3 rounded-xl border border-border/50 bg-background/50 p-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end"
          >
            <div>
              <div className="text-sm font-medium">Monthly income</div>
              <div
                className={cn(
                  "mt-1 text-sm font-medium",
                  budgetedIncomeState === "over" ? "text-destructive" : "text-primary",
                )}
              >
                {budgetedIncomeSummary}
              </div>
            </div>
            <Input
              inputMode="decimal"
              value={incomeDraft}
              onChange={(e) => setIncomeDraft(cleanMoneyInput(e.target.value))}
              placeholder="0.00"
              disabled={dashboardLoading || savingIncome}
              className="bg-background border-border/50"
            />
            <Button type="submit" disabled={dashboardLoading || savingIncome}>
              <Save className="mr-2 h-4 w-4" />
              {savingIncome ? "Saving..." : "Save"}
            </Button>
          </form>

          <form onSubmit={handleAddCategory} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name..."
              className="bg-background border-border/50"
            />
            <Input
              value={newCategoryGroup}
              onChange={(e) => setNewCategoryGroup(e.target.value)}
              placeholder="Group"
              className="bg-background border-border/50"
            />
            <Button type="submit">
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
          </form>

          <div
            className={cn(
              "sticky top-3 z-20 grid gap-3 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur md:grid-cols-3",
              budgetedIncomeState === "over" ? "border-destructive/40" : "border-border/70",
            )}
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-muted-foreground">Planned income</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{money(plannedIncomeAmount)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-muted-foreground">Base budget</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{money(totalBudgetDrafted)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-muted-foreground">Budgeted income remaining</div>
              <div
                className={cn(
                  "mt-1 text-lg font-semibold tabular-nums",
                  budgetedIncomeState === "over"
                    ? "text-destructive"
                    : budgetedIncomeState === "balanced"
                    ? "text-primary"
                    : "text-secondary",
                )}
              >
                {money(budgetedIncomeRemaining)}
              </div>
              <div className="text-xs text-muted-foreground">{budgetedIncomeSummary}</div>
            </div>
          </div>

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
            <div className="space-y-4">
              {categoryGroups.map((group, groupIndex) => (
                <section
                  key={group.key}
                  className="overflow-hidden rounded-xl border border-border/50 bg-background/40"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-border/50 p-3">
                    <div className="min-w-0">
                      <div className="font-medium">{group.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {group.categories.length} categor{group.categories.length === 1 ? "y" : "ies"} / Base{" "}
                        {money(group.budgeted)} / Rollover {money(group.rollover)} / Available{" "}
                        {money(group.available)} / Left {money(group.left)}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => reorderGroup(group.key, "up")}
                        disabled={groupIndex === 0 || reorderBusy}
                        aria-label={`Move ${group.label} group up`}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => reorderGroup(group.key, "down")}
                        disabled={groupIndex === categoryGroups.length - 1 || reorderBusy}
                        aria-label={`Move ${group.label} group down`}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3 p-3">
                    {group.categories.map((cat, categoryIndex) => {
                      const editing = editingId === cat.id;
                      const row = dashboardMap.get(cat.id);
                      const draftAvailable =
                        parseMoneyDraft(budgetDrafts[cat.id]) + parseMoneyDraft(rolloverDrafts[cat.id]);
                      const rolloverIsManual = row?.rolloverOverride != null;

                      return (
                        <div
                          key={cat.id}
                          className="space-y-3 rounded-lg border border-border/50 bg-card/50 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            {!editing ? (
                              <>
                                <div className="min-w-0">
                                  <div className="font-medium">{cat.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    Base {money(row?.budgeted ?? 0)} / Rollover {money(row?.rollover ?? 0)} / Available{" "}
                                    {money(row?.available ?? 0)} / Spent {money(row?.spent ?? 0)} / Left {money(row?.left ?? 0)}
                                  </div>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => reorderCategory(cat.id, group.key, "up")}
                                    disabled={categoryIndex === 0 || reorderBusy}
                                    aria-label={`Move ${cat.name} up within ${group.label}`}
                                  >
                                    <ArrowUp className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => reorderCategory(cat.id, group.key, "down")}
                                    disabled={categoryIndex === group.categories.length - 1 || reorderBusy}
                                    aria-label={`Move ${cat.name} down within ${group.label}`}
                                  >
                                    <ArrowDown className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                      setEditingId(cat.id);
                                      setDraftName(cat.name);
                                      setDraftGroup(cat.groupName ?? "");
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
                                <div className="grid flex-1 gap-2 md:grid-cols-2">
                                  <Input
                                    value={draftName}
                                    onChange={(e) => setDraftName(e.target.value)}
                                    placeholder="Category name"
                                  />
                                  <Input
                                    value={draftGroup}
                                    onChange={(e) => setDraftGroup(e.target.value)}
                                    placeholder="Group"
                                  />
                                </div>
                                <div className="flex shrink-0 gap-2">
                                  <Button
                                    className="gap-2"
                                    onClick={() => handleSaveCategory(cat.id)}
                                    disabled={savingBudgetId === cat.id || !draftName.trim()}
                                  >
                                    <Save className="h-4 w-4" />
                                    {savingBudgetId === cat.id ? "Saving..." : "Save"}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                      setEditingId(null);
                                      setDraftName("");
                                      setDraftGroup("");
                                    }}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>

                          <div
                            className={
                              editing
                                ? "grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px] md:items-end"
                                : "grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px_auto] md:items-end"
                            }
                          >
                            <div className="space-y-1">
                              <div className="text-xs font-medium text-muted-foreground">
                                Base {format(viewDate, "MMM")}
                              </div>
                              <Input
                                inputMode="decimal"
                                value={budgetDrafts[cat.id] ?? ""}
                                onChange={(e) =>
                                  setBudgetDrafts((prev) => ({
                                    ...prev,
                                    [cat.id]: cleanMoneyInput(e.target.value),
                                  }))
                                }
                                placeholder="0.00"
                              />
                            </div>
                            <div className="space-y-1">
                              <div className="flex min-h-6 items-center justify-between gap-2">
                                <div className="text-xs font-medium text-muted-foreground">Rollover</div>
                                {rolloverIsManual ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => handleUseAutomaticRollover(cat.id)}
                                    disabled={savingBudgetId === cat.id}
                                  >
                                    <RotateCcw className="mr-1 h-3 w-3" />
                                    Auto
                                  </Button>
                                ) : null}
                              </div>
                              <Input
                                inputMode="decimal"
                                value={rolloverDrafts[cat.id] ?? ""}
                                onChange={(e) => {
                                  setRolloverDrafts((prev) => ({
                                    ...prev,
                                    [cat.id]: cleanSignedMoneyInput(e.target.value),
                                  }));
                                  setTouchedRolloverIds((prev) => {
                                    const next = new Set(prev);
                                    next.add(cat.id);
                                    return next;
                                  });
                                }}
                                placeholder="0.00"
                              />
                            </div>
                            <div className="rounded-md border border-border/50 bg-background/50 px-3 py-2">
                              <div className="text-xs text-muted-foreground">Available</div>
                              <div className="text-sm font-medium tabular-nums">{money(draftAvailable)}</div>
                            </div>
                            {!editing && (
                              <Button
                                onClick={() => handleSaveBudget(cat.id)}
                                disabled={savingBudgetId === cat.id}
                              >
                                <Save className="mr-2 h-4 w-4" />
                                {savingBudgetId === cat.id ? "Saving..." : "Save"}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
