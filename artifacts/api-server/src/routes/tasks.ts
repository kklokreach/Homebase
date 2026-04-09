import { Router, type IRouter } from "express";
import { and, eq, gte, lte, isNull, or, sql } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";
import {
  CreateTaskBody,
  UpdateTaskBody,
  GetTaskParams,
  UpdateTaskParams,
  DeleteTaskParams,
  CompleteTaskParams,
  CompleteTaskBody,
  ListTasksQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getIdFromParams(params: Record<string, string | string[]>): number {
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  return parseInt(raw, 10);
}

router.get("/tasks", async (req, res): Promise<void> => {
  const parsed = ListTasksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { assignee, view, completed } = parsed.data;
  const today = new Date().toISOString().split("T")[0];

  const conditions = [];

  if (completed !== undefined) {
    conditions.push(eq(tasksTable.completed, completed));
  }

  if (view === "today") {
    conditions.push(
      and(
        eq(tasksTable.completed, false),
        or(
          eq(tasksTable.dueDate, today),
          isNull(tasksTable.dueDate),
        ),
      ) ?? sql`true`,
    );
  } else if (view === "upcoming") {
    conditions.push(eq(tasksTable.completed, false));
    conditions.push(gte(tasksTable.dueDate, today));
  } else if (view === "mine") {
    conditions.push(eq(tasksTable.assignee, "me"));
  } else if (view === "wife") {
    conditions.push(eq(tasksTable.assignee, "wife"));
  } else if (view === "shared") {
    conditions.push(eq(tasksTable.assignee, "us"));
  }

  if (assignee && !view) {
    conditions.push(eq(tasksTable.assignee, assignee));
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(tasksTable.dueDate, tasksTable.createdAt);

  res.json(tasks.map(serializeTask));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [task] = await db
    .insert(tasksTable)
    .values({
      title: parsed.data.title,
      assignee: parsed.data.assignee ?? null,
      dueDate: parsed.data.dueDate ?? null,
      recurring: parsed.data.recurring ?? null,
      notes: parsed.data.notes ?? null,
      category: parsed.data.category ?? null,
    })
    .returning();

  res.status(201).json(serializeTask(task));
});

router.get("/tasks/summary/today", async (req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.completed, false),
        or(eq(tasksTable.dueDate, today), isNull(tasksTable.dueDate)),
      ),
    )
    .orderBy(tasksTable.createdAt);

  const me = tasks.filter((t) => t.assignee === "me").map(serializeTask);
  const wife = tasks.filter((t) => t.assignee === "wife").map(serializeTask);
  const shared = tasks.filter((t) => t.assignee === "us").map(serializeTask);

  const completedToday = await db
    .select({ count: sql<number>`count(*)` })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.completed, true),
        gte(tasksTable.completedAt, new Date(today)),
      ),
    );

  res.json({
    me,
    wife,
    shared,
    totalToday: me.length + wife.length + shared.length,
    completedToday: Number(completedToday[0]?.count ?? 0),
  });
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(serializeTask(task));
});

router.put("/tasks/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.title !== undefined) updates.title = d.title;
  if ("assignee" in d) updates.assignee = d.assignee ?? null;
  if ("dueDate" in d) updates.dueDate = d.dueDate ?? null;
  if ("recurring" in d) updates.recurring = d.recurring ?? null;
  if ("notes" in d) updates.notes = d.notes ?? null;
  if ("category" in d) updates.category = d.category ?? null;
  if (d.completed !== undefined) {
    updates.completed = d.completed;
    updates.completedAt = d.completed ? new Date() : null;
  }

  const [task] = await db
    .update(tasksTable)
    .set(updates)
    .where(eq(tasksTable.id, id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(serializeTask(task));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const [task] = await db.delete(tasksTable).where(eq(tasksTable.id, id)).returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/tasks/:id/complete", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const parsed = CompleteTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [task] = await db
    .update(tasksTable)
    .set({
      completed: parsed.data.completed,
      completedAt: parsed.data.completed ? new Date() : null,
    })
    .where(eq(tasksTable.id, id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(serializeTask(task));
});

function serializeTask(task: typeof tasksTable.$inferSelect) {
  return {
    id: task.id,
    title: task.title,
    assignee: task.assignee,
    dueDate: task.dueDate,
    recurring: task.recurring,
    notes: task.notes,
    category: task.category,
    completed: task.completed,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export default router;
