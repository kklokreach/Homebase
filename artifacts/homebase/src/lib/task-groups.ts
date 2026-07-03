import type { Task } from "@workspace/api-client-react";

export type GroupableTask = Task & {
  parentTaskId?: number | null;
  sortOrder?: number;
  category?: string | null;
  listType?: "short" | "long" | "weekly";
  subtasks?: GroupableTask[];
};

export type TaskGroup = {
  key: string;
  label: string;
  tasks: GroupableTask[];
};

export function taskGroupLabel(category?: string | null) {
  return category?.trim() || "Ungrouped";
}

export function taskGroupKey(label: string) {
  return label.trim().toLocaleLowerCase();
}

export function getTaskGroups(tasks: readonly GroupableTask[] = []): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();

  for (const task of tasks) {
    const label = taskGroupLabel(task.category);
    const key = taskGroupKey(label);

    if (!groups.has(key)) {
      groups.set(key, { key, label, tasks: [] });
    }

    groups.get(key)!.tasks.push(task);
  }

  return Array.from(groups.values());
}

export function showTaskGroupHeaders(groups: readonly TaskGroup[]) {
  return groups.length > 1 || groups.some((group) => group.label !== "Ungrouped");
}

export function orderedTaskIdsFromGroups(groups: readonly TaskGroup[]) {
  return groups.flatMap((group) => group.tasks.map((task) => task.id));
}

export function getTaskGroupOptions(tasks: readonly GroupableTask[] = []) {
  const groups = new Map<string, string>();

  function visit(task: GroupableTask) {
    const label = task.category?.trim();
    if (label) {
      const key = taskGroupKey(label);
      if (!groups.has(key)) groups.set(key, label);
    }

    for (const subtask of task.subtasks ?? []) {
      visit(subtask);
    }
  }

  for (const task of tasks) {
    visit(task);
  }

  return Array.from(groups.values()).sort((a, b) => a.localeCompare(b));
}
