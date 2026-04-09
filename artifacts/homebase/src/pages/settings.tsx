import { useState } from "react";
import { Plus, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListBudgetCategories,
  useCreateBudgetCategory,
  useDeleteBudgetCategory,
  getListBudgetCategoriesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function Settings() {
  const [newCategoryName, setNewCategoryName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: categories, isLoading } = useListBudgetCategories();
  const createCategory = useCreateBudgetCategory();
  const deleteCategory = useDeleteBudgetCategory();

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    createCategory.mutate(
      { data: { name: newCategoryName.trim() } },
      {
        onSuccess: () => {
          setNewCategoryName("");
          queryClient.invalidateQueries({ queryKey: getListBudgetCategoriesQueryKey() });
          toast({ title: "Category added" });
        },
        onError: () => {
          toast({ title: "Failed to add category", variant: "destructive" });
        }
      }
    );
  };

  const handleDeleteCategory = (id: number) => {
    deleteCategory.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBudgetCategoriesQueryKey() });
          toast({ title: "Category deleted" });
        },
        onError: () => {
          toast({ title: "Failed to delete category", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-muted rounded-xl text-muted-foreground">
            <SettingsIcon className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Settings</h1>
        </div>
      </header>

      <div className="space-y-8 pt-4">
        <Card className="bg-card border-border/50 shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/20 border-b border-border/50 pb-6">
            <CardTitle>Budget Categories</CardTitle>
            <CardDescription>Manage the categories used for transactions and monthly budgets.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <form onSubmit={handleAddCategory} className="flex gap-3">
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name..."
                className="bg-background border-border/50"
              />
              <Button type="submit" disabled={createCategory.isPending || !newCategoryName.trim()}>
                <Plus className="w-4 h-4 mr-2" /> Add
              </Button>
            </form>

            <div className="space-y-2 pt-2">
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              ) : categories?.length === 0 ? (
                <div className="text-center p-6 text-sm text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border/50">
                  No categories yet. Add one above.
                </div>
              ) : (
                <div className="grid gap-2">
                  {categories?.map((cat) => (
                    <div key={cat.id} className="flex items-center justify-between p-3 bg-background border border-border/50 rounded-lg group hover:border-primary/20 transition-colors">
                      <span className="font-medium">{cat.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all h-8 w-8"
                        onClick={() => handleDeleteCategory(cat.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}