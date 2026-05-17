import { ChatPanel } from '@/features/chat'
import { FocusTargetButton } from '@/features/focus-target'
import './CopilotPanel.css'

interface CopilotPanelProps {
  width: number
}

export function CopilotPanel({ width }: CopilotPanelProps) {
  return (
    <aside className="copilot-panel" style={{ width }}>
      <header className="copilot-panel__header">
        <div className="copilot-panel__brand">
          <span className="copilot-panel__logo" aria-hidden="true" />
          <div>
            <h1>Copilot</h1>
            <p>Ctrl+B — скрыть панель</p>
          </div>
        </div>
        <FocusTargetButton />
      </header>
      <ChatPanel />
    </aside>
  )
}
