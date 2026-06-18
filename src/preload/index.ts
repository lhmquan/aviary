import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type AviaryApi, type AccountInput, type AppSettings } from '../shared/types'

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
  browser: {
    open: (accountId: string) => ipcRenderer.invoke(IpcChannels.browserOpen, accountId),
    close: (accountId: string) => ipcRenderer.invoke(IpcChannels.browserClose, accountId),
    status: (accountId: string) => ipcRenderer.invoke(IpcChannels.browserStatus, accountId)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    save: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IpcChannels.settingsSave, patch)
  },
  webhook: {
    test: (accountId?: string) => ipcRenderer.invoke(IpcChannels.webhookTest, accountId)
  },
  post: {
    runNow: (accountId: string) => ipcRenderer.invoke(IpcChannels.postRunNow, accountId)
  }
}

contextBridge.exposeInMainWorld('aviary', api)
