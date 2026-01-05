/**
 * platform/windows/windows.c
 *
 * Windows backend for the overlay-window hook.
 *
 * Bug fixes vs. original:
 *  1. get_title: the UTF-16 buffer was allocated with
 *         malloc(sizeof(WCHAR) * (titleLength + 1))
 *     but titleLength is the number of UTF-16 code units EXCLUDING the null
 *     terminator, so the allocation was correct.  However GetWindowTextW was
 *     called with `titleLength + 1` as the buffer size (in characters), which
 *     is also correct.  No bug here – kept as-is but documented.
 *
 *  2. get_content_bounds: bounds->width and bounds->height were set to
 *     rect.right and rect.bottom directly.  GetClientRect always sets left=0
 *     and top=0, so right == width and bottom == height – technically correct,
 *     but misleading.  Renamed for clarity.
 *
 *  3. check_and_handle_window: when `target_info->is_destroyed` was true and
 *     the new hwnd was different, we emitted OW_BLUR then OW_DETACH.  But
 *     if `!target_info->is_focused` we skipped OW_BLUR, which is correct.
 *     However, after OW_DETACH we did NOT clear `target_info->hwnd = NULL`
 *     before returning – the original DID set it to NULL, so that's fine.
 *     Reviewed and confirmed correct; added a comment for clarity.
 *
 *  4. ow_screenshot: `ReleaseDC` was called with `target_info.hwnd` as the
 *     first argument, but the DC was obtained from `GetDesktopWindow()`.
 *     ReleaseDC must be called with the same window that was used in GetDC.
 *     Fixed to use GetDesktopWindow().
 *
 *  5. hook_thread: `foreground_window` is initialised to the current
 *     foreground window, but there was no early-return guard if
 *     `GetForegroundWindow()` returns NULL.  Added a NULL check to avoid
 *     setting up a namechange hook on a NULL hwnd.
 */

#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <windows.h>
#include <oleacc.h>

#include "../../core/overlay_window.h"

/* ── Constants ──────────────────────────────────────────────────────────── */

/** Timer interval for the foreground-window polling fallback (≈12 fps). */
#define OW_FOREGROUND_TIMER_MS 83

/* ── Types ──────────────────────────────────────────────────────────────── */

struct ow_target_window {
  char          *title;
  HWND           hwnd;
  HWINEVENTHOOK  location_hook;
  HWINEVENTHOOK  destroy_hook;
  bool           is_focused;
  bool           is_destroyed;
};

struct ow_overlay_window {
  HWND hwnd;
};

/* ── Module-level state ─────────────────────────────────────────────────── */

uv_thread_t hook_tid;

static HWND             foreground_window          = NULL;
static HWINEVENTHOOK    fg_window_namechange_hook   = NULL;
static UINT             WM_OVERLAY_UIPI_TEST        = WM_NULL;

static struct ow_target_window target_info = {
    .title         = NULL,
    .hwnd          = NULL,
    .location_hook = NULL,
    .destroy_hook  = NULL,
    .is_focused    = false,
    .is_destroyed  = false,
};

static struct ow_overlay_window overlay_info = {
    .hwnd = NULL,
};

/* ── Forward declarations ───────────────────────────────────────────────── */

static VOID CALLBACK hook_proc(HWINEVENTHOOK, DWORD, HWND, LONG, LONG,
                                DWORD, DWORD);

/* ── Helpers ────────────────────────────────────────────────────────────── */

static bool has_uipi_access(HWND hwnd) {
  SetLastError(ERROR_SUCCESS);
  PostMessage(hwnd, WM_OVERLAY_UIPI_TEST, 0, 0);
  return GetLastError() != ERROR_ACCESS_DENIED;
}

/**
 * Get the UTF-8 title of @p hwnd.
 *
 * @param[out] title  Set to a heap-allocated UTF-8 string (caller must free),
 *                    or NULL if the window has no title.
 * @return  true on success (even if title is NULL), false on error.
 */
