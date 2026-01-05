#ifndef ADDON_SRC_OVERLAY_WINDOW_H_
#define ADDON_SRC_OVERLAY_WINDOW_H_

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>
#include <uv.h>

/**
 * Event types emitted by the overlay window system.
 *
 * Lifecycle:
 *   OW_ATTACH -> OW_FOCUS <-> OW_BLUR -> OW_DETACH
 *
 * Additional events (may occur between FOCUS/BLUR):
 *   OW_FULLSCREEN  – only on X11 and macOS backends
 *   OW_MOVERESIZE  – all platforms
 */
enum ow_event_type {
  OW_ATTACH      = 1, /**< Target window was found / re-found              */
  OW_FOCUS       = 2, /**< Target window became the active (foreground) window */
  OW_BLUR        = 3, /**< Target window lost focus                        */
  OW_DETACH      = 4, /**< Target window was destroyed                     */
  OW_FULLSCREEN  = 5, /**< Fullscreen state changed (X11 & macOS only)     */
  OW_MOVERESIZE  = 6, /**< Target window moved or resized                  */
};

/** Screen-space rectangle of a window's client area, in logical pixels. */
struct ow_window_bounds {
  int32_t  x;
  int32_t  y;
  uint32_t width;
  uint32_t height;
};

/**
 * Payload for OW_ATTACH.
 *
 * Platform notes:
 *   - has_access:   Windows only; -1 = not applicable.
 *   - is_fullscreen: Linux only;  -1 = not applicable / unchanged.
 */
struct ow_event_attach {
  int has_access;
  int is_fullscreen;
  struct ow_window_bounds bounds;
};

/** Payload for OW_FULLSCREEN. */
struct ow_event_fullscreen {
  bool is_fullscreen;
};

/** Payload for OW_MOVERESIZE. */
struct ow_event_moveresize {
  struct ow_window_bounds bounds;
};

/** Tagged union representing any event emitted by the overlay hook. */
struct ow_event {
  enum ow_event_type type;
  union {
    struct ow_event_attach    attach;
    struct ow_event_fullscreen fullscreen;
    struct ow_event_moveresize moveresize;
  } data;
};

/* ── Thread handle shared by all platform backends ──────────────────────── */
extern uv_thread_t hook_tid;

/**
 * Start the platform-specific hook thread.
 *
 * @param target_window_title  Null-terminated UTF-8 title of the window to
 *                             track.  The caller must keep this string alive
 *                             for the lifetime of the hook.
 * @param overlay_window_id    Platform-native window handle of the overlay
 *                             window, or NULL.  Format documented at
 *                             https://www.electronjs.org/docs/api/browser-window#wingetnativewindowhandle
 */
void ow_start_hook(char *target_window_title, void *overlay_window_id);

/** Bring the overlay window to the foreground. */
void ow_activate_overlay(void);

/** Return focus to the target window. */
void ow_focus_target(void);

/**
 * Emit an event to the JavaScript layer.
 * Implemented in addon.c; called by platform backends.
 *
 * The event struct is copied internally – the caller may free or reuse it
 * immediately after this call returns.
 */
void ow_emit_event(struct ow_event *event);

/**
 * Capture a screenshot of the target window's client area into @p out.
 * @p out must be at least width * height * 4 bytes (BGRA on Windows).
 * Currently only implemented on Windows.
 */
void ow_screenshot(uint8_t *out, uint32_t width, uint32_t height);

#ifdef __cplusplus
}
#endif

#endif /* ADDON_SRC_OVERLAY_WINDOW_H_ */
