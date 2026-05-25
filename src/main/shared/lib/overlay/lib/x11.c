#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <xcb/xcb.h>
#include "overlay_window.h"

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

static xcb_connection_t* x_conn;
static xcb_window_t      root;

static xcb_atom_t ATOM_NET_ACTIVE_WINDOW;
static xcb_atom_t ATOM_NET_WM_NAME;
static xcb_atom_t ATOM_UTF8_STRING;
static xcb_atom_t ATOM_NET_WM_STATE;
static xcb_atom_t ATOM_NET_WM_STATE_FULLSCREEN;

struct ow_target_window {
  char*        title;
  xcb_window_t window_id;
  bool         is_focused;
  bool         is_destroyed;
  bool         is_fullscreen;
};

struct ow_overlay_window {
  xcb_window_t window_id;
};

static xcb_window_t active_window = XCB_WINDOW_NONE;

static struct ow_target_window target_info = {
  .title        = NULL,
  .window_id    = XCB_WINDOW_NONE,
  .is_focused   = false,
  .is_destroyed = false,
  .is_fullscreen = false,
};

static struct ow_overlay_window overlay_info = {
  .window_id = XCB_WINDOW_NONE,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static xcb_window_t get_active_window(void) {
  xcb_get_property_reply_t* reply = xcb_get_property_reply(
    x_conn,
    xcb_get_property(x_conn, 0, root, ATOM_NET_ACTIVE_WINDOW, XCB_ATOM_WINDOW, 0, 1),
    NULL);
  if (reply == NULL) return XCB_WINDOW_NONE;

  xcb_window_t wid = *((xcb_window_t*)xcb_get_property_value(reply));
  free(reply);
  return wid;
}

static bool get_title(xcb_window_t wid, char** title) {
  if (wid == XCB_WINDOW_NONE) {
    *title = NULL;
    return true;
  }

  xcb_get_property_reply_t* reply = xcb_get_property_reply(
    x_conn,
    xcb_get_property(x_conn, 0, wid, ATOM_NET_WM_NAME, ATOM_UTF8_STRING, 0, 100000),
    NULL);
  if (reply == NULL) return false;

  int len = xcb_get_property_value_length(reply);
  if (len == 0) {
    *title = NULL;
    free(reply);
    return true;
  }

  *title = malloc((size_t)len + 1);
  if (*title == NULL) {
    free(reply);
    return false;
  }
  memcpy(*title, xcb_get_property_value(reply), (size_t)len);
  (*title)[len] = '\0';
  free(reply);
  return true;
}

static bool get_content_bounds(xcb_window_t wid, struct ow_window_bounds* bounds) {
  xcb_get_geometry_reply_t* geom = xcb_get_geometry_reply(
    x_conn, xcb_get_geometry(x_conn, wid), NULL);
  if (geom == NULL) return false;

  xcb_translate_coordinates_reply_t* trans = xcb_translate_coordinates_reply(
    x_conn, xcb_translate_coordinates(x_conn, wid, root, 0, 0), NULL);
  if (trans == NULL) {
    free(geom);
    return false;
  }

  bounds->x      = trans->dst_x;
  bounds->y      = trans->dst_y;
  bounds->width  = geom->width;
  bounds->height = geom->height;

  free(trans);
  free(geom);
  return true;
}

static bool is_fullscreen_window(xcb_window_t wid, bool* is_fullscreen) {
  xcb_get_property_reply_t* reply = xcb_get_property_reply(
    x_conn,
    xcb_get_property(x_conn, 0, wid, ATOM_NET_WM_STATE, XCB_ATOM_ATOM, 0, 100000),
    NULL);
  if (reply == NULL) return false;

  *is_fullscreen = false;
  xcb_atom_t* wm_state = (xcb_atom_t*)xcb_get_property_value(reply);
  for (unsigned i = 0; i < reply->value_len; ++i) {
    if (wm_state[i] == ATOM_NET_WM_STATE_FULLSCREEN) {
      *is_fullscreen = true;
      break;
    }
  }
  free(reply);
  return true;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

static void handle_moveresize_xevent(struct ow_target_window* t) {
  struct ow_window_bounds bounds;
  if (get_content_bounds(t->window_id, &bounds)) {
    struct ow_event e = {
      .type = OW_MOVERESIZE,
      .data.moveresize = { .bounds = bounds },
    };
    ow_emit_event(&e);
  }
}

static void handle_fullscreen_xevent(struct ow_target_window* t) {
  bool is_fullscreen;
  if (!is_fullscreen_window(t->window_id, &is_fullscreen)) return;

  if (is_fullscreen != t->is_fullscreen) {
    t->is_fullscreen = is_fullscreen;
    struct ow_event e = {
      .type = OW_FULLSCREEN,
      .data.fullscreen = { .is_fullscreen = t->is_fullscreen },
    };
    ow_emit_event(&e);
  }
}

static void check_and_handle_window(xcb_window_t wid, struct ow_target_window* t) {
  if (t->window_id != XCB_WINDOW_NONE) {
    if (t->window_id != wid) {
      if (t->is_focused) {
        t->is_focused = false;
        struct ow_event e = { .type = OW_BLUR };
        ow_emit_event(&e);
      }

      if (t->is_destroyed) {
        t->window_id = XCB_WINDOW_NONE;
        t->is_destroyed = false;
        struct ow_event e = { .type = OW_DETACH };
        ow_emit_event(&e);
      }
    } else {
      // Same window — just emit focus if needed.
      if (!t->is_focused) {
        t->is_focused = true;
        struct ow_event e = { .type = OW_FOCUS };
        ow_emit_event(&e);
      }
      return;
    }
  }

  // Check whether the newly active window matches our target title.
  char* title = NULL;
  if (!get_title(wid, &title) || title == NULL) {
    return;
  }
  bool is_equal = (strcmp(title, t->title) == 0);
  free(title);
  if (!is_equal) {
    return;
  }

  // Stop listening to the old window (if any).
  if (t->window_id != XCB_WINDOW_NONE) {
    uint32_t mask[] = { XCB_EVENT_MASK_NO_EVENT };
    xcb_change_window_attributes(x_conn, t->window_id, XCB_CW_EVENT_MASK, mask);
  }

  t->window_id = wid;

  // Listen for _NET_WM_STATE (fullscreen) and move/resize/destroy.
  uint32_t mask[] = { XCB_EVENT_MASK_PROPERTY_CHANGE | XCB_EVENT_MASK_STRUCTURE_NOTIFY };
  xcb_change_window_attributes(x_conn, t->window_id, XCB_CW_EVENT_MASK, mask);

  struct ow_event e = {
    .type = OW_ATTACH,
    .data.attach = { .has_access = -1, .is_fullscreen = -1 },
  };

  bool is_fullscreen;
  if (is_fullscreen_window(t->window_id, &is_fullscreen) &&
      get_content_bounds(t->window_id, &e.data.attach.bounds)) {
    if (is_fullscreen != t->is_fullscreen) {
      t->is_fullscreen = is_fullscreen;
      e.data.attach.is_fullscreen = (int)is_fullscreen;
    }
    ow_emit_event(&e);

    t->is_focused = true;
    e.type = OW_FOCUS;
    ow_emit_event(&e);
  } else {
    // Target window died immediately after becoming active.
    t->window_id = XCB_WINDOW_NONE;
  }
}

// ---------------------------------------------------------------------------
// XCB event loop
// ---------------------------------------------------------------------------

static void hook_proc(xcb_generic_event_t* generic_event) {
  uint8_t response_type = generic_event->response_type & ~0x80;

  if (response_type == XCB_DESTROY_NOTIFY) {
    xcb_destroy_notify_event_t* event = (xcb_destroy_notify_event_t*)generic_event;
    if (event->window == target_info.window_id) {
      target_info.is_destroyed = true;
      check_and_handle_window(XCB_WINDOW_NONE, &target_info);
    }
    return;
  }

  if (response_type == XCB_CONFIGURE_NOTIFY) {
    xcb_configure_notify_event_t* event = (xcb_configure_notify_event_t*)generic_event;
    if (event->window == target_info.window_id) {
      handle_moveresize_xevent(&target_info);
    }
    return;
  }

  if (response_type == XCB_PROPERTY_NOTIFY) {
    xcb_property_notify_event_t* event = (xcb_property_notify_event_t*)generic_event;

    if (event->window == root && event->atom == ATOM_NET_ACTIVE_WINDOW) {
      xcb_window_t old_active = active_window;
      active_window = get_active_window();

      // Stop listening to the old active window unless it's our target.
      if (old_active != target_info.window_id && old_active != XCB_WINDOW_NONE) {
        uint32_t mask[] = { XCB_EVENT_MASK_NO_EVENT };
        xcb_change_window_attributes(x_conn, old_active, XCB_CW_EVENT_MASK, mask);
      }

      // Listen for _NET_WM_NAME on the new active window so we can catch
      // late title changes.
      if (active_window != XCB_WINDOW_NONE && active_window != target_info.window_id) {
        uint32_t mask[] = { XCB_EVENT_MASK_PROPERTY_CHANGE };
        xcb_change_window_attributes(x_conn, active_window, XCB_CW_EVENT_MASK, mask);
      }

      check_and_handle_window(active_window, &target_info);
    } else if (event->window == target_info.window_id && event->atom == ATOM_NET_WM_STATE) {
      handle_fullscreen_xevent(&target_info);
    } else if (event->window == active_window && event->atom == ATOM_NET_WM_NAME) {
      check_and_handle_window(active_window, &target_info);
    }
    return;
  }
}

static void hook_thread(void* _arg) {
  (void)_arg;

  x_conn = xcb_connect(NULL, NULL);
  xcb_screen_t* screen = xcb_setup_roots_iterator(xcb_get_setup(x_conn)).data;
  root = screen->root;

  // Intern all atoms we need.
  struct { xcb_intern_atom_cookie_t cookie; xcb_atom_t* dest; const char* name; } atoms[] = {
    { xcb_intern_atom(x_conn, 0, strlen("_NET_ACTIVE_WINDOW"),       "_NET_ACTIVE_WINDOW"),       &ATOM_NET_ACTIVE_WINDOW       },
    { xcb_intern_atom(x_conn, 0, strlen("_NET_WM_NAME"),             "_NET_WM_NAME"),             &ATOM_NET_WM_NAME             },
    { xcb_intern_atom(x_conn, 0, strlen("UTF8_STRING"),              "UTF8_STRING"),              &ATOM_UTF8_STRING             },
    { xcb_intern_atom(x_conn, 0, strlen("_NET_WM_STATE"),            "_NET_WM_STATE"),            &ATOM_NET_WM_STATE            },
    { xcb_intern_atom(x_conn, 0, strlen("_NET_WM_STATE_FULLSCREEN"), "_NET_WM_STATE_FULLSCREEN"), &ATOM_NET_WM_STATE_FULLSCREEN },
  };
  for (size_t i = 0; i < sizeof(atoms) / sizeof(atoms[0]); ++i) {
    xcb_intern_atom_reply_t* reply = xcb_intern_atom_reply(x_conn, atoms[i].cookie, NULL);
    *atoms[i].dest = reply->atom;
    free(reply);
  }

  if (overlay_info.window_id != XCB_WINDOW_NONE) {
    // Set override-redirect before the window is mapped so the WM ignores it.
    uint32_t values[] = { 1 };
    xcb_change_window_attributes(x_conn, overlay_info.window_id, XCB_CW_OVERRIDE_REDIRECT, values);
  }

  // Listen for _NET_ACTIVE_WINDOW changes on root.
  uint32_t mask[] = { XCB_EVENT_MASK_PROPERTY_CHANGE };
  xcb_change_window_attributes(x_conn, root, XCB_CW_EVENT_MASK, mask);

  active_window = get_active_window();
  if (active_window != XCB_WINDOW_NONE) {
    // Also listen for _NET_WM_NAME on the current active window.
    uint32_t wm_mask[] = { XCB_EVENT_MASK_PROPERTY_CHANGE };
    xcb_change_window_attributes(x_conn, active_window, XCB_CW_EVENT_MASK, wm_mask);
    check_and_handle_window(active_window, &target_info);
  }

  xcb_flush(x_conn);

  xcb_generic_event_t* event;
  while ((event = xcb_wait_for_event(x_conn)) != NULL) {
    hook_proc(event);
    xcb_flush(x_conn);
    free(event);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void ow_start_hook(char* target_window_title, void* overlay_window_id) {
  target_info.title = target_window_title;
  if (overlay_window_id != NULL) {
    overlay_info.window_id = *((xcb_window_t*)overlay_window_id);
  }
  uv_thread_create(&hook_tid, hook_thread, NULL);
}

void ow_activate_overlay(void) {
  xcb_set_input_focus(x_conn, XCB_INPUT_FOCUS_PARENT, overlay_info.window_id, XCB_CURRENT_TIME);
  xcb_flush(x_conn);
}

void ow_focus_target(void) {
  xcb_set_input_focus(x_conn, XCB_INPUT_FOCUS_PARENT, target_info.window_id, XCB_CURRENT_TIME);
  xcb_flush(x_conn);
}