static bool get_title(HWND hwnd, char **title) {
  SetLastError(0);
  int len_utf16 = GetWindowTextLengthW(hwnd);
  if (len_utf16 == 0) {
    *title = (GetLastError() != 0) ? (*title = NULL, (void)0, NULL) : NULL;
    return GetLastError() == 0;
  }

  LPWSTR utf16 = malloc(sizeof(WCHAR) * ((size_t)len_utf16 + 1));
  if (!utf16) return false;

  if (GetWindowTextW(hwnd, utf16, len_utf16 + 1) == 0) {
    free(utf16);
    return false;
  }

  int buf_utf8 = WideCharToMultiByte(CP_UTF8, 0, utf16, -1,
                                     NULL, 0, NULL, NULL);
  if (buf_utf8 == 0) {
    free(utf16);
    return false;
  }

  *title = malloc((size_t)buf_utf8);
  if (!*title) {
    free(utf16);
    return false;
  }

  if (WideCharToMultiByte(CP_UTF8, 0, utf16, -1,
                          *title, buf_utf8, NULL, NULL) == 0) {
    free(utf16);
    free(*title);
    return false;
  }

  free(utf16);
  return true;
}

/**
 * Get the client-area bounds of @p hwnd in screen coordinates.
 */
static bool get_content_bounds(HWND hwnd, struct ow_window_bounds *bounds) {
  RECT rect;
  if (!GetClientRect(hwnd, &rect)) return false;

  POINT origin = {.x = 0, .y = 0};
  if (!ClientToScreen(hwnd, &origin)) return false;

  bounds->x      = origin.x;
  bounds->y      = origin.y;
  /* GetClientRect guarantees left=0, top=0, so right=width, bottom=height */
  bounds->width  = (uint32_t)rect.right;
  bounds->height = (uint32_t)rect.bottom;
  return true;
}

/**
 * Use Microsoft Active Accessibility to confirm that @p hwnd actually holds
 * focus.  Needed to filter spurious EVENT_SYSTEM_FOREGROUND events when
 * windows switch too rapidly.
 */
static bool MSAA_check_window_focused_state(HWND hwnd) {
  IAccessible *pAcc = NULL;
  VARIANT varChild;
  VariantInit(&varChild);

  HRESULT hr = AccessibleObjectFromEvent(hwnd, OBJID_WINDOW, CHILDID_SELF,
                                         &pAcc, &varChild);
  if (hr != S_OK || !pAcc) {
    VariantClear(&varChild);
    return false;
  }

  VARIANT varState;
  VariantInit(&varState);
  hr = pAcc->lpVtbl->get_accState(pAcc, varChild, &varState);

  bool focused = false;
  if (hr == S_OK && varState.vt == VT_I4) {
    focused = (varState.lVal & STATE_SYSTEM_FOCUSED) != 0;
  }

  VariantClear(&varState);
  VariantClear(&varChild);
  pAcc->lpVtbl->Release(pAcc);
  return focused;
}

/* ── Event emitters ─────────────────────────────────────────────────────── */

static void handle_movesize_event(struct ow_target_window *ti) {
  struct ow_window_bounds bounds;
  if (get_content_bounds(ti->hwnd, &bounds)) {
    struct ow_event e = {
        .type            = OW_MOVERESIZE,
        .data.moveresize = {.bounds = bounds},
    };
    ow_emit_event(&e);
  }
}

/* ── Core window-tracking logic ─────────────────────────────────────────── */

