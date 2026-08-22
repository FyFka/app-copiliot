#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <Windows.h>
#include <oleacc.h>
#include "overlay_window.h"

// Poll for foreground window changes at ~12 fps.
// Needed because WH_SHELL / WH_CBT hooks require DLL injection.
#define OW_FOREGROUND_TIMER_MS 83

struct ow_target_window {
  char*          title;
  HWND           hwnd;
  HWINEVENTHOOK  location_hook;
  HWINEVENTHOOK  destroy_hook;
  bool           is_focused;
  bool           is_destroyed;
};

struct ow_overlay_window {
  HWND hwnd;
};

static HWND            foreground_window            = NULL;
static bool            hook_started                 = false;
// Set when ow_start_hook is called again with a new title; consumed by the
// foreground timer so the re-check runs on the hook thread that owns the hooks.
static volatile bool   retarget_pending             = false;
static HWINEVENTHOOK   fg_window_namechange_hook    = NULL;
static UINT            WM_OVERLAY_UIPI_TEST         = WM_NULL;

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

static VOID CALLBACK hook_proc(HWINEVENTHOOK, DWORD, HWND, LONG, LONG, DWORD, DWORD);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static bool has_uipi_access(HWND hwnd) {
  SetLastError(ERROR_SUCCESS);
  PostMessage(hwnd, WM_OVERLAY_UIPI_TEST, 0, 0);
  return GetLastError() != ERROR_ACCESS_DENIED;
}

static bool get_title(HWND hwnd, char** title) {
  SetLastError(0);
  int titleLength = GetWindowTextLengthW(hwnd);
  if (titleLength == 0) {
    if (GetLastError() != 0) {
      return false;
    }
    *title = NULL;
    return true;
  }

  LPWSTR titleUtf16 = malloc(sizeof(WCHAR) * ((size_t)titleLength + 1));
  if (titleUtf16 == NULL) return false;

  if (GetWindowTextW(hwnd, titleUtf16, titleLength + 1) == FALSE) {
    free(titleUtf16);
    return false;
  }

  int buffLenUtf8 = WideCharToMultiByte(CP_UTF8, 0, titleUtf16, -1, NULL, 0, NULL, NULL);
  if (buffLenUtf8 == FALSE) {
    free(titleUtf16);
    return false;
  }

  *title = malloc(buffLenUtf8);
  if (*title == NULL) {
    free(titleUtf16);
    return false;
  }

  if (WideCharToMultiByte(CP_UTF8, 0, titleUtf16, -1, *title, buffLenUtf8, NULL, NULL) == FALSE) {
    free(titleUtf16);
    free(*title);
    return false;
  }

  free(titleUtf16);
  return true;
}

static bool get_content_bounds(HWND hwnd, struct ow_window_bounds* bounds) {
  RECT rect;
  if (GetClientRect(hwnd, &rect) == FALSE) {
    return false;
  }

  POINT ptClientUL = { .x = rect.left, .y = rect.top };
  if (ClientToScreen(hwnd, &ptClientUL) == FALSE) {
    return false;
  }

  bounds->x      = ptClientUL.x;
  bounds->y      = ptClientUL.y;
  bounds->width  = (uint32_t)rect.right;
  bounds->height = (uint32_t)rect.bottom;
  return true;
}

