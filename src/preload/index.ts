import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  type AviaryApi,
  type AccountInput,
  type AppSettings,
  type ProxyInput,
  type ScheduleInput,
  type UpdateStatusPayload,
  type ProgressPayload
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
    remove: (id: string) => ipcRenderer.invoke(IpcChannels.accountsDelete, id)
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
    remove: (id: string) => ipcRenderer.invoke(IpcChannels.proxiesDelete, id)
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
    }
  },
  logs: {
    list: () => ipcRenderer.invoke(IpcChannels.logsList),
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
  }
}

contextBridge.exposeInMainWorld('aviary', api)
