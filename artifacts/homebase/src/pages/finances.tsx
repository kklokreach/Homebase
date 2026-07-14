import { useEffect, useMemo, useState } from "react";
import { format, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, Pencil, Plus, Save, Trash2, X, Wallet } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBudgetDashboard,
  useListBudgetCategories,
  getGetBudgetDashboardQueryKey,
  getGetHomeSnapshotQueryKey,
  getListTransactionsQueryKey,
} from "@workspace/api-client-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MonthlyReviewTab } from "@/components/monthly-review-tab";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, getApiOrigin } from "@/lib/api-base";
import { cn } from "@/lib/utils";

const API_ORIGIN = getApiOrigin();
const LAST_CATEGORY_KEY = "homebase:lastCategoryId";

type Category = {
  id: number;
  name: string;
  icon?: string | null;
  color?: string | null;
  groupName?: string | null;
  sortOrder: number;
};

type CategoryOption = Category & {
  remaining?: number | null;
};

type TransactionType = "expense" | "income";

type TransactionSplit = {
  id: number | null;
  categoryId: number | null;
  categoryName: string | null;
  amount: number;
};

type Transaction = {
  id: number;
  type: TransactionType;
  amount: number;
  merchant: string;
  categoryId: number | null;
  categoryName: string | null;
  splits: TransactionSplit[];
  date: string;
  notes: string | null;
  createdAt: string;
};

type DashboardCategory = {
  categoryId: number;
  categoryName: string;
  categoryGroupName?: string | null;
  budgeted: number;
  rollover: number;
  available: number;
  spent: number;
  left: number;
};

type DashboardWithIncome = {
  incomeAmount?: number;
  incomeTransactionsTotal?: number;
  incomeRemaining?: number;
  budgetOverUnder?: number;
  categories: DashboardCategory[];
};

type TransactionGroupItem = {
  tx: Transaction;
  amount: number;
  categoryId: number | null;
};

type TransactionGroup = {
  key: string;
  label: string;
  total: number;
  count: number;
  transactions: TransactionGroupItem[];
};

type ReserveFund = {
  id: number;
  name: string;
  icon?: string | null;
  color?: string | null;
  sortOrder: number;
  targetAmount?: number | null;
  balance: number;
  progress?: number | null;
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
};

type ReserveTransactionType = "contribution" | "withdrawal" | "adjustment";

type ReserveTransaction = {
  id: number;
  reserveFundId: number;
  reserveFundName: string;
  type: ReserveTransactionType;
  amount: number;
  date: string;
  notes?: string | null;
  createdAt: string;
};

type ReserveFundDraft = {
  name: string;
  icon: string;
  color: string;
  sortOrder: string;
  targetAmount: string;
};

type ReserveTransactionDraft = {
  reserveFundId: string;
  type: ReserveTransactionType;
  amount: string;
  date: string;
  notes: string;
};

type TransactionSplitDraft = {
  categoryId: string;
  amount: string;
};

type TransactionDraft = {
  type: TransactionType;
  amount: string;
  merchant: string;
  categoryId: string;
  splitMode: boolean;
  splits: TransactionSplitDraft[];
  date: string;
  notes: string;
};

