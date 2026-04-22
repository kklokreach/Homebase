import { useEffect, useMemo, useState } from "react";
import { format, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, Pencil, Save, Trash2, X, Wallet } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBudgetDashboard,
  useListBudgetCategories,
  getGetBudgetDashboardQueryKey,
  getGetHomeSnapshotQueryKey,
  getListTransactionsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const API_BASE_URL = "https://homebase-ll6f.onrender.com/api";
const LAST_CATEGORY_KEY = "homebase:lastCategoryId";

type Category = {
  id: number;
  name: string;
  icon?: string | null;
  color?: string | null;
  sortOrder: number;
};

type Transaction = {
  id: number;
  amount: number;
  merchant: string;
  categoryId: number | null;
  categoryName: string | null;
  date: string;
  notes: string | null;
  createdAt: string;
};

type DashboardCategory = {
  categoryId: number;
  categoryName: string;
  budgeted: number;
  rollover: number;
  available: number;
  spent: number;
  left: number;
};

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

function TransactionForm({
  year,
  month,
  onSaved,
}: {
  year: number;
  month: number;
  onSaved: () => void;
}) {
  const savedCat =
    typeof window !== "undefined"
      ? localStorage.getItem(LAST_CATEGORY_KEY) ?? "null"
      : "null";

  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState(savedCat);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const { data: categories } = useListBudgetCategories();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || !merchant.trim()) return;

    try {
      setIsSaving(true);
      await api("/transactions", {
        method: "POST",
        body: JSON.stringify({
          amount: parsed,
          merchant: merchant.trim(),
          categoryId: categoryId === "null" ? null : Number(categoryId),
          notes: notes.trim() || null,
          date: `${year}-${String(month).padStart(2, "0")}-${String(
            new Date().getDate()
          ).padStart(2, "0")}`,
        }),
      });

      setAmount("");
      setMerchant("");
      setNotes("");
      if (typeof window !== "undefined") {
        localStorage.setItem(LAST_CATEGORY_KEY, categoryId);
      }
      onSaved();
      toast({ title: "Transaction added" });
    } catch {
      toast({ title: "Failed to add transaction", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
      <div className="text-sm font-medium">Quick add transaction</div>

      <div className="grid gap-3 md:grid-cols-4">
        <Input
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
        />
        <Input
          placeholder="Merchant"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="null">No category</option>
          {(categories ?? []).map((cat) => (
            <option key={cat.id} value={String(cat.id)}>
              {cat.name}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Add"}
        </Button>
      </div>

      <Input
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
    </form>
  );
}

export default function Finances() {
  const now = new Date();
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [txDraft, setTxDraft] = useState({
    amount: "",
    merchant: "",
    categoryId: "null",
    date: "",
    notes: "",
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: dashboard, isLoading } = useGetBudgetDashboard(
    { year, month },
    { query: { queryKey: getGetBudgetDashboardQueryKey({ year, month }) } }
  );

  const { data: categories = [] } = useListBudgetCategories();

  async function refreshTransactions() {
    try {
      setTxLoading(true);
      const data = await api<Transaction[]>(
        `/transactions?year=${year}&month=${month}&limit=200`
      );
      setTransactions(data);
    } catch {
      toast({ title: "Failed to load transactions", variant: "destructive" });
    } finally {
      setTxLoading(false);
    }
  }

  function refreshAll() {
    queryClient.invalidateQueries({
      queryKey: getGetBudgetDashboardQueryKey({ year, month }),
    });
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
    refreshTransactions();
  }

  useEffect(() => {
    refreshTransactions();
  }, [year, month]);

  function startEditTx(tx: Transaction) {
    setEditingTxId(tx.id);
    setTxDraft({
      amount: String(tx.amount),
      merchant: tx.merchant,
      categoryId: tx.categoryId == null ? "null" : String(tx.categoryId),
      date: String(tx.date).slice(0, 10),
      notes: tx.notes ?? "",
    });
  }

  async function saveTransaction(id: number) {
    try {
      await api(`/transactions/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          amount: parseFloat(txDraft.amount || "0") || 0,
          merchant: txDraft.merchant.trim(),
          categoryId: txDraft.categoryId === "null" ? null : Number(txDraft.categoryId),
          date: txDraft.date,
          notes: txDraft.notes.trim() || null,
        }),
      });
      setEditingTxId(null);
      refreshAll();
      toast({ title: "Transaction updated" });
    } catch {
      toast({ title: "Failed to update transaction", variant: "destructive" });
    }
  }

  async function deleteTransaction(id: number) {
    if (!window.confirm("Delete this transaction?")) return;

    try {
      await api(`/transactions/${id}`, { method: "DELETE" });
      if (editingTxId === id) setEditingTxId(null);
      refreshAll();
      toast({ title: "Transaction deleted" });
    } catch {
      toast({ title: "Failed to delete transaction", variant: "destructive" });
    }
  }

  const txCategoryName = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of categories as Category[]) map.set(c.id, c.name);
    return map;
  }, [categories]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Finances</h1>

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

      <TransactionForm year={year} month={month} onSaved={refreshAll} />

      {isLoading || !dashboard ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-2xl" />
        </>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            {[
              { label: "Budgeted", value: fmt(dashboard.totalBudgeted), color: "" },
              {
                label: "Rollover",
                value: fmt(dashboard.totalRollover, true),
                color:
                  dashboard.totalRollover >= 0 ? "text-primary" : "text-destructive",
              },
              {
                label: "Available",
                value: fmt(dashboard.totalAvailable),
                color: "text-primary",
              },
              {
                label: "Left",
                value: fmt(dashboard.totalLeft),
                color:
                  dashboard.totalLeft < 0 ? "text-destructive" : "text-secondary",
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="text-sm text-muted-foreground">{label}</div>
                <div className={cn("mt-2 text-2xl font-semibold", color)}>{value}</div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              <div className="font-medium">Category spending snapshot</div>
            </div>

            <div className="space-y-3">
              {(dashboard.categories as DashboardCategory[]).map((cat) => {
                const percent =
                  cat.available > 0
                    ? Math.max(0, Math.min(100, (cat.spent / cat.available) * 100))
                    : 0;

                return (
                  <div key={cat.categoryId} className="rounded-xl border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{cat.categoryName}</div>
                        <div className="text-xs text-muted-foreground">
                          Budgeted {fmt(cat.budgeted)} · Rollover {fmt(cat.rollover, true)}
                        </div>
                      </div>

                      <div
                        className={cn(
                          "text-sm font-medium whitespace-nowrap",
                          cat.left < 0
                            ? "text-destructive"
                            : cat.left === 0
                            ? "text-muted-foreground"
                            : "text-primary"
                        )}
                      >
                        Left {fmt(cat.left)}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div className="rounded-lg bg-muted/40 px-3 py-2">
                        <div className="text-xs text-muted-foreground">Available</div>
                        <div className="font-medium">{fmt(cat.available)}</div>
                      </div>
                      <div className="rounded-lg bg-muted/40 px-3 py-2">
                        <div className="text-xs text-muted-foreground">Spent</div>
                        <div className="font-medium">{fmt(cat.spent)}</div>
                      </div>
                      <div className="rounded-lg bg-muted/40 px-3 py-2">
                        <div className="text-xs text-muted-foreground">Remaining</div>
                        <div
                          className={cn(
                            "font-medium",
                            cat.left < 0 ? "text-destructive" : "text-primary"
                          )}
                        >
                          {fmt(cat.left)}
                        </div>
                      </div>
                    </div>

                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full",
                          cat.left < 0 ? "bg-destructive" : "bg-primary"
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
        <div className="font-medium">Transactions — {format(viewDate, "MMMM yyyy")}</div>

        {txLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-sm text-muted-foreground">No transactions for this month.</div>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => {
              const editing = editingTxId === tx.id;

              return (
                <div key={tx.id} className="rounded-xl border p-3 space-y-3">
                  {!editing ? (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{tx.merchant}</div>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(tx.date), "MMM d, yyyy")}
                          {tx.categoryName ? ` · ${tx.categoryName}` : ""}
                          {tx.notes ? ` · ${tx.notes}` : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="font-semibold whitespace-nowrap">{fmt(tx.amount)}</div>
                        <Button variant="outline" size="icon" onClick={() => startEditTx(tx)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <Input
                          inputMode="decimal"
                          value={txDraft.amount}
                          onChange={(e) =>
                            setTxDraft((prev) => ({
                              ...prev,
                              amount: e.target.value.replace(/[^0-9.]/g, ""),
                            }))
                          }
                          placeholder="Amount"
                        />
                        <Input
                          value={txDraft.merchant}
                          onChange={(e) =>
                            setTxDraft((prev) => ({ ...prev, merchant: e.target.value }))
                          }
                          placeholder="Merchant"
                        />
                        <select
                          value={txDraft.categoryId}
                          onChange={(e) =>
                            setTxDraft((prev) => ({ ...prev, categoryId: e.target.value }))
                          }
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="null">No category</option>
                          {categories.map((cat) => (
                            <option key={cat.id} value={String(cat.id)}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                        <Input
                          type="date"
                          value={txDraft.date}
                          onChange={(e) =>
                            setTxDraft((prev) => ({ ...prev, date: e.target.value }))
                          }
                        />
                      </div>

                      <textarea
                        value={txDraft.notes}
                        onChange={(e) =>
                          setTxDraft((prev) => ({ ...prev, notes: e.target.value }))
                        }
                        placeholder="Notes"
                        className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />

                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => saveTransaction(tx.id)}>
                          <Save className="mr-2 h-4 w-4" />
                          Save
                        </Button>
                        <Button variant="outline" onClick={() => setEditingTxId(null)}>
                          <X className="mr-2 h-4 w-4" />
                          Cancel
                        </Button>
                        <Button variant="destructive" onClick={() => deleteTransaction(tx.id)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Current category:{" "}
                        {tx.categoryName ??
                          txCategoryName.get(tx.categoryId ?? -1) ??
                          "No category"}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
