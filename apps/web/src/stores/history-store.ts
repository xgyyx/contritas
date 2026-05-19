import { create } from "zustand";
import type { SessionStatus } from "@/types";
import { api } from "@/lib/api-client";

const STORAGE_KEY = "contritas_sessions";

export interface HistoryEntry {
  id: string;
  proposition: string;
  createdAt: string;
  status: SessionStatus;
  overallScore?: string;
  overallVerdict?: string;
}

interface HistoryState {
  sessions: HistoryEntry[];
  isLoading: boolean;
  error: string | null;
  statusFilter: "all" | SessionStatus;

  addSession: (id: string, proposition: string) => void;
  removeSession: (id: string) => void;
  refreshSessions: () => Promise<void>;
  setFilter: (filter: "all" | SessionStatus) => void;
  loadFromStorage: () => void;
}

function saveToStorage(sessions: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Storage full or unavailable
  }
}

function loadFromStorageRaw(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  sessions: [],
  isLoading: false,
  error: null,
  statusFilter: "all",

  loadFromStorage: () => {
    const sessions = loadFromStorageRaw();
    set({ sessions });
  },

  addSession: (id, proposition) => {
    const entry: HistoryEntry = {
      id,
      proposition,
      createdAt: new Date().toISOString(),
      status: "in_progress",
    };
    const sessions = [entry, ...get().sessions];
    set({ sessions });
    saveToStorage(sessions);
  },

  removeSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id);
    set({ sessions });
    saveToStorage(sessions);
  },

  refreshSessions: async () => {
    const { sessions } = get();
    if (sessions.length === 0) return;

    set({ isLoading: true, error: null });

    try {
      const results = await Promise.allSettled(
        sessions.map((s) => api.getSession(s.id))
      );

      const updated = sessions
        .map((session, i) => {
          const result = results[i];
          if (result.status === "fulfilled") {
            return {
              ...session,
              status: result.value.status,
            };
          }
          // Session no longer exists, keep as-is
          return session;
        })
        .filter((s) => {
          // Remove sessions that returned 404
          const result = results[sessions.indexOf(s)];
          return !(result.status === "rejected" && String(result.reason).includes("404"));
        });

      set({ sessions: updated, isLoading: false });
      saveToStorage(updated);
    } catch (e) {
      set({ error: "Failed to refresh sessions", isLoading: false });
    }
  },

  setFilter: (filter) => set({ statusFilter: filter }),
}));
