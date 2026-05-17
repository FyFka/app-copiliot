import { useCallback } from 'react'
import { copilotApi } from '@/shared/api/copilot'

export function useOverlayClickThrough(panelWidth: number) {
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const inPanel = event.clientX >= window.innerWidth - panelWidth
      void copilotApi.setClickThrough(!inPanel)
    },
    [panelWidth],
  )

  const handlePointerLeave = useCallback(() => {
    void copilotApi.setClickThrough(true)
  }, [])

  return { handlePointerMove, handlePointerLeave }
}
