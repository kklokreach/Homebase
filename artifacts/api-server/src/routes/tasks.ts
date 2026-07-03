import { Router, type IRouter } from "express";
import { and, eq, gte, isNull, inArray, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasksTable } from "@workspace/db/schema";
import { parsePositiveIntParam, sendInvalidId } from "../lib/http";
import { refreshTaskAutomation } from "../lib/task-rollover";
import {
  CreateTaskBody,
  UpdateTaskBody,
  CompleteTaskBody,
  ListTasksQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();
const COMPLETED_TASK_VISIBILITY_DAYS = 3;
const TASK_LIST_TYPES = new Set(["short", "long", "weekly"]);

type TaskRow = typeof tasksTable.$inferSelect;
type TaskListType = "short" | "long" | "weekly";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function completedTaskVisibilityCutoff() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - COMPLETED_TASK_VISIBILITY_DAYS);
  return cutoff;
}

function normalizeTaskListType(value: unknown): TaskListType {
  return typeof value === "string" && TASK_LIST_TYPES.has(value)
    ? value as TaskListType
    : "short";
}

function defaultTaskVisibilityCondition() {
  return (
    or(
      eq(tasksTable.completed, false),
      gte(tasksTable.completedAt, completedTaskVisibilityCutoff()),
    ) ?? sql`true`
  );
}

function parseTaskReorderBody(body: unknown) {
  if (!isPlainObject(body) || !Array.isArray(body["orderedIds"])) return null;

  const orderedIds = body["orderedIds"];
  if (
    orderedIds.length === 0 ||
    !orderedIds.every((id) => Number.isInteger(id) && id > 0) ||
    new Set(orderedIds).size !== orderedIds.length
  ) {
    return null;
  }

  const rawParentTaskId = body["parentTaskId"];
  const parentTaskId =
    rawParentTaskId === undefined || rawParentTaskId === null
      ? null
      : Number(rawParentTaskId);

  if (parentTaskId !== null && (!Number.isInteger(parentTaskId) || parentTaskId <= 0)) {
    return null;
  }

  return { orderedIds: orderedIds as number[], parentTaskId };
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
    listType: normalizeTaskListType(task.listType),
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
            listType: normalizeTaskListType(subtask.listType),
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

  const { assignee, view, completed, listType } = parsed.data;
  const { today } = await refreshTaskAutomation();

  const conditions = [isNull(tasksTable.parentTaskId)];

  if (completed !== undefined) {
    conditions.push(eq(tasksTable.completed, completed));
  } else {
    conditions.push(defaultTaskVisibilityCondition());
  }

  if (view === "today") {
    conditions.push(eq(tasksTable.listType, "short"));
    conditions.push(
      and(
        eq(tasksTable.completed, false),
        or(eq(tasksTable.dueDate, today), isNull(tasksTable.dueDate)),
      ) ?? sql`true`,
    );
  } else if (view === "upcoming") {
    conditions.push(eq(tasksTable.listType, "short"));
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

  if (listType) {
    conditions.push(eq(tasksTable.listType, listType));
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(and(...conditions))
    .orderBy(tasksTable.sortOrder, tasksTable.dueDate, tasksTable.createdAt);

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
  if (parsed.data.sortOrder === undefined) {
    const siblings = await db
      .select({ count: sql<number>`count(*)` })
      .from(tasksTable)
      .where(
        parsed.data.parentTaskId != null
          ? eq(tasksTable.parentTaskId, parsed.data.parentTaskId)
          : isNull(tasksTable.parentTaskId),
      );
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
      listType: normalizeTaskListType(parsed.data.listType),
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
  const { today } = await refreshTaskAutomation();

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        isNull(tasksTable.parentTaskId),
        eq(tasksTable.listType, "short"),
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

router.put("/tasks/reorder", async (req, res): Promise<void> => {
  const parsed = parseTaskReorderBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: "orderedIds must be a non-empty array of unique task ids" });
    return;
  }

  const tasks = await db
    .select({ id: tasksTable.id, parentTaskId: tasksTable.parentTaskId })
    .from(tasksTable)
    .where(inArray(tasksTable.id, parsed.orderedIds));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  if (parsed.orderedIds.some((id) => !tasksById.has(id))) {
    res.status(404).json({ error: "One or more tasks were not found" });
    return;
  }

  if (
    parsed.orderedIds.some(
      (id) => (tasksById.get(id)?.parentTaskId ?? null) !== parsed.parentTaskId,
    )
  ) {
    res.status(400).json({ error: "Tasks can only be reordered among siblings" });
    return;
  }

  await Promise.all(
    parsed.orderedIds.map((id, index) =>
      db.update(tasksTable).set({ sortOrder: index }).where(eq(tasksTable.id, id)),
    ),
  );

  res.sendStatus(204);
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const id = parsePositiveIntParam(req.params, "id");
  if (id === null) {
    sendInvalidId(res, "task id");
    return;
  }
  const task = await getTaskById(id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const subtasksMap = task.parentTaskId == null ? await getDirectSubtasks([task.id]) : undefined;
  res.json(await serializeTask(task, subtasksMap));
});

router.put("/tasks/:id", async (req, res): Promise<void> => {
  const id = parsePositiveIntParam(req.params, "id");
  if (id === null) {
    sendInvalidId(res, "task id");
    return;
  }
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
  const parentChanged =
    "parentTaskId" in d && (d.parentTaskId ?? null) !== (existing.parentTaskId ?? null);
  if (d.title !== undefined) updates.title = d.title;
  if ("assignee" in d) updates.assignee = d.assignee ?? null;
  if ("dueDate" in d) updates.dueDate = d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null;
  if ("recurring" in d) updates.recurring = d.recurring ?? null;
  if ("notes" in d) updates.notes = d.notes ?? null;
  if ("category" in d) updates.category = d.category ?? null;
  if ("listType" in d) updates.listType = normalizeTaskListType(d.listType);
  if ("parentTaskId" in d) updates.parentTaskId = d.parentTaskId ?? null;
  if (d.sortOrder !== undefined) updates.sortOrder = d.sortOrder;
  if (parentChanged && d.sortOrder === undefined) {
    const siblings = await db
      .select({ count: sql<number>`count(*)` })
      .from(tasksTable)
      .where(nextParentTaskId != null ? eq(tasksTable.parentTaskId, nextParentTaskId) : isNull(tasksTable.parentTaskId));
    updates.sortOrder = Number(siblings[0]?.count ?? 0);
  }
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
  const id = parsePositiveIntParam(req.params, "id");
  if (id === null) {
    sendInvalidId(res, "task id");
    return;
  }
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
  const id = parsePositiveIntParam(req.params, "id");
  if (id === null) {
    sendInvalidId(res, "task id");
    return;
  }
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
