import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type AviaryApi, type AccountInput } from '../shared/types'

const api: AviaryApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),
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
  }
}

contextBridge.exposeInMainWorld('aviary', api)
