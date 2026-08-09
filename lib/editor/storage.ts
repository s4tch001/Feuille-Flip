import "client-only";

import { openDB } from "idb";

import type { EditorProject } from "@/lib/editor/project";
import { parseEditorProject } from "@/lib/editor/project";

const DATABASE_NAME = "feuille-flip-editor";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const LAST_PROJECT_KEY = "feuille:last-editor-project";
const PROJECT_INDEX_KEY = "feuille:editor-project-index";

type ProjectIndexItem = Pick<EditorProject, "id" | "title" | "updatedAt">;

function getDatabase() {
  return openDB(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
    },
  });
}

function readIndex(): ProjectIndexItem[] {
  try {
    const value = localStorage.getItem(PROJECT_INDEX_KEY);
    const parsed = value ? JSON.parse(value) as ProjectIndexItem[] : [];
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function updateIndex(project: EditorProject) {
  const next = [
    { id: project.id, title: project.title, updatedAt: project.updatedAt },
    ...readIndex().filter((item) => item.id !== project.id),
  ].slice(0, 20);
  localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(next));
  localStorage.setItem(LAST_PROJECT_KEY, project.id);
}

export async function saveEditorProject(project: EditorProject): Promise<void> {
  const validated = parseEditorProject(project);
  const database = await getDatabase();
  await database.put(PROJECT_STORE, validated);
  updateIndex(validated);
}

export async function loadEditorProject(projectId: string): Promise<EditorProject | null> {
  const database = await getDatabase();
  const value = await database.get(PROJECT_STORE, projectId) as unknown;
  if (!value) return null;
  try {
    return parseEditorProject(value);
  } catch {
    return null;
  }
}

export async function loadLastEditorProject(): Promise<EditorProject | null> {
  const projectId = localStorage.getItem(LAST_PROJECT_KEY);
  return projectId ? loadEditorProject(projectId) : null;
}

export async function deleteEditorProject(projectId: string): Promise<void> {
  const database = await getDatabase();
  await database.delete(PROJECT_STORE, projectId);
  const next = readIndex().filter((item) => item.id !== projectId);
  localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(next));
  if (localStorage.getItem(LAST_PROJECT_KEY) === projectId) localStorage.removeItem(LAST_PROJECT_KEY);
}

export async function requestPersistentEditorStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
