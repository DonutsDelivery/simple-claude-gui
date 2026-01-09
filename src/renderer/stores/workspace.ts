import { create } from 'zustand'

export interface Project {
  path: string
  name: string
  executable?: string
  apiPort?: number
  apiSessionMode?: 'existing' | 'new-keep' | 'new-close'
  apiModel?: 'default' | 'opus' | 'sonnet' | 'haiku'
  autoAcceptTools?: string[]
  permissionMode?: string
  color?: string
  ttsVoice?: string           // Per-project TTS voice (overrides global)
  ttsEngine?: 'piper' | 'xtts'  // Per-project TTS engine
  backend?: 'default' | 'claude' | 'gemini' | 'codex' | 'opencode'
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
  ptyId: string
  backend?: string
}

interface WorkspaceState {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null

  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (path: string) => void
  updateProject: (path: string, updates: Partial<Project>) => void

  addTab: (tab: OpenTab) => void
  removeTab: (id: string) => void
  updateTab: (id: string, updates: Partial<OpenTab>) => void
  setActiveTab: (id: string) => void
  clearTabs: () => void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  openTabs: [],
  activeTabId: null,

  setProjects: (projects) => set({ projects }),

  addProject: (project) => {
    const { projects } = get()
    if (!projects.find((p) => p.path === project.path)) {
      set({ projects: [...projects, project] })
    }
  },

  removeProject: (path) => {
    const { projects } = get()
    set({ projects: projects.filter((p) => p.path !== path) })
  },

  updateProject: (path, updates) => {
    const { projects } = get()
    set({
      projects: projects.map((p) =>
        p.path === path ? { ...p, ...updates } : p
      )
    })
  },

  addTab: (tab) => {
    const { openTabs } = get()
    set({
      openTabs: [...openTabs, tab],
      activeTabId: tab.id
    })
  },

  removeTab: (id) => {
    const { openTabs, activeTabId } = get()
    const newTabs = openTabs.filter((t) => t.id !== id)
    let newActiveId = activeTabId

    if (activeTabId === id) {
      const index = openTabs.findIndex((t) => t.id === id)
      if (newTabs.length > 0) {
        newActiveId = newTabs[Math.min(index, newTabs.length - 1)].id
      } else {
        newActiveId = null
      }
    }

    set({ openTabs: newTabs, activeTabId: newActiveId })
  },

  updateTab: (id, updates) => {
    const { openTabs } = get()
    set({
      openTabs: openTabs.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      )
    })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  clearTabs: () => set({ openTabs: [], activeTabId: null })
}))
