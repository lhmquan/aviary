import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  type AviaryApi,
  type AccountInput,
  type AppSettings,
  type ProxyInput,
  type ScheduleInput,
  type UpdateStatusPayload,
  type ProgressPayload,
  type LogListParams
} from '../shared/types'

const api: AviaryApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),
  relaunch: () => ipcRenderer.invoke(IpcChannels.appRelaunch),
  pickFolder: () => ipcRenderer.invoke(IpcChannels.pickFolder),
  accounts: {
    list: () => ipcRenderer.invoke(IpcChannels.accountsList),
    create: (input: AccountInput) => ipcRenderer.invoke(IpcChannels.accountsCreate, input),
    update: (id: string, input: Partial<AccountInput>) =>
      ipcRenderer.invoke(IpcChannels.accountsUpdate, id, input),
    remove: (id: string) => ipcRenderer.invoke(IpcChannels.accountsDelete, id),
    lookup: (handle: string, accountId?: string) =>
      ipcRenderer.invoke(IpcChannels.accountsLookupX, handle, accountId)
  },
  proxies: {
    list: () => ipcRenderer.invoke(IpcChannels.proxiesList),
    bulkCreate: (
      lines: string[],
      opts: { labelPrefix?: string; kind?: string | null }
    ) => ipcRenderer.invoke(IpcChannels.proxiesBulkCreate, lines, opts),
    create: (input: ProxyInput) => ipcRenderer.invoke(IpcChannels.proxiesCreate, input),
    update: (id: string, input: Partial<ProxyInput>) =>
      ipcRenderer.invoke(IpcChannels.proxiesUpdate, id, input),
    remove: (id: string) => ipcRenderer.invoke(IpcChannels.proxiesDelete, id),
    clear: () => ipcRenderer.invoke(IpcChannels.proxiesClear),
    check: (ids: string[]) => ipcRenderer.invoke(IpcChannels.proxiesCheck, ids)
  },
  schedules: {
    list: () => ipcRenderer.invoke(IpcChannels.schedulesList),
    create: (input: ScheduleInput) => ipcRenderer.invoke(IpcChannels.schedulesCreate, input),
    update: (id: string, input: Partial<ScheduleInput>) =>
      ipcRenderer.invoke(IpcChannels.schedulesUpdate, id, input),
    remove: (id: string) => ipcRenderer.invoke(IpcChannels.schedulesDelete, id)
  },
  browser: {
    open: (accountId: string) => ipcRenderer.invoke(IpcChannels.browserOpen, accountId),
    close: (accountId: string) => ipcRenderer.invoke(IpcChannels.browserClose, accountId),
    status: (accountId: string) => ipcRenderer.invoke(IpcChannels.browserStatus, accountId),
    onStatusChanged: (cb) => {
      const listener = (_e: unknown, data: { accountId: string; open: boolean }): void =>
        cb(data.accountId, data.open)
      ipcRenderer.on(IpcChannels.browserStatusChanged, listener)
      return () => ipcRenderer.removeListener(IpcChannels.browserStatusChanged, listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    save: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IpcChannels.settingsSave, patch)
  },
  webhook: {
    test: (accountId?: string) => ipcRenderer.invoke(IpcChannels.webhookTest, accountId)
  },
  post: {
    runNow: (accountId: string) => ipcRenderer.invoke(IpcChannels.postRunNow, accountId),
    onProgress: (cb) => {
      const listener = (_e: unknown, p: ProgressPayload): void => cb(p)
      ipcRenderer.on(IpcChannels.taskProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.taskProgress, listener)
    },
    onQueueChanged: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(IpcChannels.queueChanged, listener)
      return () => ipcRenderer.removeListener(IpcChannels.queueChanged, listener)
    }
  },
  logs: {
    list: (params?: LogListParams) => ipcRenderer.invoke(IpcChannels.logsList, params),
    clear: () => ipcRenderer.invoke(IpcChannels.logsClear)
  },
  update: {
    check: () => ipcRenderer.invoke(IpcChannels.updateCheck),
    install: () => ipcRenderer.invoke(IpcChannels.updateInstall),
    onStatus: (cb: (status: UpdateStatusPayload) => void) => {
      const listener = (_e: unknown, status: UpdateStatusPayload): void => cb(status)
      ipcRenderer.on(IpcChannels.updateStatus, listener)
      return () => ipcRenderer.removeListener(IpcChannels.updateStatus, listener)
    }
  },
  autoStart: {
    get: () => ipcRenderer.invoke(IpcChannels.autoStartGet),
    set: (enabled: boolean) => ipcRenderer.invoke(IpcChannels.autoStartSet, enabled)
  },
  analytics: {
    fetchNow: () => ipcRenderer.invoke(IpcChannels.analyticsFetchNow),
    fetchOne: (accountId: string) => ipcRenderer.invoke(IpcChannels.analyticsFetchOne, accountId),
    list: (accountId?: string, days?: number) =>
      ipcRenderer.invoke(IpcChannels.analyticsList, accountId, days),
    remove: (accountId?: string) => ipcRenderer.invoke(IpcChannels.analyticsDelete, accountId),
    storageStats: () => ipcRenderer.invoke(IpcChannels.analyticsStorageStats)
  }
}

contextBridge.exposeInMainWorld('aviary', api)
