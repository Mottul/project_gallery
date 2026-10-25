import type { GalerieApi } from '@shared/ipc-contracts'

declare global {
  interface Window {
    api: GalerieApi
  }
}

export {}