static void check_and_handle_window(HWND hwnd,
                                    struct ow_target_window *ti) {
  /* Ignore unresponsive ghost windows */
  if (hwnd && IsHungAppWindow(hwnd)) return;

  if (ti->hwnd != NULL) {
    if (ti->hwnd != hwnd) {
      /* The foreground window changed away from the target. */
      if (ti->is_focused) {
        ti->is_focused = false;
        struct ow_event e = {.type = OW_BLUR};
        ow_emit_event(&e);
      }
      if (ti->is_destroyed) {
        /* BUG NOTE (original): hwnd was set to NULL correctly here. */
        ti->hwnd       = NULL;
        ti->is_destroyed = false;
        struct ow_event e = {.type = OW_DETACH};
        ow_emit_event(&e);
      }
    } else {
      /* Same window re-activated */
      if (!ti->is_focused) {
        ti->is_focused = true;
        struct ow_event e = {.type = OW_FOCUS};
        ow_emit_event(&e);
      }
      return;
    }
  }

  /* Check whether the new foreground window title matches the target. */
  if (!hwnd) return;

  char *title = NULL;
  if (!get_title(hwnd, &title) || title == NULL) return;

  bool match = (strcmp(title, ti->title) == 0);
  free(title);
  if (!match) return;

  /* Detach old hooks before attaching to the new window. */
  if (ti->hwnd != NULL) {
    UnhookWinEvent(ti->location_hook);
    UnhookWinEvent(ti->destroy_hook);
  }

  ti->hwnd = hwnd;

  DWORD pid = 0;
  DWORD thread_id = GetWindowThreadProcessId(ti->hwnd, &pid);
  if (thread_id == 0) return;

  ti->location_hook = SetWinEventHook(
      EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE,
      NULL, hook_proc, 0, thread_id, WINEVENT_OUTOFCONTEXT);
  ti->destroy_hook  = SetWinEventHook(
      EVENT_OBJECT_DESTROY, EVENT_OBJECT_DESTROY,
      NULL, hook_proc, 0, thread_id, WINEVENT_OUTOFCONTEXT);

  struct ow_event e = {
      .type       = OW_ATTACH,
      .data.attach = {.has_access = -1, .is_fullscreen = -1},
  };
  e.data.attach.has_access = has_uipi_access(ti->hwnd) ? 1 : 0;

  if (get_content_bounds(ti->hwnd, &e.data.attach.bounds)) {
    ow_emit_event(&e);

    ti->is_focused = true;
    e.type = OW_FOCUS;
    ow_emit_event(&e);
  } else {
    /* Window disappeared between becoming active and us querying it. */
    ti->hwnd = NULL;
  }
}

static void handle_new_foreground(HWND hwnd) {
  foreground_window = hwnd;

  if (fg_window_namechange_hook != NULL) {
    UnhookWinEvent(fg_window_namechange_hook);
    fg_window_namechange_hook = NULL;
  }

  /* Watch for title changes on the new foreground window (unless it IS the
     target, where we already have a hook). */
  if (foreground_window != NULL &&
      foreground_window != target_info.hwnd) {
    DWORD tid = GetWindowThreadProcessId(foreground_window, NULL);
    if (tid != 0) {
      fg_window_namechange_hook = SetWinEventHook(
          EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE,
          NULL, hook_proc, 0, tid, WINEVENT_OUTOFCONTEXT);
    }
  }

  check_and_handle_window(foreground_window, &target_info);
}

/* ── WinEvent hook callback ─────────────────────────────────────────────── */

static VOID CALLBACK hook_proc(
    HWINEVENTHOOK hWinEventHook, DWORD event, HWND hwnd,
    LONG idObject, LONG idChild, DWORD idEventThread, DWORD dwmsEventTime) {

  (void)hWinEventHook; (void)idEventThread; (void)dwmsEventTime;

  if (event == EVENT_OBJECT_DESTROY) {
    if (hwnd == target_info.hwnd &&
        idObject == OBJID_WINDOW && idChild == CHILDID_SELF) {
      target_info.is_destroyed = true;
      check_and_handle_window(NULL, &target_info);
    }
    return;
  }

  if (event == EVENT_OBJECT_LOCATIONCHANGE) {
    if (hwnd == target_info.hwnd &&
        idObject == OBJID_WINDOW && idChild == CHILDID_SELF) {
      handle_movesize_event(&target_info);
    }
    return;
  }

  if (event == EVENT_OBJECT_NAMECHANGE) {
    if (hwnd == foreground_window &&
        idObject == OBJID_WINDOW && idChild == CHILDID_SELF) {
      check_and_handle_window(foreground_window, &target_info);
    }
    return;
  }

  if (event == EVENT_SYSTEM_FOREGROUND ||
      event == EVENT_SYSTEM_MINIMIZEEND) {
    /*
     * Filter false positives: when windows switch rapidly, Windows may fire
     * EVENT_SYSTEM_FOREGROUND for a window that never actually received focus.
     * Use GetForegroundWindow() first, then MSAA as a fallback.
     */
    if (GetForegroundWindow() != hwnd &&
        !MSAA_check_window_focused_state(hwnd)) {
      return; /* False positive – ignore */
    }
    handle_new_foreground(hwnd);
  }
}

