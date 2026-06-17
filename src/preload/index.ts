import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type AviaryApi } from '../shared/types'

const api: AviaryApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo)
}

contextBridge.exposeInMainWorld('aviary', api)
