import { randomUUID } from 'crypto'
import { app } from 'electron'
import { join } from 'path'
import { getDb } from './index'
import type { Account, AccountInput, AccountStatus } from '../../shared/types'

interface AccountRow {
  id: string
  label: string
  handle: string | null
  proxy: string | null
  profile_dir: string
  fingerprint: string | null
  status: string
  created_at: number
  updated_at: number
}

function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    label: r.label,
    handle: r.handle,
    proxy: r.proxy,
    profileDir: r.profile_dir,
    fingerprint: r.fingerprint,
    status: r.status as AccountStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listAccounts(): Account[] {
  const rows = getDb()
    .prepare('SELECT * FROM accounts ORDER BY created_at DESC')
    .all() as AccountRow[]
  return rows.map(toAccount)
}

export function getAccount(id: string): Account | null {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
    | AccountRow
    | undefined
  return row ? toAccount(row) : null
}

export function createAccount(input: AccountInput): Account {
  const id = randomUUID()
  const now = Date.now()
  const profileDir = join(app.getPath('userData'), 'profiles', id)
  getDb()
    .prepare(
      `INSERT INTO accounts (id, label, handle, proxy, profile_dir, fingerprint, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'new', ?, ?)`
    )
    .run(id, input.label, input.handle ?? null, input.proxy ?? null, profileDir, now, now)
  return getAccount(id)!
}

export function updateAccount(id: string, input: Partial<AccountInput>): Account {
  const existing = getAccount(id)
  if (!existing) throw new Error(`Account không tồn tại: ${id}`)
  const next = {
    label: input.label ?? existing.label,
    handle: input.handle !== undefined ? input.handle : existing.handle,
    proxy: input.proxy !== undefined ? input.proxy : existing.proxy
  }
  getDb()
    .prepare('UPDATE accounts SET label = ?, handle = ?, proxy = ?, updated_at = ? WHERE id = ?')
    .run(next.label, next.handle, next.proxy, Date.now(), id)
  return getAccount(id)!
}

export function setAccountStatus(id: string, status: AccountStatus): void {
  getDb()
    .prepare('UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id)
}

export function deleteAccount(id: string): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
