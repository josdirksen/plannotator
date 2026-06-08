import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import type { SessionBootstrap } from "../daemon/contracts";

// expandedProjects is a Set drafted inside immer producers; immer 10 requires
// this plugin to be loaded before any Set/Map is mutated in a recipe.
enableMapSet();

export interface VisitedSession {
  sessionId: string;
  bootstrap: SessionBootstrap;
}

export interface AppState {
  addProjectOpen: boolean;
  settingsOpen: boolean;
  activeSessionId: string | null;
  visitedSessions: Record<string, VisitedSession>;
  /** cwds of projects the user has explicitly toggled open in the sidebar. */
  expandedProjects: Set<string>;
  /**
   * Explicit per-worktree open/closed choices, keyed by cwd. Absent = follow the
   * computed default (open when the worktree has a real session or contains the
   * active session). Present = the user deliberately set this state, which wins
   * over the default and survives the default later changing.
   */
  worktreeOpen: Record<string, boolean>;
}

export interface AppActions {
  setAddProjectOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  activateSession(sessionId: string, bootstrap: SessionBootstrap): void;
  deactivateSession(): void;
  removeSession(sessionId: string): void;
  toggleProjectExpand(cwd: string): void;
  setProjectExpanded(cwd: string, open: boolean): void;
  setWorktreeOpen(cwd: string, open: boolean): void;
}

export type AppStore = AppState & AppActions;

const initialState: AppState = {
  addProjectOpen: false,
  settingsOpen: false,
  activeSessionId: null,
  visitedSessions: {},
  expandedProjects: new Set<string>(),
  worktreeOpen: {},
};

export function createAppStore(initial: Partial<AppState> = {}) {
  return createStore<AppStore>()(
    immer((set) => ({
      ...initialState,
      // Fresh Set per store so instances don't share expansion state.
      expandedProjects: new Set<string>(initialState.expandedProjects),
      worktreeOpen: { ...initialState.worktreeOpen },
      ...initial,
      setAddProjectOpen(open) {
        set((state) => {
          state.addProjectOpen = open;
        });
      },
      setSettingsOpen(open) {
        set((state) => {
          state.settingsOpen = open;
        });
      },
      activateSession(sessionId, bootstrap) {
        set((state) => {
          state.activeSessionId = sessionId;
          if (!state.visitedSessions[sessionId]) {
            state.visitedSessions[sessionId] = { sessionId, bootstrap };
          }
        });
      },
      deactivateSession() {
        set((state) => {
          state.activeSessionId = null;
        });
      },
      removeSession(sessionId) {
        set((state) => {
          delete state.visitedSessions[sessionId];
          if (state.activeSessionId === sessionId) {
            state.activeSessionId = null;
          }
        });
      },
      toggleProjectExpand(cwd) {
        set((state) => {
          if (state.expandedProjects.has(cwd)) {
            state.expandedProjects.delete(cwd);
          } else {
            state.expandedProjects.add(cwd);
          }
        });
      },
      setProjectExpanded(cwd, open) {
        set((state) => {
          if (open) {
            state.expandedProjects.add(cwd);
          } else {
            state.expandedProjects.delete(cwd);
          }
        });
      },
      setWorktreeOpen(cwd, open) {
        set((state) => {
          state.worktreeOpen[cwd] = open;
        });
      },
    })),
  );
}

export const appStore = createAppStore();

export function useAppStore<T>(selector: (state: AppStore) => T): T {
  return useStore(appStore, selector);
}
