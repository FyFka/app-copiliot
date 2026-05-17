import { useOverlayClickThrough } from '@/features/overlay-click-through'
import { useOverlayPanelWidth } from '@/features/overlay-panel-width'
import { CopilotPanel } from '@/widgets/copilot-panel'
import './OverlayPage.css'

export function OverlayPage() {
  const panelWidth = useOverlayPanelWidth()
  const { handlePointerMove, handlePointerLeave } = useOverlayClickThrough(panelWidth)

  return (
    <div
      className="overlay-page"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <CopilotPanel width={panelWidth} />
    </div>
  )
}
