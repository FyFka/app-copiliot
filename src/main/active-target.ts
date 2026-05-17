import { screen, type BrowserWindow } from "electron";
import activeWindow from "active-win";

export interface TrackedWindow {
  id: number;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export async function getActiveTarget(
  electronPid: number,
): Promise<TrackedWindow | null> {
  const win = await activeWindow({
    accessibilityPermission: false,
    screenRecordingPermission: false,
  });

  if (!win?.title?.trim()) return null;
  if (win.owner.processId === electronPid) return null;
  if (win.bounds.width < 50 || win.bounds.height < 50) return null;

  return {
    id: win.id,
    title: win.title.trim(),
    bounds: win.bounds,
  };
}

export function applyBoundsToOverlay(
  overlay: BrowserWindow,
  bounds: TrackedWindow["bounds"],
): void {
  const physical = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };

  const dip = screen.screenToDipRect(overlay, physical);
  if (dip.width < 80 || dip.height < 80) return;

  overlay.setBounds(dip);
}
