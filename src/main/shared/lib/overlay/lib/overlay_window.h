#ifndef ADDON_SRC_OVERLAY_WINDOW_H_
#define ADDON_SRC_OVERLAY_WINDOW_H_

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>
#include <uv.h>

enum ow_event_type {
  // target window is found
  OW_ATTACH = 1,
  // target window is active/foreground
  OW_FOCUS,
  // target window lost focus
  OW_BLUR,
  // target window is destroyed
  OW_DETACH,
  // target window fullscreen changed
  // only emitted on X11 and Mac backend
  OW_FULLSCREEN,
  // target window changed position or resized
  OW_MOVERESIZE,
};

struct ow_window_bounds {
  int32_t x;
  int32_t y;
  uint32_t width;
  uint32_t height;
};

struct ow_event_attach {
  // defined only on Windows; -1 = undefined
  int has_access;
  // defined only on Linux/Mac, only if changed; -1 = undefined
  int is_fullscreen;
  struct ow_window_bounds bounds;
};

struct ow_event_fullscreen {
  bool is_fullscreen;
};

struct ow_event_moveresize {
  struct ow_window_bounds bounds;
};

struct ow_event {
  enum ow_event_type type;
  union {
    struct ow_event_attach attach;
    struct ow_event_fullscreen fullscreen;
    struct ow_event_moveresize moveresize;
  } data;
};

extern uv_thread_t hook_tid;

// Passed the title and a pointer to the platform-specific window ID.
// Window ID format depends on platform, see
// https://www.electronjs.org/docs/api/browser-window#wingetnativewindowhandle
void ow_start_hook(char* target_window_title, void* overlay_window_id);

void ow_activate_overlay(void);

void ow_focus_target(void);

void ow_emit_event(struct ow_event* event);

// Only implemented on Windows; other platforms return immediately.
void ow_screenshot(uint8_t* out, uint32_t width, uint32_t height);

#ifdef __cplusplus
}
#endif

#endif // ADDON_SRC_OVERLAY_WINDOW_H_
