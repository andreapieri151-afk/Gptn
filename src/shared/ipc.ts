/**
 * IPC channel names shared by main, preload and renderer.
 * Keeping them in one place avoids string drift between processes.
 */
export const IPC = {
  app: {
    info: 'app:info',
    openExternal: 'app:open-external',
    navigate: 'app:navigate'
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
    changed: 'settings:changed'
  },
  secrets: {
    status: 'secrets:status',
    setApiKey: 'secrets:set-api-key',
    clearApiKey: 'secrets:clear-api-key',
    test: 'secrets:test'
  },
  models: {
    list: 'models:list'
  },
  conversations: {
    list: 'conversations:list',
    get: 'conversations:get',
    create: 'conversations:create',
    rename: 'conversations:rename',
    remove: 'conversations:remove',
    removeAll: 'conversations:remove-all',
    search: 'conversations:search',
    changed: 'conversations:changed'
  },
  chat: {
    start: 'chat:start',
    delta: 'chat:delta',
    done: 'chat:done',
    error: 'chat:error',
    stop: 'chat:stop'
  },
  data: {
    export: 'data:export',
    import: 'data:import',
    revealFolder: 'data:reveal-folder',
    stats: 'data:stats'
  }
} as const

/** Renderer -> main requests that need a menu/toolbar trigger. */
export const UI_COMMAND = {
  newChat: 'ui:new-chat',
  search: 'ui:search',
  settings: 'ui:settings',
  toggleSidebar: 'ui:toggle-sidebar',
  focusComposer: 'ui:focus-composer',
  exportActive: 'ui:export-active',
  copyLastAnswer: 'ui:copy-last-answer'
} as const

export type UiCommand = (typeof UI_COMMAND)[keyof typeof UI_COMMAND]