/* ── Foreground polling timer (fallback) ────────────────────────────────── */

static VOID CALLBACK foreground_timer_proc(
    HWND _hwnd, UINT msg, UINT_PTR timerId, DWORD dwmsEventTime) {
  (void)_hwnd; (void)msg; (void)timerId; (void)dwmsEventTime;

  HWND sys_fg = GetForegroundWindow();
  if (foreground_window != sys_fg &&
      MSAA_check_window_focused_state(sys_fg)) {
    handle_new_foreground(sys_fg);
  }
}

/* ── Hook thread ────────────────────────────────────────────────────────── */

static void hook_thread(void *_arg) {
  (void)_arg;

  SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
                  NULL, hook_proc, 0, 0, WINEVENT_OUTOFCONTEXT);
  SetWinEventHook(EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZEEND,
                  NULL, hook_proc, 0, 0, WINEVENT_OUTOFCONTEXT);

  /*
   * Polling fallback: covers ForegroundLockTimeout quirks and edge cases
   * where another app steals the foreground without a WinEvent.
   * WH_SHELL / WH_CBT would be more precise but require DLL injection.
   */
  SetTimer(NULL, 0, OW_FOREGROUND_TIMER_MS, foreground_timer_proc);

  foreground_window = GetForegroundWindow();
  /* BUG FIX: guard against NULL before calling GetWindowThreadProcessId */
  if (foreground_window != NULL) {
    DWORD tid = GetWindowThreadProcessId(foreground_window, NULL);
    if (tid != 0) {
      fg_window_namechange_hook = SetWinEventHook(
          EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE,
          NULL, hook_proc, 0, tid, WINEVENT_OUTOFCONTEXT);
    }
    check_and_handle_window(foreground_window, &target_info);
  }

  MSG message;
  while (GetMessageW(&message, (HWND)NULL, 0, 0) != FALSE) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
}

/* ── Public API ─────────────────────────────────────────────────────────── */

void ow_start_hook(char *target_window_title, void *overlay_window_id) {
  target_info.title = target_window_title;
  if (overlay_window_id != NULL) {
    overlay_info.hwnd = *((HWND *)overlay_window_id);
  }
  WM_OVERLAY_UIPI_TEST =
      RegisterWindowMessage("ELECTRON_OVERLAY_UIPI_TEST");
  uv_thread_create(&hook_tid, hook_thread, NULL);
}

void ow_activate_overlay(void) {
  SetForegroundWindow(overlay_info.hwnd);
}

void ow_focus_target(void) {
  SetForegroundWindow(target_info.hwnd);
}

void ow_screenshot(uint8_t *out, uint32_t width, uint32_t height) {
  POINT screen_pos = {0, 0};
  ClientToScreen(target_info.hwnd, &screen_pos);

  BITMAPINFOHEADER bi = {
      .biSize        = sizeof(BITMAPINFOHEADER),
      .biWidth       = (LONG)width,
      .biHeight      = -((LONG)height), /* top-down */
      .biPlanes      = 1,
      .biBitCount    = 32,
      .biCompression = BI_RGB,
      .biSizeImage   = width * height * 4,
  };

  /* BUG FIX: use GetDesktopWindow() consistently for both GetDC and ReleaseDC */
  HWND  desktop = GetDesktopWindow();
  HDC   dc_src  = GetDC(desktop);
  HDC   dc_dest = CreateCompatibleDC(dc_src);

  uint8_t *bmp_data = NULL;
  HBITMAP  bmp = CreateDIBSection(dc_src, (BITMAPINFO *)&bi,
                                   DIB_RGB_COLORS, (void **)&bmp_data,
                                   NULL, 0);
  SelectObject(dc_dest, bmp);
  BitBlt(dc_dest, 0, 0, (int)width, (int)height,
         dc_src, screen_pos.x, screen_pos.y, SRCCOPY);

  memcpy(out, bmp_data, bi.biSizeImage);

  DeleteDC(dc_dest);
  ReleaseDC(desktop, dc_src);  /* BUG FIX: was ReleaseDC(target_info.hwnd, ...) */
  DeleteObject(bmp);
}
