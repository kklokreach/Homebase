import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { FileText, Plus, Save, Search, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? "https://homebase-ll6f.onrender.com")
  .replace(/\/api\/?$/, "")
  .replace(/\/$/, "");

type Note = {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_ORIGIN}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Fall back to the status code when the response has no JSON body.
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function preview(note: Note) {
  const text = note.body.trim().replace(/\s+/g, " ");
  return text || "No content";
}

function displayTitle(note: Note) {
  return note.title.trim() || "Untitled note";
}

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { toast } = useToast();

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId],
  );

  const hasChanges = Boolean(
    selectedNote &&
      (draftTitle !== selectedNote.title || draftBody !== selectedNote.body),
  );

  useEffect(() => {
    let cancelled = false;

    async function loadNotes() {
      try {
        setLoading(true);
        setError(null);
        const params = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
        const data = await api<Note[]>(`/notes${params}`);

        if (cancelled) return;
        setNotes(data);
        setSelectedId((current) => {
          if (current != null && data.some((note) => note.id === current)) return current;
          return data[0]?.id ?? null;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load notes");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadNotes();
    return () => {
      cancelled = true;
    };
  }, [search]);

  useEffect(() => {
    if (!selectedNote) {
      setDraftTitle("");
      setDraftBody("");
      return;
    }

    setDraftTitle(selectedNote.title);
    setDraftBody(selectedNote.body);
  }, [selectedNote]);

  const handleCreate = async () => {
    if (creating) return;

    try {
      setCreating(true);
      const note = await api<Note>("/notes", {
        method: "POST",
        body: JSON.stringify({ title: "", body: "" }),
      });

      setSearch("");
      setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
      setSelectedId(note.id);
      setDraftTitle(note.title);
      setDraftBody(note.body);
    } catch (err) {
      toast({
        title: "Failed to create note",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedNote || saving) return;

    try {
      setSaving(true);
      const note = await api<Note>(`/notes/${selectedNote.id}`, {
        method: "PUT",
        body: JSON.stringify({ title: draftTitle.trim(), body: draftBody }),
      });

      setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
      setSelectedId(note.id);
      toast({ title: "Note saved" });
    } catch (err) {
      toast({
        title: "Failed to save note",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedNote || deleting) return;

    try {
      setDeleting(true);
      await api<void>(`/notes/${selectedNote.id}`, { method: "DELETE" });
      const remaining = notes.filter((note) => note.id !== selectedNote.id);
      setNotes(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setDeleteOpen(false);
    } catch (err) {
      toast({
        title: "Failed to delete note",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
            <FileText className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Notes</h1>
        </div>
        <Button onClick={handleCreate} disabled={creating} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          New Note
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search notes"
              className="pl-9"
            />
          </div>

          <div className="rounded-2xl border bg-card overflow-hidden">
            {loading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            ) : error ? (
              <div className="p-4 text-sm text-red-600">{error}</div>
            ) : notes.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No notes found.</div>
            ) : (
              <div className="max-h-[42vh] divide-y divide-border/50 overflow-y-auto lg:max-h-[calc(100dvh-260px)]">
                {notes.map((note) => {
                  const isSelected = note.id === selectedId;
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => setSelectedId(note.id)}
                      className={cn(
                        "block w-full p-3 text-left transition-colors hover:bg-accent/50",
                        isSelected && "bg-primary/10 text-primary",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={cn("truncate text-sm font-medium", !note.title.trim() && "text-muted-foreground")}>
                            {displayTitle(note)}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {preview(note)}
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {format(new Date(note.updatedAt), "MMM d")}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          {selectedNote ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  Updated {format(new Date(selectedNote.updatedAt), "MMM d, yyyy")}
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" className="w-full sm:w-auto">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete note?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete "{displayTitle(selectedNote)}".
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDelete}
                          className="bg-destructive text-destructive-foreground border-destructive-border"
                          disabled={deleting}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <Button
                    type="button"
                    onClick={handleSave}
                    disabled={!hasChanges || saving}
                    className="w-full sm:w-auto"
                  >
                    <Save className="h-4 w-4" />
                    Save
                  </Button>
                </div>
              </div>

              <Input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                className="h-12 text-lg font-semibold"
                placeholder="Untitled note"
              />
              <Textarea
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                placeholder="Write a note..."
                className="min-h-[420px] resize-y leading-relaxed"
              />
            </div>
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-border/60 p-6 text-center">
              <FileText className="mb-3 h-8 w-8 text-muted-foreground" />
              <h2 className="text-lg font-medium">No note selected</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Create a note or select one from the list.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
