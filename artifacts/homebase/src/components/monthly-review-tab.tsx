import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { format, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, Pencil, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type MonthlyReview = {
  id: number;
  year: number;
  month: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

type BudgetReviewCategory = {
  categoryId: number;
  categoryName: string;
  budgeted: number;
  spent: number;
  left: number;
};

type BudgetReview = {
  year: number;
  month: number;
  totalBudgeted: number;
  totalSpent: number;
  totalLeft: number;
  overBudgetCount: number;
  underBudgetCount: number;
  categories: BudgetReviewCategory[];
};

type FundsReviewFund = {
  id: number;
  name: string;
  targetAmount?: number | null;
  balance: number;
  monthlyChange: number;
  progress?: number | null;
};

type FundsReview = {
  year: number;
  month: number;
  totalBalance: number;
  totalMonthlyChange: number;
  funds: FundsReviewFund[];
};

type AccountSnapshot = {
  id: number;
  monthlyReviewId: number;
  accountName: string;
  accountType?: string | null;
  balance: number;
  sortOrder: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

type MonthlyReviewPayload = {
  review: MonthlyReview;
  budgetReview: BudgetReview;
  fundsReview: FundsReview;
  accountSnapshots: AccountSnapshot[];
};

type AccountSnapshotDraft = {
  accountName: string;
  accountType: string;
  balance: string;
  sortOrder: string;
  notes: string;
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

function emptySnapshotDraft(): AccountSnapshotDraft {
  return {
    accountName: "",
    accountType: "",
    balance: "",
    sortOrder: "0",
    notes: "",
  };
}

function snapshotToDraft(snapshot: AccountSnapshot): AccountSnapshotDraft {
  return {
    accountName: snapshot.accountName,
    accountType: snapshot.accountType ?? "",
    balance: String(snapshot.balance),
    sortOrder: String(snapshot.sortOrder),
    notes: snapshot.notes ?? "",
  };
}

async function api<T>(apiOrigin: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiOrigin}/api${path}`, {
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

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function MonthlyReviewTab({
  apiOrigin,
  viewDate,
  setViewDate,
  isCurrentMonth,
}: {
  apiOrigin: string;
  viewDate: Date;
  setViewDate: Dispatch<SetStateAction<Date>>;
  isCurrentMonth: boolean;
}) {
  const [data, setData] = useState<MonthlyReviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [newSnapshot, setNewSnapshot] = useState<AccountSnapshotDraft>(() => emptySnapshotDraft());
  const [savingNewSnapshot, setSavingNewSnapshot] = useState(false);
  const [editingSnapshotId, setEditingSnapshotId] = useState<number | null>(null);
  const [snapshotDraft, setSnapshotDraft] = useState<AccountSnapshotDraft>(() => emptySnapshotDraft());

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;

  async function loadReview() {
    try {
      setLoading(true);
      setError(null);
      const reviewData = await api<MonthlyReviewPayload>(
        apiOrigin,
        `/reviews/monthly?year=${year}&month=${month}`,
      );
      setData(reviewData);
      setNotesDraft(reviewData.review.notes ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReview();
  }, [apiOrigin, year, month]);

  const totalAccountsBalance = useMemo(() => {
    return (data?.accountSnapshots ?? []).reduce((sum, account) => sum + account.balance, 0);
  }, [data]);

  async function saveNotes() {
    if (!data) return;
    try {
      setSavingNotes(true);
      const updated = await api<MonthlyReview>(apiOrigin, `/reviews/monthly/${data.review.id}`, {
        method: "PUT",
        body: JSON.stringify({ notes: notesDraft.trim() || null }),
      });
      setData((prev) => (prev ? { ...prev, review: updated } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setSavingNotes(false);
    }
  }

  async function createSnapshot(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !newSnapshot.accountName.trim() || newSnapshot.balance.trim() === "") return;

    try {
      setSavingNewSnapshot(true);
      await api<AccountSnapshot>(apiOrigin, `/reviews/monthly/${data.review.id}/accounts`, {
        method: "POST",
        body: JSON.stringify({
          accountName: newSnapshot.accountName.trim(),
          accountType: newSnapshot.accountType.trim() || null,
          balance: parseFloat(newSnapshot.balance),
          sortOrder: parseInt(newSnapshot.sortOrder || "0", 10) || 0,
          notes: newSnapshot.notes.trim() || null,
        }),
      });
      setNewSnapshot(emptySnapshotDraft());
      await loadReview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account snapshot");
    } finally {
      setSavingNewSnapshot(false);
    }
  }

  function startEditSnapshot(snapshot: AccountSnapshot) {
    setEditingSnapshotId(snapshot.id);
    setSnapshotDraft(snapshotToDraft(snapshot));
  }

  async function saveSnapshot(id: number) {
    try {
      await api<AccountSnapshot>(apiOrigin, `/reviews/monthly/accounts/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          accountName: snapshotDraft.accountName.trim(),
          accountType: snapshotDraft.accountType.trim() || null,
          balance: parseFloat(snapshotDraft.balance),
          sortOrder: parseInt(snapshotDraft.sortOrder || "0", 10) || 0,
          notes: snapshotDraft.notes.trim() || null,
        }),
      });
      setEditingSnapshotId(null);
      setSnapshotDraft(emptySnapshotDraft());
      await loadReview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update account snapshot");
    }
  }

  async function deleteSnapshot(id: number) {
    if (!window.confirm("Delete this account snapshot?")) return;
    try {
      await api(apiOrigin, `/reviews/monthly/accounts/${id}`, { method: "DELETE" });
      if (editingSnapshotId === id) {
        setEditingSnapshotId(null);
        setSnapshotDraft(emptySnapshotDraft());
      }
      await loadReview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account snapshot");
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border bg-card p-4 text-sm text-destructive">
        {error ?? "Could not load the monthly review."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-muted-foreground">Review month</div>
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

      {error ? (
        <div className="rounded-xl border bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">Budgeted</div>
          <div className="mt-2 text-2xl font-semibold">{fmt(data.budgetReview.totalBudgeted)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">Spent</div>
          <div className="mt-2 text-2xl font-semibold">{fmt(data.budgetReview.totalSpent)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">Funds balance</div>
          <div className="mt-2 text-2xl font-semibold text-primary">{fmt(data.fundsReview.totalBalance)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">Account snapshot total</div>
          <div className="mt-2 text-2xl font-semibold">{fmt(totalAccountsBalance)}</div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
        <div className="font-medium">Budget Review</div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">Total left</div>
            <div className={cn("mt-1 font-semibold", data.budgetReview.totalLeft < 0 ? "text-destructive" : "text-primary")}>
              {fmt(data.budgetReview.totalLeft)}
            </div>
          </div>
          <div className="rounded-xl bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">Over budget categories</div>
            <div className="mt-1 font-semibold">{data.budgetReview.overBudgetCount}</div>
          </div>
          <div className="rounded-xl bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">Under budget categories</div>
            <div className="mt-1 font-semibold">{data.budgetReview.underBudgetCount}</div>
          </div>
        </div>
        <div className="space-y-2">
          {data.budgetReview.categories.map((category) => (
            <div key={category.categoryId} className="rounded-xl border px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="font-medium">{category.categoryName}</div>
                <div className={cn("text-sm font-medium", category.left < 0 ? "text-destructive" : "text-primary")}>
                  {fmt(category.left)}
                </div>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Budgeted {fmt(category.budgeted)} · Spent {fmt(category.spent)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
        <div className="font-medium">Funds Review</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">Ending balance</div>
            <div className="mt-1 font-semibold text-primary">{fmt(data.fundsReview.totalBalance)}</div>
          </div>
          <div className="rounded-xl bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">Monthly change</div>
            <div className={cn("mt-1 font-semibold", data.fundsReview.totalMonthlyChange < 0 ? "text-destructive" : "text-primary")}>
              {fmt(data.fundsReview.totalMonthlyChange, true)}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {data.fundsReview.funds.length === 0 ? (
            <div className="text-sm text-muted-foreground">No funds yet.</div>
          ) : (
            data.fundsReview.funds.map((fund) => (
              <div key={fund.id} className="rounded-xl border px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium">{fund.name}</div>
                  <div className="text-right">
                    <div className="font-semibold">{fmt(fund.balance)}</div>
                    <div className={cn("text-xs", fund.monthlyChange < 0 ? "text-destructive" : "text-primary")}>
                      {fmt(fund.monthlyChange, true)} this month
                    </div>
                  </div>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {fund.targetAmount == null ? "No target set" : `Target ${fmt(fund.targetAmount)}`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-4">
        <div className="font-medium">Account Snapshot</div>
        <form onSubmit={createSnapshot} className="rounded-xl border bg-background/50 p-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              placeholder="Account name"
              value={newSnapshot.accountName}
              onChange={(e) => setNewSnapshot((prev) => ({ ...prev, accountName: e.target.value }))}
            />
            <Input
              placeholder="Account type (optional)"
              value={newSnapshot.accountType}
              onChange={(e) => setNewSnapshot((prev) => ({ ...prev, accountType: e.target.value }))}
            />
            <Input
              inputMode="decimal"
              placeholder="Balance"
              value={newSnapshot.balance}
              onChange={(e) => setNewSnapshot((prev) => ({ ...prev, balance: e.target.value.replace(/[^0-9.-]/g, "") }))}
            />
            <Input
              inputMode="numeric"
              placeholder="Sort order"
              value={newSnapshot.sortOrder}
              onChange={(e) => setNewSnapshot((prev) => ({ ...prev, sortOrder: e.target.value.replace(/[^0-9-]/g, "") }))}
            />
          </div>
          <Textarea
            placeholder="Notes (optional)"
            value={newSnapshot.notes}
            onChange={(e) => setNewSnapshot((prev) => ({ ...prev, notes: e.target.value }))}
            className="min-h-20"
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={savingNewSnapshot}>
              {savingNewSnapshot ? "Saving..." : "Add account snapshot"}
            </Button>
          </div>
        </form>

        {data.accountSnapshots.length === 0 ? (
          <div className="text-sm text-muted-foreground">No account snapshots recorded for this month.</div>
        ) : (
          <div className="space-y-3">
            {data.accountSnapshots.map((snapshot) => {
              const editing = editingSnapshotId === snapshot.id;

              return (
                <div key={snapshot.id} className="rounded-xl border p-3 space-y-3">
                  {!editing ? (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{snapshot.accountName}</div>
                        <div className="text-sm text-muted-foreground">
                          {snapshot.accountType ? `${snapshot.accountType} · ` : ""}
                          {snapshot.notes || "No notes"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="font-semibold whitespace-nowrap">{fmt(snapshot.balance)}</div>
                        <Button variant="outline" size="icon" onClick={() => startEditSnapshot(snapshot)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <Input
                          value={snapshotDraft.accountName}
                          onChange={(e) => setSnapshotDraft((prev) => ({ ...prev, accountName: e.target.value }))}
                          placeholder="Account name"
                        />
                        <Input
                          value={snapshotDraft.accountType}
                          onChange={(e) => setSnapshotDraft((prev) => ({ ...prev, accountType: e.target.value }))}
                          placeholder="Account type"
                        />
                        <Input
                          inputMode="decimal"
                          value={snapshotDraft.balance}
                          onChange={(e) => setSnapshotDraft((prev) => ({ ...prev, balance: e.target.value.replace(/[^0-9.-]/g, "") }))}
                          placeholder="Balance"
                        />
                        <Input
                          inputMode="numeric"
                          value={snapshotDraft.sortOrder}
                          onChange={(e) => setSnapshotDraft((prev) => ({ ...prev, sortOrder: e.target.value.replace(/[^0-9-]/g, "") }))}
                          placeholder="Sort order"
                        />
                      </div>
                      <Textarea
                        value={snapshotDraft.notes}
                        onChange={(e) => setSnapshotDraft((prev) => ({ ...prev, notes: e.target.value }))}
                        placeholder="Notes"
                        className="min-h-20"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => saveSnapshot(snapshot.id)}>
                          <Save className="mr-2 h-4 w-4" />
                          Save
                        </Button>
                        <Button variant="outline" onClick={() => setEditingSnapshotId(null)}>
                          <X className="mr-2 h-4 w-4" />
                          Cancel
                        </Button>
                        <Button variant="destructive" onClick={() => deleteSnapshot(snapshot.id)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
        <div className="font-medium">Monthly Notes</div>
        <Textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          placeholder="Add notes for this monthly review"
          className="min-h-28"
        />
        <div className="flex justify-end">
          <Button onClick={saveNotes} disabled={savingNotes}>
            {savingNotes ? "Saving..." : "Save notes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
