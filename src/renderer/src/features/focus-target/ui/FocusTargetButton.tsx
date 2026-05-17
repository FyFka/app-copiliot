import { copilotApi } from '@/shared/api/copilot'
import { IconButton } from '@/shared/ui/icon-button/IconButton'

export function FocusTargetButton() {
  return (
    <IconButton
      title="Вернуть фокус в приложение"
      onClick={() => void copilotApi.focusTarget()}
    >
      ↩
    </IconButton>
  )
}
