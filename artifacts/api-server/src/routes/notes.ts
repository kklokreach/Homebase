import { Router, type IRouter } from "express";
import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { notesTable } from "@workspace/db/schema";

const router: IRouter = Router();

type NoteInput = {
  title?: string;
  body?: string;
};

function getIdFromParams(params: Record<string, string | string[]>): number {
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  return parseInt(raw, 10);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNoteBody(body: unknown, partial: boolean): NoteInput | { error: string } {
  if (!isPlainObject(body)) return { error: "Body must be an object" };

  const titleRaw = body["title"];
  const bodyRaw = body["body"];
  const input: NoteInput = {};

  if (titleRaw !== undefined) {
    if (typeof titleRaw !== "string") {
      return { error: "title must be a string" };
    }
    input.title = titleRaw.trim();
  } else if (!partial) {
    return { error: "title is required" };
  }

  if (bodyRaw !== undefined) {
    if (typeof bodyRaw !== "string") {
      return { error: "body must be a string" };
    }
    input.body = bodyRaw;
  }

  if (partial && input.title === undefined && input.body === undefined) {
    return { error: "At least one field is required" };
  }

  return input;
}

function serializeNote(note: typeof notesTable.$inferSelect) {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

router.get("/notes", async (req, res): Promise<void> => {
  const rawSearch = Array.isArray(req.query.search) ? req.query.search[0] : req.query.search;
  const search = typeof rawSearch === "string" ? rawSearch.trim() : "";
  const pattern = `%${search}%`;

  const notes = search
    ? await db
        .select()
        .from(notesTable)
        .where(or(ilike(notesTable.title, pattern), ilike(notesTable.body, pattern)))
        .orderBy(desc(notesTable.updatedAt), desc(notesTable.createdAt))
    : await db
        .select()
        .from(notesTable)
        .orderBy(desc(notesTable.updatedAt), desc(notesTable.createdAt));

  res.json(notes.map(serializeNote));
});

router.post("/notes", async (req, res): Promise<void> => {
  const parsed = validateNoteBody(req.body, false);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const [note] = await db
    .insert(notesTable)
    .values({
      title: parsed.title!,
      body: parsed.body ?? "",
    })
    .returning();

  res.status(201).json(serializeNote(note));
});

router.get("/notes/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid note id" });
    return;
  }

  const [note] = await db.select().from(notesTable).where(eq(notesTable.id, id));
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json(serializeNote(note));
});

router.put("/notes/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid note id" });
    return;
  }

  const parsed = validateNoteBody(req.body, true);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const [note] = await db
    .update(notesTable)
    .set({
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      ...(parsed.body !== undefined ? { body: parsed.body } : {}),
    })
    .where(eq(notesTable.id, id))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json(serializeNote(note));
});

router.delete("/notes/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid note id" });
    return;
  }

  const [note] = await db.delete(notesTable).where(eq(notesTable.id, id)).returning();
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.status(204).send();
});

export default router;