function fmt(n: number, showSign = false) {
  const abs = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (showSign && n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

function categoryOptionLabel(cat: CategoryOption) {
  return cat.remaining == null
    ? cat.name
    : `${cat.name} (${fmt(cat.remaining)} remaining)`;
}

function cleanMoneyInput(value: string) {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const [first, ...rest] = cleaned.split(".");
  return rest.length === 0 ? first : `${first}.${rest.join("")}`;
}

function parseMoney(value: string) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value: number) {
  return Math.round(value * 100);
}

function splitDraftTotal(splits: TransactionSplitDraft[]) {
  return splits.reduce((sum, split) => sum + parseMoney(split.amount), 0);
}

function buildSplitPayload(splits: TransactionSplitDraft[]) {
  return splits
    .map((split) => ({
      categoryId: split.categoryId === "null" ? null : Number(split.categoryId),
      amount: parseMoney(split.amount),
    }))
    .filter((split) => split.amount > 0);
}

function emptyTransactionDraft(savedCategoryId = "null"): TransactionDraft {
  return {
    type: "expense",
    amount: "",
    merchant: "",
    categoryId: savedCategoryId,
    splitMode: false,
    splits: [{ categoryId: savedCategoryId, amount: "" }],
    date: todayInputValue(),
    notes: "",
  };
}

function todayInputValue() {
  return new Date().toISOString().split("T")[0];
}

function defaultDateForMonth(year: number, month: number) {
  const today = new Date();
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(today.getDate(), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fmtReserveDelta(type: ReserveTransactionType, amount: number) {
  const normalized = type === "withdrawal" ? -amount : amount;
  return fmt(normalized, true);
}

function reserveDeltaTone(type: ReserveTransactionType, amount: number) {
  if (type === "withdrawal") return "text-destructive";
  if (type === "adjustment" && amount < 0) return "text-destructive";
  if (type === "adjustment" && amount === 0) return "text-muted-foreground";
  return "text-primary";
}

function emptyReserveFundDraft(): ReserveFundDraft {
  return {
    name: "",
    icon: "",
    color: "",
    sortOrder: "0",
    targetAmount: "",
  };
}

function emptyReserveTransactionDraft(reserveFundId: number): ReserveTransactionDraft {
  return {
    reserveFundId: String(reserveFundId),
    type: "contribution",
    amount: "",
    date: todayInputValue(),
    notes: "",
  };
}

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

function TransactionForm({
  year,
  month,
  categories,
  onSaved,
}: {
  year: number;
  month: number;
  categories: CategoryOption[];
  onSaved: () => void;
}) {
  const savedCat =
    typeof window !== "undefined"
      ? localStorage.getItem(LAST_CATEGORY_KEY) ?? "null"
      : "null";

  const [draft, setDraft] = useState<TransactionDraft>(() => emptyTransactionDraft(savedCat));
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const amountValue = parseMoney(draft.amount);
  const splitTotal = splitDraftTotal(draft.splits);
  const splitRemaining = amountValue - splitTotal;

  function updateSplit(index: number, updates: Partial<TransactionSplitDraft>) {
    setDraft((prev) => ({
      ...prev,
      splits: prev.splits.map((split, i) =>
        i === index ? { ...split, ...updates } : split,
      ),
    }));
  }

  function startSplitMode() {
    setDraft((prev) => ({
      ...prev,
      splitMode: true,
      splits: [
        { categoryId: prev.categoryId, amount: prev.amount },
        { categoryId: "null", amount: "" },
      ],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cents(amountValue) <= 0 || !draft.merchant.trim()) return;

    let categoryId: number | null = null;
    let splits: { categoryId: number | null; amount: number }[] = [];

    if (draft.type === "expense") {
      if (draft.splitMode) {
        splits = buildSplitPayload(draft.splits);
        if (splits.length === 0) {
          toast({ title: "Add at least one split amount", variant: "destructive" });
          return;
        }
        const total = splits.reduce((sum, split) => sum + split.amount, 0);
        if (cents(total) !== cents(amountValue)) {
          toast({ title: "Split amounts must match the transaction amount", variant: "destructive" });
          return;
        }
        categoryId = splits.length === 1 ? splits[0].categoryId : null;
      } else {
        categoryId = draft.categoryId === "null" ? null : Number(draft.categoryId);
      }
    }

    try {
      setIsSaving(true);
      await api("/transactions", {
        method: "POST",
        body: JSON.stringify({
          type: draft.type,
          amount: amountValue,
          merchant: draft.merchant.trim(),
          categoryId,
          splits,
          notes: draft.notes.trim() || null,
          date: defaultDateForMonth(year, month),
        }),
      });

      const nextSavedCategory =
        draft.type === "income"
          ? draft.categoryId
          : draft.type === "expense" && !draft.splitMode
          ? draft.categoryId
          : splits[0]?.categoryId == null
          ? "null"
          : String(splits[0].categoryId);
      setDraft(emptyTransactionDraft(nextSavedCategory));
      if (typeof window !== "undefined") {
        localStorage.setItem(LAST_CATEGORY_KEY, nextSavedCategory);
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

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_10rem_auto]">
        <Input
          inputMode="decimal"
          placeholder="Amount"
          value={draft.amount}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, amount: cleanMoneyInput(e.target.value) }))
          }
        />
        <Input
          placeholder={draft.type === "income" ? "Source" : "Merchant"}
          value={draft.merchant}
          onChange={(e) => setDraft((prev) => ({ ...prev, merchant: e.target.value }))}
        />
        <select
          value={draft.type}
          onChange={(e) =>
            setDraft((prev) => ({
              ...prev,
              type: e.target.value as TransactionType,
              splitMode: e.target.value === "expense" ? prev.splitMode : false,
            }))
          }
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Add"}
        </Button>
      </div>

      {draft.type === "expense" && !draft.splitMode ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <select
            value={draft.categoryId}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, categoryId: e.target.value }))
            }
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="null">No category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={String(cat.id)}>
                {categoryOptionLabel(cat)}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" onClick={startSplitMode}>
            <Plus className="mr-2 h-4 w-4" />
            Split
          </Button>
        </div>
      ) : null}

      {draft.type === "expense" && draft.splitMode ? (
        <div className="rounded-xl border p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Category splits</div>
            <div
              className={cn(
                "text-sm",
                cents(splitRemaining) === 0
                  ? "text-primary"
                  : splitRemaining < 0
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              Remaining {fmt(splitRemaining)}
            </div>
          </div>

          <div className="space-y-2">
            {draft.splits.map((split, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_9rem_auto]">
                <select
                  value={split.categoryId}
                  onChange={(e) => updateSplit(index, { categoryId: e.target.value })}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="null">No category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={String(cat.id)}>
                      {categoryOptionLabel(cat)}
                    </option>
                  ))}
                </select>
                <Input
                  inputMode="decimal"
                  placeholder="Amount"
                  value={split.amount}
                  onChange={(e) => updateSplit(index, { amount: cleanMoneyInput(e.target.value) })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      splits: prev.splits.filter((_, i) => i !== index),
                    }))
                  }
                  disabled={draft.splits.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  splits: [...prev.splits, { categoryId: "null", amount: "" }],
                }))
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Add split
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  splitMode: false,
                  categoryId: prev.splits[0]?.categoryId ?? prev.categoryId,
                }))
              }
            >
              Single category
            </Button>
          </div>
        </div>
      ) : null}

      <Input
        placeholder="Notes (optional)"
        value={draft.notes}
        onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
      />
    </form>
  );
}

