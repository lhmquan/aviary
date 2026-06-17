import type { AviaryApi } from '../shared/types'

declare global {
  interface Window {
    aviary: AviaryApi
  }
}

export {}
