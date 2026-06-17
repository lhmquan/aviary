import { ipcMain } from 'electron'
import { IpcChannels, type AccountInput } from '../shared/types'
import {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getAccount,
  setAccountStatus
} from './db/accounts'
import { browserManager } from './browser/BrowserManager'

export function registerIpc(): void {
  ipcMain.handle(IpcChannels.accountsList, () => listAccounts())

  ipcMain.handle(IpcChannels.accountsCreate, (_e, input: AccountInput) => createAccount(input))

  ipcMain.handle(IpcChannels.accountsUpdate, (_e, id: string, input: Partial<AccountInput>) =>
    updateAccount(id, input)
  )

  ipcMain.handle(IpcChannels.accountsDelete, async (_e, id: string) => {
    await browserManager.closeProfile(id)
    deleteAccount(id)
  })

  ipcMain.handle(IpcChannels.browserOpen, async (_e, accountId: string) => {
    const account = getAccount(accountId)
    if (!account) throw new Error(`Account không tồn tại: ${accountId}`)
    await browserManager.openProfile(account)
    setAccountStatus(accountId, 'logged_in')
  })

  ipcMain.handle(IpcChannels.browserClose, async (_e, accountId: string) => {
    await browserManager.closeProfile(accountId)
  })

  ipcMain.handle(IpcChannels.browserStatus, (_e, accountId: string) => ({
    open: browserManager.isOpen(accountId)
  }))
}
