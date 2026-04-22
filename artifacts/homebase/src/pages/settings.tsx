import { useState } from "react";
import { Pencil, Plus, Settings as SettingsIcon, Trash2, Save, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
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

export default function Settings() {
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: categories, isLoading } = useListBudgetCategories();

  function refresh() {
    queryClient.invalidateQueries({ queryKey: getListBudgetCategoriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetHomeSnapshotQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBudgetDashboardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
  }

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
            Manage the categories used for transactions and monthly budgets.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
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

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : categories?.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No categories yet. Add one above.
            </div>
          ) : (
            <div className="space-y-2">
              {categories?.map((cat) => {
                const editing = editingId === cat.id;

                return (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/50 px-3 py-3"
                  >
                    {!editing ? (
                      <>
                        <div className="font-medium">{cat.name}</div>
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
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
