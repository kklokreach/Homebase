import { Router, type IRouter } from "express";
import { and, eq, gte, isNull, inArray, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasksTable } from "@workspace/db/schema";
import {
  CreateTaskBody,
  UpdateTaskBody,
  CompleteTaskBody,
  ListTasksQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

type TaskRow = typeof tasksTable.$inferSelect;

function getIdFromParams(params: Record<string, string | string[]>): number {
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  return parseInt(raw, 10);
}

async function getTaskById(id: number) {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  return task ?? null;
}

async function countDirectChildren(parentId: number) {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(tasksTable)
    .where(eq(tasksTable.parentTaskId, parentId));
  return Number(result[0]?.count ?? 0);
}

async function getDirectSubtasks(parentIds: number[]) {
  if (parentIds.length === 0) return new Map<number, TaskRow[]>();

  const subtasks = await db
    .select()
    .from(tasksTable)
    .where(inArray(tasksTable.parentTaskId, parentIds))
    .orderBy(tasksTable.sortOrder, tasksTable.createdAt);

  const grouped = new Map<number, TaskRow[]>();
  for (const subtask of subtasks) {
    const parentId = subtask.parentTaskId;
    if (parentId == null) continue;
    if (!grouped.has(parentId)) grouped.set(parentId, []);
    grouped.get(parentId)!.push(subtask);
  }

  return grouped;
}

async function recomputeParentCompletion(parentId: number) {
  const subtasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.parentTaskId, parentId));

  if (subtasks.length === 0) return;

  const allCompleted = subtasks.every((task) => task.completed);
  await db
    .update(tasksTable)
    .set({
      completed: allCompleted,
      completedAt: allCompleted ? new Date() : null,
    })
    .where(eq(tasksTable.id, parentId));
}

async function getSubtaskSummary(parentId: number) {
  const subtasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.parentTaskId, parentId));

  if (subtasks.length === 0) return null;

  const completed = subtasks.filter((task) => task.completed).length;
  return {
    total: subtasks.length,
    completed,
    progress: subtasks.length > 0 ? completed / subtasks.length : 0,
  };
}

async function validateParentAssignment(parentTaskId: number | null | undefined, taskId?: number) {
  if (parentTaskId == null) return null;

  if (taskId !== undefined && parentTaskId === taskId) {
    return "A task cannot be its own parent";
  }

  const parentTask = await getTaskById(parentTaskId);
  if (!parentTask) return "Parent task not found";
  if (parentTask.parentTaskId != null) return "Subtasks cannot have their own subtasks";

  return null;
}

async function validateNoGrandchildren(taskId: number, nextParentTaskId: number | null | undefined) {
  if (nextParentTaskId == null) return null;
  const childCount = await countDirectChildren(taskId);
  if (childCount > 0) return "A task with subtasks cannot become a subtask";
  return null;
}

async function serializeTask(task: TaskRow, subtasksMap?: Map<number, TaskRow[]>) {
  const subtasks = task.parentTaskId == null
    ? subtasksMap?.get(task.id) ?? []
    : [];
  const subtaskSummary =
    task.parentTaskId == null
      ? {
          total: subtasks.length,
          completed: subtasks.filter((item) => item.completed).length,
          progress:
            subtasks.length > 0
              ? subtasks.filter((item) => item.completed).length / subtasks.length
              : 0,
        }
      : null;

  return {
    id: task.id,
    title: task.title,
    assignee: task.assignee,
    dueDate: task.dueDate,
    recurring: task.recurring,
    notes: task.notes,
    category: task.category,
    parentTaskId: task.parentTaskId,
    sortOrder: task.sortOrder,
    completed: task.completed,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    ...(subtasks.length > 0
      ? {
          subtaskSummary,
          subtasks: subtasks.map((subtask) => ({
            id: subtask.id,
            title: subtask.title,
            assignee: subtask.assignee,
            dueDate: subtask.dueDate,
            recurring: subtask.recurring,
            notes: subtask.notes,
            category: subtask.category,
            parentTaskId: subtask.parentTaskId,
            sortOrder: subtask.sortOrder,
            completed: subtask.completed,
            completedAt: subtask.completedAt ? subtask.completedAt.toISOString() : null,
            createdAt: subtask.createdAt.toISOString(),
            updatedAt: subtask.updatedAt.toISOString(),
          })),
        }
      : {}),
  };
}