// Uses MSAA to verify that a window is really focused.
// Needed because EVENT_SYSTEM_FOREGROUND can fire spuriously when windows
// switch rapidly — Windows may send the event but leave focus unchanged.
static bool MSAA_check_window_focused_state(HWND hwnd) {
  IAccessible* pAcc = NULL;
  VARIANT varChildSelf;
  VariantInit(&varChildSelf);

  HRESULT hr = AccessibleObjectFromEvent(hwnd, OBJID_WINDOW, CHILDID_SELF, &pAcc, &varChildSelf);
  if (hr != S_OK || pAcc == NULL) {
    VariantClear(&varChildSelf);
    return false;
  }

  VARIANT varState;
  VariantInit(&varState);
  hr = pAcc->lpVtbl->get_accState(pAcc, varChildSelf, &varState);

  bool is_focused = false;
  if (hr == S_OK && varState.vt == VT_I4) {
    is_focused = (varState.lVal & STATE_SYSTEM_FOCUSED) != 0;
  }

  VariantClear(&varState);
  VariantClear(&varChildSelf);
  pAcc->lpVtbl->Release(pAcc);
  return is_focused;
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

static void handle_movesize_event(struct ow_target_window* t) {
  struct ow_window_bounds bounds;
  if (get_content_bounds(t->hwnd, &bounds)) {
    struct ow_event e = {
      .type = OW_MOVERESIZE,
      .data.moveresize = { .bounds = bounds },
    };
    ow_emit_event(&e);
  }
}

static void check_and_handle_window(HWND hwnd, struct ow_target_window* t) {
  // Ignore ghost windows for hung applications.
  if (hwnd != NULL && IsHungAppWindow(hwnd)) {
    return;
  }

  // Our own overlay coming to the foreground (e.g. when the user makes it
  // interactive) must not blur or detach the window we are attached to.
  if (hwnd != NULL && hwnd == overlay_info.hwnd) {
    return;
  }

  if (t->hwnd != NULL) {
    if (t->hwnd != hwnd) {
      if (t->is_focused) {
        t->is_focused = false;
        struct ow_event e = { .type = OW_BLUR };
        ow_emit_event(&e);
      }

      if (t->is_destroyed) {
        t->hwnd = NULL;
        t->is_destroyed = false;
        struct ow_event e = { .type = OW_DETACH };
        ow_emit_event(&e);
      }
    } else {
      // Same window — just emit focus if not already focused.
      if (!t->is_focused) {
        t->is_focused = true;
        struct ow_event e = { .type = OW_FOCUS };
        ow_emit_event(&e);
      }
      return;
    }
  }

  // Check if the new foreground window matches our target title.
  char* title = NULL;
  if (!get_title(hwnd, &title) || title == NULL) {
    return;
  }
  bool is_equal = (t->title != NULL && strcmp(title, t->title) == 0);
  free(title);
  if (!is_equal) {
    return;
  }

  // New matching window found — unhook old hooks if any.
  if (t->hwnd != NULL) {
    UnhookWinEvent(t->location_hook);
    UnhookWinEvent(t->destroy_hook);
  }

  t->hwnd = hwnd;

  DWORD pid;
  DWORD threadId = GetWindowThreadProcessId(t->hwnd, &pid);
  if (threadId == 0) {
    t->hwnd = NULL;
    return;
  }

  t->location_hook = SetWinEventHook(
    EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE,
    NULL, hook_proc, 0, threadId, WINEVENT_OUTOFCONTEXT);
  t->destroy_hook = SetWinEventHook(
    EVENT_OBJECT_DESTROY, EVENT_OBJECT_DESTROY,
    NULL, hook_proc, 0, threadId, WINEVENT_OUTOFCONTEXT);

  struct ow_event e = {
    .type = OW_ATTACH,
    .data.attach = { .has_access = -1, .is_fullscreen = -1 },
  };
  e.data.attach.has_access = has_uipi_access(t->hwnd) ? 1 : 0;

  if (get_content_bounds(t->hwnd, &e.data.attach.bounds)) {
    ow_emit_event(&e);

    t->is_focused = true;
    e.type = OW_FOCUS;
    ow_emit_event(&e);
  } else {
    // Target window died immediately after becoming active.
    t->hwnd = NULL;
  }
}

static void handle_new_foreground(HWND hwnd) {
  foreground_window = hwnd;

  if (fg_window_namechange_hook != NULL) {
    UnhookWinEvent(fg_window_namechange_hook);
    fg_window_namechange_hook = NULL;
  }

  if (foreground_window != NULL && foreground_window != target_info.hwnd) {
    fg_window_namechange_hook = SetWinEventHook(
      EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE,
      NULL, hook_proc, 0, GetWindowThreadProcessId(foreground_window, NULL),
      WINEVENT_OUTOFCONTEXT);
  }

  check_and_handle_window(foreground_window, &target_info);
}

static VOID CALLBACK hook_proc(
  HWINEVENTHOOK hWinEventHook, DWORD event, HWND hwnd,
  LONG idObject, LONG idChild, DWORD idEventThread, DWORD dwmsEventTime
) {
  (void)hWinEventHook; (void)idEventThread; (void)dwmsEventTime;

  if (event == EVENT_OBJECT_DESTROY) {
    if (hwnd == target_info.hwnd && idObject == OBJID_WINDOW && idChild == CHILDID_SELF) {
      target_info.is_destroyed = true;
      check_and_handle_window(NULL, &target_info);
    }
    return;
  }

  if (event == EVENT_OBJECT_LOCATIONCHANGE) {
    if (hwnd == target_info.hwnd && idObject == OBJID_WINDOW && idChild == CHILDID_SELF) {
      handle_movesize_event(&target_info);
    }
    return;
  }

  if (event == EVENT_OBJECT_NAMECHANGE) {
    if (hwnd == foreground_window && idObject == OBJID_WINDOW && idChild == CHILDID_SELF) {
      check_and_handle_window(foreground_window, &target_info);
    }
    return;
  }

  if (event == EVENT_SYSTEM_FOREGROUND || event == EVENT_SYSTEM_MINIMIZEEND) {
    // Verify focus actually moved — multiple rapid switches can cause
    // EVENT_SYSTEM_FOREGROUND without the window truly gaining focus.
    if (GetForegroundWindow() == hwnd || MSAA_check_window_focused_state(hwnd)) {
      handle_new_foreground(hwnd);
    }
    return;
  }
}

static VOID CALLBACK foreground_timer_proc(
  HWND _hwnd, UINT msg, UINT_PTR timerId, DWORD dwmsEventTime
) {
  (void)_hwnd; (void)msg; (void)timerId; (void)dwmsEventTime;

  HWND system_foreground = GetForegroundWindow();

  // A retarget swapped the title out from under us. The foreground window is
  // usually already cached as current, so force a re-evaluation against the new
  // title instead of waiting for the next focus change.
  if (retarget_pending) {
    retarget_pending = false;
    handle_new_foreground(system_foreground);
    return;
  }

  if (foreground_window != system_foreground &&
      MSAA_check_window_focused_state(system_foreground)) {
    handle_new_foreground(system_foreground);
  }
}

// ---------------------------------------------------------------------------
// Hook thread entry point
// ---------------------------------------------------------------------------

static void hook_thread(void* _arg) {
  (void)_arg;

  SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
    NULL, hook_proc, 0, 0, WINEVENT_OUTOFCONTEXT);
  SetWinEventHook(EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZEEND,
    NULL, hook_proc, 0, 0, WINEVENT_OUTOFCONTEXT);

  // Timer fallback: catches ForegroundLockTimeout edge cases and apps that
  // steal the foreground window. WH_SHELL / WH_CBT would need DLL injection.
  SetTimer(NULL, 0, OW_FOREGROUND_TIMER_MS, foreground_timer_proc);

  foreground_window = GetForegroundWindow();
  if (foreground_window != NULL) {
    fg_window_namechange_hook = SetWinEventHook(
      EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE,
      NULL, hook_proc, 0, GetWindowThreadProcessId(foreground_window, NULL),
      WINEVENT_OUTOFCONTEXT);
    check_and_handle_window(foreground_window, &target_info);
  }

  MSG message;
  while (GetMessageW(&message, (HWND)NULL, 0, 0) != FALSE) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Safe to call repeatedly: the first call starts the hook thread, later calls
// only swap the target title. Spawning a thread per call would leak a thread,
// a message loop and a set of WinEvent hooks on every window switch.
void ow_start_hook(char* target_window_title, void* overlay_window_id) {
  // The hook thread reads target_info.title inside a single strcmp, so the
  // pointer it may be holding is only the one from the previous call. Freeing
  // one generation late keeps that read valid without taking a lock; retargets
  // arrive at most once per foreground change, far apart in practice.
  static char* retired_title = NULL;
  char* previous_title = target_info.title;
  target_info.title = target_window_title;
  free(retired_title);
  retired_title = previous_title;

  if (overlay_window_id != NULL) {
    overlay_info.hwnd = *((HWND*)overlay_window_id);
  }
  WM_OVERLAY_UIPI_TEST = RegisterWindowMessage("ELECTRON_OVERLAY_UIPI_TEST");

  if (!hook_started) {
    hook_started = true;
    uv_thread_create(&hook_tid, hook_thread, NULL);
  } else {
    retarget_pending = true;
  }
}

void ow_activate_overlay(void) {
  SetForegroundWindow(overlay_info.hwnd);
}

void ow_focus_target(void) {
  SetForegroundWindow(target_info.hwnd);
}

void ow_screenshot(uint8_t* out, uint32_t width, uint32_t height) {
  POINT screenPos = {0, 0};
  ClientToScreen(target_info.hwnd, &screenPos);

  BITMAPINFOHEADER bi = {0};
  bi.biSize        = sizeof(BITMAPINFOHEADER);
  bi.biWidth       = (LONG)width;
  bi.biHeight      = -((LONG)height); // negative = top-down DIB
  bi.biPlanes      = 1;
  bi.biBitCount    = 32;
  bi.biCompression = BI_RGB;
  bi.biSizeImage   = width * height * 4;

  HWND desktopWnd = GetDesktopWindow();
  HDC dcSrc  = GetDC(desktopWnd);
  HDC dcDest = CreateCompatibleDC(dcSrc);

  uint8_t* bmpData = NULL;
  HBITMAP bmp = CreateDIBSection(dcSrc, (BITMAPINFO*)&bi, DIB_RGB_COLORS, (void**)&bmpData, NULL, 0);
  HGDIOBJ old = SelectObject(dcDest, bmp);

  BitBlt(dcDest, 0, 0, (int)width, (int)height, dcSrc, screenPos.x, screenPos.y, SRCCOPY);
  memcpy(out, bmpData, bi.biSizeImage);

  SelectObject(dcDest, old);
  DeleteDC(dcDest);
  // passed to GetDC(). Using target_info.hwnd would leak the desktop DC.
  ReleaseDC(desktopWnd, dcSrc);
  DeleteObject(bmp);
}
