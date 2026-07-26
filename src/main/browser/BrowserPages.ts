import type { BrowserContext, Page } from 'patchright'

export function openTaskPage(context: BrowserContext): Promise<Page> {
  return context.newPage()
}