function ReserveTransactionForm({
  reserveFundId,
  onSaved,
}: {
  reserveFundId: number;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ReserveTransactionDraft>(() =>
    emptyReserveTransactionDraft(reserveFundId)
  );
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setDraft(emptyReserveTransactionDraft(reserveFundId));
  }, [reserveFundId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(draft.amount);
    if (!Number.isFinite(amount)) return;

    try {
      setIsSaving(true);
      await api("/reserves/transactions", {
        method: "POST",
        body: JSON.stringify({
          reserveFundId,
          type: draft.type,
          amount,
          date: draft.date || null,
          notes: draft.notes.trim() || null,
        }),
      });
      setDraft(emptyReserveTransactionDraft(reserveFundId));
      onSaved();
      toast({ title: "Reserve transaction added" });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Failed to add reserve transaction",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border bg-background/50 p-3 space-y-3">
      <div className="text-sm font-medium">Add reserve transaction</div>
      <div className="grid gap-3 md:grid-cols-4">
        <select
          value={draft.type}
          onChange={(e) =>
            setDraft((prev) => ({
              ...prev,
              type: e.target.value as ReserveTransactionType,
            }))
          }
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="contribution">Contribution</option>
          <option value="withdrawal">Withdrawal</option>
          <option value="adjustment">Adjustment</option>
        </select>
        <Input
          inputMode="decimal"
          placeholder="Amount"
          value={draft.amount}
          onChange={(e) =>
            setDraft((prev) => ({
              ...prev,
              amount: e.target.value.replace(/[^0-9.-]/g, ""),
            }))
          }
        />
        <Input
          type="date"
          value={draft.date}
          onChange={(e) => setDraft((prev) => ({ ...prev, date: e.target.value }))}
        />
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Add"}
        </Button>
      </div>
      <Textarea
        placeholder="Notes (optional)"
        value={draft.notes}
        onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
        className="min-h-20"
      />
    </form>
  );
}

export default function Finances() {
  const now = new Date();
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [openTransactionGroups, setOpenTransactionGroups] = useState<string[]>([]);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [txDraft, setTxDraft] = useState<TransactionDraft>(() => emptyTransactionDraft());
  const [reserveFunds, setReserveFunds] = useState<ReserveFund[]>([]);
  const [reserveTransactions, setReserveTransactions] = useState<ReserveTransaction[]>([]);
  const [reserveLoading, setReserveLoading] = useState(false);
  const [openReserveFunds, setOpenReserveFunds] = useState<string[]>([]);
  const [newReserveFund, setNewReserveFund] = useState<ReserveFundDraft>(() => emptyReserveFundDraft());
  const [savingNewReserveFund, setSavingNewReserveFund] = useState(false);
  const [editingReserveFundId, setEditingReserveFundId] = useState<number | null>(null);
  const [reserveFundDraft, setReserveFundDraft] = useState<ReserveFundDraft>(() => emptyReserveFundDraft());
  const [editingReserveTransactionId, setEditingReserveTransactionId] = useState<number | null>(null);
  const [reserveTransactionDraft, setReserveTransactionDraft] = useState<ReserveTransactionDraft>(() =>
    emptyReserveTransactionDraft(0)
  );

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
  const dashboardView = dashboard as (typeof dashboard & DashboardWithIncome) | undefined;
  const dashboardCategories = (dashboardView?.categories ?? []) as DashboardCategory[];
  const budgetOverUnder =
    dashboardView?.budgetOverUnder ??
    ((dashboardView?.incomeAmount ?? 0) - (dashboard?.totalBudgeted ?? 0));
  const dashboardCategoryById = useMemo(() => {
    const map = new Map<number, DashboardCategory>();
    for (const cat of dashboardCategories) {
      map.set(cat.categoryId, cat);
    }
    return map;
  }, [dashboardCategories]);
  const categoryOptions = useMemo<CategoryOption[]>(
    () =>
      (categories as Category[]).map((cat) => ({
        ...cat,
        remaining: dashboardCategoryById.get(cat.id)?.left ?? null,
      })),
    [categories, dashboardCategoryById],
  );

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

  async function refreshReserves() {
    try {
      setReserveLoading(true);
      const [funds, reserveTxns] = await Promise.all([
        api<ReserveFund[]>("/reserves/funds"),
        api<ReserveTransaction[]>("/reserves/transactions"),
      ]);
      setReserveFunds(funds);
      setReserveTransactions(reserveTxns);
    } catch {
      toast({ title: "Failed to load reserve funds", variant: "destructive" });
    } finally {
      setReserveLoading(false);
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

  useEffect(() => {
    refreshReserves();
  }, []);

  function updateTxDraftSplit(index: number, updates: Partial<TransactionSplitDraft>) {
    setTxDraft((prev) => ({
      ...prev,
      splits: prev.splits.map((split, i) =>
        i === index ? { ...split, ...updates } : split,
      ),
    }));
  }

  function startEditTx(tx: Transaction) {
    const splits =
      tx.splits.length > 0
        ? tx.splits
        : tx.type === "expense"
        ? [{
            id: null,
            categoryId: tx.categoryId,
            categoryName: tx.categoryName,
            amount: tx.amount,
          }]
        : [];
    const primaryCategoryId = splits.length === 1 ? splits[0].categoryId : tx.categoryId;
    const groupKey =
      tx.type === "income"
        ? "income"
        : primaryCategoryId == null
        ? "uncategorized"
        : `category-${primaryCategoryId}`;
    setOpenTransactionGroups((prev) =>
      prev.includes(groupKey) ? prev : [...prev, groupKey]
    );
    setEditingTxId(tx.id);
    setTxDraft({
      type: tx.type,
      amount: String(tx.amount),
      merchant: tx.merchant,
      categoryId: primaryCategoryId == null ? "null" : String(primaryCategoryId),
      splitMode: tx.type === "expense" && splits.length > 1,
      splits: splits.length > 0
        ? splits.map((split) => ({
            categoryId: split.categoryId == null ? "null" : String(split.categoryId),
            amount: String(split.amount),
          }))
        : [{ categoryId: "null", amount: "" }],
      date: String(tx.date).slice(0, 10),
      notes: tx.notes ?? "",
    });
  }

  async function saveTransaction(id: number) {
    const amount = parseMoney(txDraft.amount);
    if (cents(amount) <= 0 || !txDraft.merchant.trim()) return;

    let categoryId: number | null = null;
    let splits: { categoryId: number | null; amount: number }[] = [];

    if (txDraft.type === "expense") {
      if (txDraft.splitMode) {
        splits = buildSplitPayload(txDraft.splits);
        const total = splits.reduce((sum, split) => sum + split.amount, 0);
        if (splits.length === 0 || cents(total) !== cents(amount)) {
          toast({ title: "Split amounts must match the transaction amount", variant: "destructive" });
          return;
        }
        categoryId = splits.length === 1 ? splits[0].categoryId : null;
      } else {
        categoryId = txDraft.categoryId === "null" ? null : Number(txDraft.categoryId);
      }
    }

    try {
      await api(`/transactions/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          type: txDraft.type,
          amount,
          merchant: txDraft.merchant.trim(),
          categoryId,
          splits,
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

  function reserveFundToDraft(fund: ReserveFund): ReserveFundDraft {
    return {
      name: fund.name,
      icon: fund.icon ?? "",
      color: fund.color ?? "",
      sortOrder: String(fund.sortOrder),
      targetAmount: fund.targetAmount == null ? "" : String(fund.targetAmount),
    };
  }

  function startEditReserveFund(fund: ReserveFund) {
    const key = `reserve-fund-${fund.id}`;
    setOpenReserveFunds((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setEditingReserveFundId(fund.id);
    setReserveFundDraft(reserveFundToDraft(fund));
  }

  async function createReserveFund(e: React.FormEvent) {
    e.preventDefault();
    if (!newReserveFund.name.trim()) return;

    try {
      setSavingNewReserveFund(true);
      await api("/reserves/funds", {
        method: "POST",
        body: JSON.stringify({
          name: newReserveFund.name.trim(),
          icon: newReserveFund.icon.trim() || null,
          color: newReserveFund.color.trim() || null,
          sortOrder: parseInt(newReserveFund.sortOrder || "0", 10) || 0,
          targetAmount:
            newReserveFund.targetAmount.trim() === ""
              ? null
              : parseFloat(newReserveFund.targetAmount),
        }),
      });
      setNewReserveFund(emptyReserveFundDraft());
      refreshReserves();
      toast({ title: "Reserve fund created" });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Failed to create reserve fund",
        variant: "destructive",
      });
    } finally {
      setSavingNewReserveFund(false);
    }
  }

  async function saveReserveFund(id: number) {
    try {
      await api(`/reserves/funds/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: reserveFundDraft.name.trim(),
          icon: reserveFundDraft.icon.trim() || null,
          color: reserveFundDraft.color.trim() || null,
          sortOrder: parseInt(reserveFundDraft.sortOrder || "0", 10) || 0,
          targetAmount:
            reserveFundDraft.targetAmount.trim() === ""
              ? null
              : parseFloat(reserveFundDraft.targetAmount),
        }),
      });
      setEditingReserveFundId(null);
      setReserveFundDraft(emptyReserveFundDraft());
      refreshReserves();
      toast({ title: "Reserve fund updated" });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Failed to update reserve fund",
        variant: "destructive",
      });
    }
  }

  async function deleteReserveFund(id: number, name: string) {
    if (!window.confirm(`Delete ${name}? This will also delete all transactions in that fund.`)) {
      return;
    }

    try {
      await api(`/reserves/funds/${id}`, { method: "DELETE" });
      if (editingReserveFundId === id) {
        setEditingReserveFundId(null);
        setReserveFundDraft(emptyReserveFundDraft());
      }
      if (editingReserveTransactionId !== null) {
        const editingTx = reserveTransactions.find((tx) => tx.id === editingReserveTransactionId);
        if (editingTx?.reserveFundId === id) {
          setEditingReserveTransactionId(null);
        }
      }
      refreshReserves();
      toast({ title: "Reserve fund deleted" });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Failed to delete reserve fund",
        variant: "destructive",
      });
    }
  }

  function startEditReserveTransaction(tx: ReserveTransaction) {
    const key = `reserve-fund-${tx.reserveFundId}`;
    setOpenReserveFunds((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setEditingReserveTransactionId(tx.id);
    setReserveTransactionDraft({
      reserveFundId: String(tx.reserveFundId),
      type: tx.type,
      amount: String(tx.amount),
      date: tx.date.slice(0, 10),
      notes: tx.notes ?? "",
    });
  }

  async function saveReserveTransaction(id: number) {
    try {
      await api(`/reserves/transactions/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          reserveFundId: parseInt(reserveTransactionDraft.reserveFundId, 10),
          type: reserveTransactionDraft.type,
          amount: parseFloat(reserveTransactionDraft.amount || "0"),
          date: reserveTransactionDraft.date,
          notes: reserveTransactionDraft.notes.trim() || null,
        }),
      });
      setEditingReserveTransactionId(null);
      refreshReserves();
      toast({ title: "Reserve transaction updated" });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Failed to update reserve transaction",
        variant: "destructive",
      });
    }
  }

  async function deleteReserveTransaction(id: number) {
    if (!window.confirm("Delete this reserve transaction?")) return;

    try {
      await api(`/reserves/transactions/${id}`, { method: "DELETE" });
      if (editingReserveTransactionId === id) setEditingReserveTransactionId(null);
      refreshReserves();
      toast({ title: "Reserve transaction deleted" });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Failed to delete reserve transaction",
        variant: "destructive",
      });
    }
  }

  const txCategoryName = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of categories as Category[]) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const groupedTransactions = useMemo<Map<string, TransactionGroup>>(() => {
    const groups = new Map<string, TransactionGroup>();

    function addGroupItem(key: string, label: string, item: TransactionGroupItem) {
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          total: 0,
          count: 0,
          transactions: [],
        });
      }

      const group = groups.get(key)!;
      group.transactions.push(item);
      group.total += item.amount;
      group.count += 1;
    }

    for (const tx of transactions) {
      if (tx.type === "income") {
        addGroupItem("income", "Income", { tx, amount: tx.amount, categoryId: null });
        continue;
      }

      const splits = tx.splits.length > 0
        ? tx.splits
        : [{ id: null, categoryId: tx.categoryId, categoryName: tx.categoryName, amount: tx.amount }];

      for (const split of splits) {
        const key = split.categoryId == null ? "uncategorized" : `category-${split.categoryId}`;
        const label =
          split.categoryName ??
          (split.categoryId != null ? txCategoryName.get(split.categoryId) : null) ??
          "Uncategorized";

        addGroupItem(key, label, { tx, amount: split.amount, categoryId: split.categoryId });
      }
    }

    return groups;
  }, [categories, transactions, txCategoryName]);

  const categoryGroups = useMemo(() => {
    const groups = new Map<string, { label: string; categories: DashboardCategory[] }>();

    for (const cat of dashboardCategories) {
      const label = cat.categoryGroupName?.trim() || "Ungrouped";
      const key = label.toLocaleLowerCase();

      if (!groups.has(key)) {
        groups.set(key, { label, categories: [] });
      }

      groups.get(key)!.categories.push(cat);
    }

    return Array.from(groups.values());
  }, [dashboardCategories]);

  const uncategorizedGroup = groupedTransactions.get("uncategorized");
  const incomeGroup = groupedTransactions.get("income");
  const allTransactionsSorted = useMemo(() => {
    return [...transactions].sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [transactions]);

  const reserveTransactionsByFund = useMemo(() => {
    const grouped = new Map<number, ReserveTransaction[]>();
    for (const tx of reserveTransactions) {
      if (!grouped.has(tx.reserveFundId)) grouped.set(tx.reserveFundId, []);
      grouped.get(tx.reserveFundId)!.push(tx);
    }
    return grouped;
  }, [reserveTransactions]);

  function renderBudgetCategory(cat: DashboardCategory) {
    const percent =
      cat.available > 0
        ? Math.max(0, Math.min(100, (cat.spent / cat.available) * 100))
        : 0;
    const groupKey = `category-${cat.categoryId}`;
    const group = groupedTransactions.get(groupKey);

    return (
      <AccordionItem key={cat.categoryId} value={groupKey} className="overflow-hidden rounded-xl border">
        <AccordionTrigger className="px-3 py-3 hover:no-underline">
          <div className="flex min-w-0 flex-1 flex-col gap-3 pr-3 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{cat.categoryName}</div>
                <div className="text-xs text-muted-foreground">
                  Base {fmt(cat.budgeted)} / Rollover {fmt(cat.rollover, true)}
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

            <div className="flex items-center justify-between gap-3">
              <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full",
                    cat.left < 0 ? "bg-destructive" : "bg-primary"
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {txLoading
                  ? "Loading transactions..."
                  : `${group?.count ?? 0} transaction${group?.count === 1 ? "" : "s"}`}
              </div>
            </div>
          </div>
        </AccordionTrigger>

        <AccordionContent className="border-t px-3 pt-3">
          {txLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : !group || group.transactions.length === 0 ? (
            <div className="pb-1 text-sm text-muted-foreground">
              No transactions in this category for this month.
            </div>
          ) : (
            <div className="space-y-3">
              {group.transactions.map((item) =>
                renderTransactionCard(item.tx, { displayAmount: item.amount, categoryId: item.categoryId })
              )}
            </div>
          )}
        </AccordionContent>
      </AccordionItem>
    );
  }

  function renderTransactionCard(
    tx: Transaction,
    options: { displayAmount?: number; categoryId?: number | null } = {},
  ) {
    const editing = editingTxId === tx.id;
    const displayAmount = options.displayAmount ?? tx.amount;
    const isPartial = cents(displayAmount) !== cents(tx.amount);
    const splitRemaining = parseMoney(txDraft.amount) - splitDraftTotal(txDraft.splits);
    const splitSummary = tx.splits
      .map((split) => `${split.categoryName ?? "Uncategorized"} ${fmt(split.amount)}`)
      .join(" / ");

    return (
      <div key={tx.id} className="rounded-xl border p-3 space-y-3">
        {!editing ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{tx.merchant}</div>
              <div className="text-sm text-muted-foreground">
                {format(new Date(tx.date), "MMM d, yyyy")}
                {tx.type === "income"
                  ? " · Income"
                  : tx.categoryName
                  ? ` · ${tx.categoryName}`
                  : ""}
                {tx.notes ? ` · ${tx.notes}` : ""}
              </div>
              {tx.type === "expense" && tx.splits.length > 1 ? (
                <div className="mt-1 text-xs text-muted-foreground">{splitSummary}</div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <div className="text-right">
                <div
                  className={cn(
                    "font-semibold whitespace-nowrap",
                    tx.type === "income" ? "text-primary" : "",
                  )}
                >
                  {tx.type === "income" ? fmt(displayAmount, true) : fmt(displayAmount)}
                </div>
                {isPartial ? (
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    of {fmt(tx.amount)}
                  </div>
                ) : null}
              </div>
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
                    amount: cleanMoneyInput(e.target.value),
                  }))
                }
                placeholder="Amount"
              />
              <Input
                value={txDraft.merchant}
                onChange={(e) =>
                  setTxDraft((prev) => ({ ...prev, merchant: e.target.value }))
                }
                placeholder={txDraft.type === "income" ? "Source" : "Merchant"}
              />
              <select
                value={txDraft.type}
                onChange={(e) =>
                  setTxDraft((prev) => ({
                    ...prev,
                    type: e.target.value as TransactionType,
                    splitMode: e.target.value === "expense" ? prev.splitMode : false,
                  }))
                }
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <Input
                type="date"
                value={txDraft.date}
                onChange={(e) =>
                  setTxDraft((prev) => ({ ...prev, date: e.target.value }))
                }
              />
            </div>

            {txDraft.type === "expense" && !txDraft.splitMode ? (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <select
                  value={txDraft.categoryId}
                  onChange={(e) =>
                    setTxDraft((prev) => ({ ...prev, categoryId: e.target.value }))
                  }
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="null">No category</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat.id} value={String(cat.id)}>
                      {categoryOptionLabel(cat)}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setTxDraft((prev) => ({
                      ...prev,
                      splitMode: true,
                      splits: [
                        { categoryId: prev.categoryId, amount: prev.amount },
                        { categoryId: "null", amount: "" },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Split
                </Button>
              </div>
            ) : null}

            {txDraft.type === "expense" && txDraft.splitMode ? (
              <div className="rounded-xl border p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">Category splits</div>
                  <div
                    className={cn(
                      "text-sm",
                      cents(splitRemaining) === 0
                        ? "text-primary"
                        : splitRemaining < 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    Remaining {fmt(splitRemaining)}
                  </div>
                </div>

                <div className="space-y-2">
                  {txDraft.splits.map((split, index) => (
                    <div key={index} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_9rem_auto]">
                      <select
                        value={split.categoryId}
                        onChange={(e) => updateTxDraftSplit(index, { categoryId: e.target.value })}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="null">No category</option>
                        {categoryOptions.map((cat) => (
                          <option key={cat.id} value={String(cat.id)}>
                            {categoryOptionLabel(cat)}
                          </option>
                        ))}
                      </select>
                      <Input
                        inputMode="decimal"
                        placeholder="Amount"
                        value={split.amount}
                        onChange={(e) => updateTxDraftSplit(index, { amount: cleanMoneyInput(e.target.value) })}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          setTxDraft((prev) => ({
                            ...prev,
                            splits: prev.splits.filter((_, i) => i !== index),
                          }))
                        }
                        disabled={txDraft.splits.length === 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setTxDraft((prev) => ({
                        ...prev,
                        splits: [...prev.splits, { categoryId: "null", amount: "" }],
                      }))
                    }
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add split
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setTxDraft((prev) => ({
                        ...prev,
                        splitMode: false,
                        categoryId: prev.splits[0]?.categoryId ?? prev.categoryId,
                      }))
                    }
                  >
                    Single category
                  </Button>
                </div>
              </div>
            ) : null}

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
              Current:{" "}
              {tx.type === "income"
                ? "Income"
                : tx.splits.length > 1
                ? splitSummary
                : tx.categoryName ??
                  txCategoryName.get(tx.categoryId ?? -1) ??
                  "No category"}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderReserveTransactionCard(tx: ReserveTransaction) {
    const editing = editingReserveTransactionId === tx.id;

    return (
      <div key={tx.id} className="rounded-xl border p-3 space-y-3">
        {!editing ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{tx.type[0].toUpperCase() + tx.type.slice(1)}</div>
              <div className="text-sm text-muted-foreground">
                {format(new Date(`${tx.date}T00:00:00`), "MMM d, yyyy")}
                {tx.notes ? ` · ${tx.notes}` : ""}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className={cn("font-semibold whitespace-nowrap", reserveDeltaTone(tx.type, tx.amount))}>
                {fmtReserveDelta(tx.type, tx.amount)}
              </div>
              <Button variant="outline" size="icon" onClick={() => startEditReserveTransaction(tx)}>
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={reserveTransactionDraft.reserveFundId}
                onChange={(e) =>
                  setReserveTransactionDraft((prev) => ({ ...prev, reserveFundId: e.target.value }))
                }
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {reserveFunds.map((fund) => (
                  <option key={fund.id} value={String(fund.id)}>
                    {fund.name}
                  </option>
                ))}
              </select>
              <select
                value={reserveTransactionDraft.type}
                onChange={(e) =>
                  setReserveTransactionDraft((prev) => ({
                    ...prev,
                    type: e.target.value as ReserveTransactionType,
                  }))
                }
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="contribution">Contribution</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="adjustment">Adjustment</option>
              </select>
              <Input
                inputMode="decimal"
                value={reserveTransactionDraft.amount}
                onChange={(e) =>
                  setReserveTransactionDraft((prev) => ({
                    ...prev,
                    amount: e.target.value.replace(/[^0-9.-]/g, ""),
                  }))
                }
                placeholder="Amount"
              />
              <Input
                type="date"
                value={reserveTransactionDraft.date}
                onChange={(e) =>
                  setReserveTransactionDraft((prev) => ({ ...prev, date: e.target.value }))
                }
              />
            </div>

            <Textarea
              value={reserveTransactionDraft.notes}
              onChange={(e) =>
                setReserveTransactionDraft((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Notes"
              className="min-h-24"
            />

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => saveReserveTransaction(tx.id)}>
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
              <Button variant="outline" onClick={() => setEditingReserveTransactionId(null)}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => deleteReserveTransaction(tx.id)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Finances</h1>
      </div>

      <TransactionForm year={year} month={month} categories={categoryOptions} onSaved={refreshAll} />

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
        <Tabs defaultValue="monthly" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-4 rounded-xl bg-muted/40 p-1">
            <TabsTrigger value="monthly" className="rounded-lg py-2">Monthly</TabsTrigger>
            <TabsTrigger value="reserves" className="rounded-lg py-2">Funds</TabsTrigger>
            <TabsTrigger value="transactions" className="rounded-lg py-2">Transactions</TabsTrigger>
            <TabsTrigger value="reviews" className="rounded-lg py-2">Reviews</TabsTrigger>
          </TabsList>

          <TabsContent value="monthly" className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-muted-foreground">Month</div>
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

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Planned income",
                  value: fmt(dashboardView?.incomeAmount ?? 0),
                  color: "text-primary",
                },
                {
                  label: "Income received",
                  value: fmt(dashboardView?.incomeTransactionsTotal ?? 0, true),
                  color: "text-primary",
                },
                {
                  label: "Spent",
                  value: fmt(dashboard.totalSpent),
                  color: "",
                },
                {
                  label: "Received left",
                  value: fmt(dashboardView?.incomeRemaining ?? 0),
                  color:
                    (dashboardView?.incomeRemaining ?? 0) < 0
                      ? "text-destructive"
                      : "text-primary",
                },
                { label: "Base budget", value: fmt(dashboard.totalBudgeted), color: "" },
                {
                  label: "Available",
                  value: fmt(dashboard.totalAvailable),
                  color: "text-primary",
                },
                {
                  label:
                    budgetOverUnder === 0
                      ? "On budget"
                      : budgetOverUnder < 0
                      ? "Over budget"
                      : "Under budget",
                  value: fmt(Math.abs(budgetOverUnder)),
                  color:
                    budgetOverUnder < 0 ? "text-destructive" : "text-secondary",
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

              <Accordion
                type="multiple"
                value={openTransactionGroups}
                onValueChange={setOpenTransactionGroups}
                className="space-y-3"
              >
                {categoryGroups.map((group) => (
                  <div key={group.label} className="space-y-2">
                    <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </div>
                    {group.categories.map((cat) => renderBudgetCategory(cat))}
                  </div>
                ))}

                {uncategorizedGroup ? (
                  <AccordionItem value="uncategorized" className="overflow-hidden rounded-xl border">
                    <AccordionTrigger className="px-3 py-3 hover:no-underline">
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-3 text-left">
                        <div className="min-w-0">
                          <div className="font-medium">Uncategorized</div>
                          <div className="text-xs text-muted-foreground">
                            Transactions without a budget category
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold">{fmt(uncategorizedGroup.total)}</div>
                          <div className="text-xs text-muted-foreground">
                            {uncategorizedGroup.count} transaction{uncategorizedGroup.count === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="border-t px-3 pt-3">
                      <div className="space-y-3">
                        {uncategorizedGroup.transactions.map((item) =>
                          renderTransactionCard(item.tx, { displayAmount: item.amount, categoryId: item.categoryId })
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ) : null}

                {incomeGroup ? (
                  <AccordionItem value="income" className="overflow-hidden rounded-xl border">
                    <AccordionTrigger className="px-3 py-3 hover:no-underline">
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-3 text-left">
                        <div className="min-w-0">
                          <div className="font-medium">Income</div>
                          <div className="text-xs text-muted-foreground">
                            Income transactions for this month
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold text-primary">{fmt(incomeGroup.total, true)}</div>
                          <div className="text-xs text-muted-foreground">
                            {incomeGroup.count} transaction{incomeGroup.count === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="border-t px-3 pt-3">
                      <div className="space-y-3">
                        {incomeGroup.transactions.map((item) => renderTransactionCard(item.tx))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ) : null}
              </Accordion>
            </div>
          </TabsContent>

          <TabsContent value="reserves" className="space-y-4">
            <form onSubmit={createReserveFund} className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
              <div className="font-medium">Add reserve fund</div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  placeholder="Fund name"
                  value={newReserveFund.name}
                  onChange={(e) => setNewReserveFund((prev) => ({ ...prev, name: e.target.value }))}
                />
                <Input
                  inputMode="decimal"
                  placeholder="Target amount (optional)"
                  value={newReserveFund.targetAmount}
                  onChange={(e) =>
                    setNewReserveFund((prev) => ({
                      ...prev,
                      targetAmount: e.target.value.replace(/[^0-9.]/g, ""),
                    }))
                  }
                />
                <Input
                  placeholder="Icon (optional)"
                  value={newReserveFund.icon}
                  onChange={(e) => setNewReserveFund((prev) => ({ ...prev, icon: e.target.value }))}
                />
                <Input
                  placeholder="Color (optional)"
                  value={newReserveFund.color}
                  onChange={(e) => setNewReserveFund((prev) => ({ ...prev, color: e.target.value }))}
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={savingNewReserveFund}>
                  {savingNewReserveFund ? "Saving..." : "Create reserve fund"}
                </Button>
              </div>
            </form>

            <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
              <div className="font-medium">Funds</div>

              {reserveLoading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-36 rounded-2xl" />
                  ))}
                </div>
              ) : reserveFunds.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No reserve funds yet. Create one for Emergency Fund, Savings Fund, Vacation, Car Repair, or Home Maintenance.
                </div>
              ) : (
                <Accordion
                  type="multiple"
                  value={openReserveFunds}
                  onValueChange={setOpenReserveFunds}
                  className="space-y-3"
                >
                  {reserveFunds.map((fund) => {
                    const fundTransactions = reserveTransactionsByFund.get(fund.id) ?? [];
                    const progress = fund.progress ?? 0;
                    const targetLabel =
                      fund.targetAmount == null ? "No target" : `Target ${fmt(fund.targetAmount)}`;

                    return (
                      <AccordionItem
                        key={fund.id}
                        value={`reserve-fund-${fund.id}`}
                        className="overflow-hidden rounded-xl border"
                      >
                        <AccordionTrigger className="px-3 py-3 hover:no-underline">
                          <div className="flex min-w-0 flex-1 flex-col gap-3 pr-3 text-left">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium">{fund.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {targetLabel}
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-sm text-muted-foreground">Balance</div>
                                <div className="text-lg font-semibold text-primary">{fmt(fund.balance)}</div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                              <div className="rounded-lg bg-muted/40 px-3 py-2">
                                <div className="text-xs text-muted-foreground">Current</div>
                                <div className="font-medium">{fmt(fund.balance)}</div>
                              </div>
                              <div className="rounded-lg bg-muted/40 px-3 py-2">
                                <div className="text-xs text-muted-foreground">Target</div>
                                <div className="font-medium">
                                  {fund.targetAmount == null ? "None" : fmt(fund.targetAmount)}
                                </div>
                              </div>
                              <div className="rounded-lg bg-muted/40 px-3 py-2 col-span-2 md:col-span-1">
                                <div className="text-xs text-muted-foreground">Transactions</div>
                                <div className="font-medium">{fund.transactionCount}</div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-3">
                              <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full bg-primary"
                                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                                />
                              </div>
                              <div className="shrink-0 text-xs text-muted-foreground">
                                {fund.targetAmount == null ? "No target" : `${Math.round(progress)}% funded`}
                              </div>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="border-t px-3 pt-3">
                          <div className="space-y-4">
                            {editingReserveFundId !== fund.id ? (
                              <div className="flex flex-wrap gap-2">
                                <Button variant="outline" onClick={() => startEditReserveFund(fund)}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Edit fund
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => deleteReserveFund(fund.id, fund.name)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete fund
                                </Button>
                              </div>
                            ) : (
                              <div className="rounded-xl border p-3 space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <Input
                                    value={reserveFundDraft.name}
                                    onChange={(e) =>
                                      setReserveFundDraft((prev) => ({ ...prev, name: e.target.value }))
                                    }
                                    placeholder="Fund name"
                                  />
                                  <Input
                                    inputMode="decimal"
                                    value={reserveFundDraft.targetAmount}
                                    onChange={(e) =>
                                      setReserveFundDraft((prev) => ({
                                        ...prev,
                                        targetAmount: e.target.value.replace(/[^0-9.]/g, ""),
                                      }))
                                    }
                                    placeholder="Target amount"
                                  />
                                  <Input
                                    value={reserveFundDraft.icon}
                                    onChange={(e) =>
                                      setReserveFundDraft((prev) => ({ ...prev, icon: e.target.value }))
                                    }
                                    placeholder="Icon"
                                  />
                                  <Input
                                    value={reserveFundDraft.color}
                                    onChange={(e) =>
                                      setReserveFundDraft((prev) => ({ ...prev, color: e.target.value }))
                                    }
                                    placeholder="Color"
                                  />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Button onClick={() => saveReserveFund(fund.id)}>
                                    <Save className="mr-2 h-4 w-4" />
                                    Save
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      setEditingReserveFundId(null);
                                      setReserveFundDraft(emptyReserveFundDraft());
                                    }}
                                  >
                                    <X className="mr-2 h-4 w-4" />
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}

                            <ReserveTransactionForm reserveFundId={fund.id} onSaved={refreshReserves} />

                            {fundTransactions.length === 0 ? (
                              <div className="text-sm text-muted-foreground">
                                No reserve transactions yet.
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {fundTransactions.map((tx) => renderReserveTransactionCard(tx))}
                              </div>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </div>
          </TabsContent>

          <TabsContent value="transactions" className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm">
              <div className="text-sm font-medium text-muted-foreground">Month</div>
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
            <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
              <div className="font-medium">All Transactions</div>

              {txLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20 rounded-xl" />
                  ))}
                </div>
              ) : allTransactionsSorted.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No transactions for this month.
                </div>
              ) : (
                <div className="space-y-3">
                  {allTransactionsSorted.map((tx) => renderTransactionCard(tx))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="reviews" className="space-y-4">
            <MonthlyReviewTab
              apiOrigin={API_ORIGIN}
              viewDate={viewDate}
              setViewDate={setViewDate}
              isCurrentMonth={isCurrentMonth}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
