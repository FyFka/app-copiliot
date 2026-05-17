import { useEffect, useState } from 'react'
import { copilotApi } from '@/shared/api/copilot'
import { DEFAULT_PANEL_WIDTH } from '@/shared/config/constants'

export function useOverlayPanelWidth(): number {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)

  useEffect(() => copilotApi.onPanelWidth(setPanelWidth), [])

  return panelWidth
}