router.get("/tasks", async (req, res): Promise<void> => {
  const parsed = ListTasksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { assignee, view, completed } = parsed.data;
  const today = new Date().toISOString().split("T")[0];

  const conditions = [isNull(tasksTable.parentTaskId)];

  if (completed !== undefined) {
    conditions.push(eq(tasksTable.completed, completed));
  }

  if (view === "today") {
    conditions.push(
      and(
        eq(tasksTable.completed, false),
        or(eq(tasksTable.dueDate, today), isNull(tasksTable.dueDate)),
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
    .where(and(...conditions))
    .orderBy(tasksTable.dueDate, tasksTable.sortOrder, tasksTable.createdAt);

  const subtasksMap = await getDirectSubtasks(tasks.map((task) => task.id));
  res.json(await Promise.all(tasks.map((task) => serializeTask(task, subtasksMap))));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const parentValidation = await validateParentAssignment(parsed.data.parentTaskId);
  if (parentValidation) {
    res.status(400).json({ error: parentValidation });
    return;
  }

  let sortOrder = parsed.data.sortOrder ?? 0;
  if (parsed.data.parentTaskId != null && parsed.data.sortOrder === undefined) {
    const siblings = await db
      .select({ count: sql<number>`count(*)` })
      .from(tasksTable)
      .where(eq(tasksTable.parentTaskId, parsed.data.parentTaskId));
    sortOrder = Number(siblings[0]?.count ?? 0);
  }

  const [task] = await db
    .insert(tasksTable)
    .values({
      title: parsed.data.title,
      assignee: parsed.data.assignee ?? null,
      dueDate: parsed.data.dueDate ? parsed.data.dueDate.toISOString().slice(0, 10) : null,
      recurring: parsed.data.recurring ?? null,
      notes: parsed.data.notes ?? null,
      category: parsed.data.category ?? null,
      parentTaskId: parsed.data.parentTaskId ?? null,
      sortOrder,
    })
    .returning();

  if (task.parentTaskId != null) {
    await recomputeParentCompletion(task.parentTaskId);
  }

  res.status(201).json(await serializeTask(task));
});

router.get("/tasks/summary/today", async (_req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        isNull(tasksTable.parentTaskId),
        eq(tasksTable.completed, false),
        or(eq(tasksTable.dueDate, today), isNull(tasksTable.dueDate)),
      ),
    )
    .orderBy(tasksTable.sortOrder, tasksTable.createdAt);

  const subtasksMap = await getDirectSubtasks(tasks.map((task) => task.id));
  const serialized = await Promise.all(tasks.map((task) => serializeTask(task, subtasksMap)));

  const me = serialized.filter((task) => task.assignee === "me");
  const wife = serialized.filter((task) => task.assignee === "wife");
  const shared = serialized.filter((task) => task.assignee === "us");

  const completedToday = await db
    .select({ count: sql<number>`count(*)` })
    .from(tasksTable)
    .where(
      and(
        isNull(tasksTable.parentTaskId),
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
  const task = await getTaskById(id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const subtasksMap = task.parentTaskId == null ? await getDirectSubtasks([task.id]) : undefined;
  res.json(await serializeTask(task, subtasksMap));
});

router.put("/tasks/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const existing = await getTaskById(id);
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const nextParentTaskId =
    "parentTaskId" in parsed.data ? parsed.data.parentTaskId ?? null : existing.parentTaskId;

  const parentValidation = await validateParentAssignment(nextParentTaskId, id);
  if (parentValidation) {
    res.status(400).json({ error: parentValidation });
    return;
  }

  const noGrandchildrenValidation = await validateNoGrandchildren(id, nextParentTaskId);
  if (noGrandchildrenValidation) {
    res.status(400).json({ error: noGrandchildrenValidation });
    return;
  }

  const directChildren = await countDirectChildren(id);
  if (directChildren > 0 && parsed.data.completed !== undefined) {
    res.status(400).json({ error: "Parent task completion is derived from its subtasks" });
    return;
  }

  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.title !== undefined) updates.title = d.title;
  if ("assignee" in d) updates.assignee = d.assignee ?? null;
  if ("dueDate" in d) updates.dueDate = d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null;
  if ("recurring" in d) updates.recurring = d.recurring ?? null;
  if ("notes" in d) updates.notes = d.notes ?? null;
  if ("category" in d) updates.category = d.category ?? null;
  if ("parentTaskId" in d) updates.parentTaskId = d.parentTaskId ?? null;
  if (d.sortOrder !== undefined) updates.sortOrder = d.sortOrder;
  if (d.completed !== undefined) {
    updates.completed = d.completed;
    updates.completedAt = d.completed ? new Date() : null;
  }

  const [task] = await db
    .update(tasksTable)
    .set(updates)
    .where(eq(tasksTable.id, id))
    .returning();

  const affectedParentIds = new Set<number>();
  if (existing.parentTaskId != null) affectedParentIds.add(existing.parentTaskId);
  if (task.parentTaskId != null) affectedParentIds.add(task.parentTaskId);
  for (const parentId of affectedParentIds) {
    await recomputeParentCompletion(parentId);
  }

  const subtasksMap = task.parentTaskId == null ? await getDirectSubtasks([task.id]) : undefined;
  res.json(await serializeTask(task, subtasksMap));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const existing = await getTaskById(id);
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (existing.parentTaskId == null) {
    await db.delete(tasksTable).where(eq(tasksTable.parentTaskId, id));
  }

  const [task] = await db.delete(tasksTable).where(eq(tasksTable.id, id)).returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (existing.parentTaskId != null) {
    await recomputeParentCompletion(existing.parentTaskId);
  }

  res.sendStatus(204);
});

router.post("/tasks/:id/complete", async (req, res): Promise<void> => {
  const id = getIdFromParams(req.params);
  const existing = await getTaskById(id);
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const directChildren = await countDirectChildren(id);
  if (directChildren > 0) {
    res.status(400).json({ error: "Parent task completion is derived from its subtasks" });
    return;
  }

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

  if (task.parentTaskId != null) {
    await recomputeParentCompletion(task.parentTaskId);
  }

  res.json(await serializeTask(task));
});

export default router;
