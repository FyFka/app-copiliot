import type { CopilotApi } from '@/shared/api/copilot'

declare global {
  interface Window {
    copilot?: CopilotApi
  }
}

export {}
