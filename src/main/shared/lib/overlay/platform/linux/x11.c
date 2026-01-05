/**
 * platform/linux/x11.c
 *
 * X11 (XCB) backend for the overlay-window hook.
 *
 */

#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <xcb/xcb.h>

#include "../../core/overlay_window.h"

/* Module-level state */

uv_thread_t hook_tid;

static xcb_connection_t *x_conn;
static xcb_window_t      root;

static xcb_atom_t ATOM_NET_ACTIVE_WINDOW;
static xcb_atom_t ATOM_NET_WM_NAME;
static xcb_atom_t ATOM_UTF8_STRING;
static xcb_atom_t ATOM_NET_WM_STATE;
static xcb_atom_t ATOM_NET_WM_STATE_FULLSCREEN;

struct ow_target_window {
  char         *title;
  xcb_window_t  window_id;
  bool          is_focused;
  bool          is_destroyed;
  bool          is_fullscreen;
};

struct ow_overlay_window {
  xcb_window_t window_id;
};

static xcb_window_t active_window = XCB_WINDOW_NONE;

static struct ow_target_window target_info = {
    .title         = NULL,
    .window_id     = XCB_WINDOW_NONE,
    .is_focused    = false,
    .is_destroyed  = false,
    .is_fullscreen = false,
};

static struct ow_overlay_window overlay_info = {
    .window_id = XCB_WINDOW_NONE,
};

/* Helpers */

static xcb_window_t get_active_window(void) {
  xcb_get_property_reply_t *reply =
      xcb_get_property_reply(x_conn,
          xcb_get_property(x_conn, 0, root, ATOM_NET_ACTIVE_WINDOW,
                           XCB_ATOM_WINDOW, 0, 1),
          NULL);
  if (!reply) return XCB_WINDOW_NONE;

  xcb_window_t wid = XCB_WINDOW_NONE;
  if (xcb_get_property_value_length(reply) >= (int)sizeof(xcb_window_t)) {
    wid = *(xcb_window_t *)xcb_get_property_value(reply);
  }
  free(reply);
  return wid;
}

/**
 * Fetch the _NET_WM_NAME of @p wid.
 *
 * @param[out] title  Set to a heap-allocated UTF-8 string (caller must free),
 *                    or NULL if the property is absent / empty.
 * @return true on success, false on error.
 *
 * NOTE: an empty title (length 0) is treated the same as no title; this
 * matches the intent of the title-comparison logic in check_and_handle_window.
 */
static bool get_title(xcb_window_t wid, char **title) {
  if (wid == XCB_WINDOW_NONE) {
    *title = NULL;
    return true;
  }

  xcb_get_property_reply_t *reply =
      xcb_get_property_reply(x_conn,
          xcb_get_property(x_conn, 0, wid, ATOM_NET_WM_NAME,
                           ATOM_UTF8_STRING, 0, 100000),
          NULL);
  if (!reply) return false;

  int len = xcb_get_property_value_length(reply);
  if (len == 0) {
    *title = NULL;
    free(reply);
    return true; /* empty title – treat as absent */
  }

  *title = malloc((size_t)len + 1);
  if (!*title) {
    free(reply);
    return false;
  }
  memcpy(*title, xcb_get_property_value(reply), (size_t)len);
  (*title)[len] = '\0';
  free(reply);
  return true;
}

static bool get_content_bounds(xcb_window_t wid,
                                struct ow_window_bounds *bounds) {
  xcb_get_geometry_reply_t *geom =
      xcb_get_geometry_reply(x_conn, xcb_get_geometry(x_conn, wid), NULL);
  if (!geom) return false;

  xcb_translate_coordinates_reply_t *trans =
      xcb_translate_coordinates_reply(x_conn,
          xcb_translate_coordinates(x_conn, wid, root, 0, 0), NULL);
  if (!trans) {
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

static bool is_fullscreen_window(xcb_window_t wid, bool *is_fullscreen) {
  xcb_get_property_reply_t *reply =
      xcb_get_property_reply(x_conn,
          xcb_get_property(x_conn, 0, wid, ATOM_NET_WM_STATE,
                           XCB_ATOM_ATOM, 0, 100000),
          NULL);
  if (!reply) return false;

  *is_fullscreen = false;
  xcb_atom_t *atoms = (xcb_atom_t *)xcb_get_property_value(reply);
  for (unsigned i = 0; i < reply->value_len; ++i) {
    if (atoms[i] == ATOM_NET_WM_STATE_FULLSCREEN) {
      *is_fullscreen = true;
      break;
    }
  }
  free(reply);
  return true;
}

/* Event emitters */

static void handle_moveresize_xevent(struct ow_target_window *ti) {
  struct ow_window_bounds bounds;
  if (get_content_bounds(ti->window_id, &bounds)) {
    struct ow_event e = {
        .type            = OW_MOVERESIZE,
        .data.moveresize = {.bounds = bounds},
    };
    ow_emit_event(&e);
  }
}

static void handle_fullscreen_xevent(struct ow_target_window *ti) {
  bool is_fullscreen;
  if (!is_fullscreen_window(ti->window_id, &is_fullscreen)) return;

  if (is_fullscreen != ti->is_fullscreen) {
    ti->is_fullscreen = is_fullscreen;
    struct ow_event e = {
        .type            = OW_FULLSCREEN,
        .data.fullscreen = {.is_fullscreen = is_fullscreen},
    };
    ow_emit_event(&e);
  }
}

/* Core window-tracking logic */

static void set_event_mask(xcb_window_t wid, uint32_t mask) {
  uint32_t values[] = {mask};
  xcb_change_window_attributes(x_conn, wid, XCB_CW_EVENT_MASK, values);
}

static void check_and_handle_window(xcb_window_t wid,
                                    struct ow_target_window *ti) {
  if (ti->window_id != XCB_WINDOW_NONE) {
    if (ti->window_id != wid) {
      if (ti->is_focused) {
        ti->is_focused = false;
        struct ow_event e = {.type = OW_BLUR};
        ow_emit_event(&e);
      }
      if (ti->is_destroyed) {
        set_event_mask(ti->window_id, XCB_EVENT_MASK_NO_EVENT);
        ti->window_id    = XCB_WINDOW_NONE;
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

  char *title = NULL;
  if (!get_title(wid, &title) || title == NULL) return;

  bool match = (strcmp(title, ti->title) == 0);
  free(title);
  if (!match) return;

  /* Remove event mask from previous target window (if any). */
  if (ti->window_id != XCB_WINDOW_NONE) {
    set_event_mask(ti->window_id, XCB_EVENT_MASK_NO_EVENT);
  }

  ti->window_id = wid;

  /* Subscribe to fullscreen state and structure notifications. */
  set_event_mask(ti->window_id,
                 XCB_EVENT_MASK_PROPERTY_CHANGE |
                 XCB_EVENT_MASK_STRUCTURE_NOTIFY);

  struct ow_event e = {
      .type       = OW_ATTACH,
      .data.attach = {.has_access = -1, .is_fullscreen = -1},
  };

  bool is_fullscreen;
  if (is_fullscreen_window(ti->window_id, &is_fullscreen) &&
      get_content_bounds(ti->window_id, &e.data.attach.bounds)) {
    if (is_fullscreen != ti->is_fullscreen) {
      ti->is_fullscreen       = is_fullscreen;
      e.data.attach.is_fullscreen = (int)is_fullscreen;
    }
    ow_emit_event(&e);

    ti->is_focused = true;
    e.type = OW_FOCUS;
    ow_emit_event(&e);
  } else {
    /* Window disappeared right after becoming active. */
    ti->window_id = XCB_WINDOW_NONE;
  }
}

/* XCB event dispatcher */

static void hook_proc(xcb_generic_event_t *generic_event) {
  uint8_t type = generic_event->response_type; /* already masked by caller */

  if (type == XCB_DESTROY_NOTIFY) {
    xcb_destroy_notify_event_t *ev =
        (xcb_destroy_notify_event_t *)generic_event;
    if (ev->window == target_info.window_id) {
      target_info.is_destroyed = true;
      check_and_handle_window(XCB_WINDOW_NONE, &target_info);
    }
    return;
  }

  if (type == XCB_CONFIGURE_NOTIFY) {
    xcb_configure_notify_event_t *ev =
        (xcb_configure_notify_event_t *)generic_event;
    if (ev->window == target_info.window_id) {
      handle_moveresize_xevent(&target_info);
    }
    return;
  }

  if (type == XCB_PROPERTY_NOTIFY) {
    xcb_property_notify_event_t *ev =
        (xcb_property_notify_event_t *)generic_event;

    if (ev->window == root && ev->atom == ATOM_NET_ACTIVE_WINDOW) {
      xcb_window_t old_active = active_window;
      active_window = get_active_window();

      if (old_active != XCB_WINDOW_NONE &&
          old_active != target_info.window_id &&
          old_active != active_window) {
        set_event_mask(old_active, XCB_EVENT_MASK_NO_EVENT);
      }

      if (active_window != XCB_WINDOW_NONE &&
          active_window != target_info.window_id) {
        /* Watch for _NET_WM_NAME changes on the new foreground window. */
        set_event_mask(active_window, XCB_EVENT_MASK_PROPERTY_CHANGE);
      }

      check_and_handle_window(active_window, &target_info);

    } else if (ev->window == target_info.window_id &&
               ev->atom   == ATOM_NET_WM_STATE) {
      handle_fullscreen_xevent(&target_info);

    } else if (ev->window == active_window &&
               ev->atom   == ATOM_NET_WM_NAME) {
      check_and_handle_window(active_window, &target_info);
    }
    return;
  }
}

/* Atom interning helper */

/**
 * Intern a single atom by name.  Returns XCB_ATOM_NONE on failure.
 */
static xcb_atom_t intern_atom(const char *name) {
  xcb_intern_atom_reply_t *reply =
      xcb_intern_atom_reply(x_conn,
          xcb_intern_atom(x_conn, 0, (uint16_t)strlen(name), name),
          NULL);
  if (!reply) return XCB_ATOM_NONE;
  xcb_atom_t atom = reply->atom;
  free(reply);
  return atom;
}

/* Hook thread */

static void hook_thread(void *_arg) {
  (void)_arg;

  x_conn = xcb_connect(NULL, NULL);
  /* BUG FIX: check for connection error before using the connection */
  if (xcb_connection_has_error(x_conn)) {
    fprintf(stderr, "[overlay-window] xcb_connect failed\n");
    return;
  }

  xcb_screen_t *screen =
      xcb_setup_roots_iterator(xcb_get_setup(x_conn)).data;
  root = screen->root;

  ATOM_NET_ACTIVE_WINDOW     = intern_atom("_NET_ACTIVE_WINDOW");
  ATOM_NET_WM_NAME           = intern_atom("_NET_WM_NAME");
  ATOM_UTF8_STRING           = intern_atom("UTF8_STRING");
  ATOM_NET_WM_STATE          = intern_atom("_NET_WM_STATE");
  ATOM_NET_WM_STATE_FULLSCREEN = intern_atom("_NET_WM_STATE_FULLSCREEN");

  if (ATOM_NET_ACTIVE_WINDOW == XCB_ATOM_NONE ||
      ATOM_NET_WM_NAME       == XCB_ATOM_NONE) {
    fprintf(stderr, "[overlay-window] failed to intern required X atoms\n");
    xcb_disconnect(x_conn);
    return;
  }

  if (overlay_info.window_id != XCB_WINDOW_NONE) {
    /*
     * Set override-redirect before the Electron window is mapped so the
     * WM cannot re-parent or decorate it.
     */
    uint32_t values[] = {1};
    xcb_change_window_attributes(x_conn, overlay_info.window_id,
                                  XCB_CW_OVERRIDE_REDIRECT, values);
  }

  /* Listen for _NET_ACTIVE_WINDOW changes on the root window. */
  set_event_mask(root, XCB_EVENT_MASK_PROPERTY_CHANGE);

  active_window = get_active_window();
  if (active_window != XCB_WINDOW_NONE) {
    /* Watch for _NET_WM_NAME changes on the initially active window. */
    set_event_mask(active_window, XCB_EVENT_MASK_PROPERTY_CHANGE);
    check_and_handle_window(active_window, &target_info);
  }
  xcb_flush(x_conn);

  xcb_generic_event_t *event;
  while ((event = xcb_wait_for_event(x_conn))) {
    event->response_type &= ~0x80; /* strip the "sent event" bit */
    hook_proc(event);
    xcb_flush(x_conn);
    free(event);
  }

  xcb_disconnect(x_conn);
}

/* Public API */

void ow_start_hook(char *target_window_title, void *overlay_window_id) {
  target_info.title = target_window_title;
  if (overlay_window_id != NULL) {
    overlay_info.window_id = *((xcb_window_t *)overlay_window_id);
  }
  uv_thread_create(&hook_tid, hook_thread, NULL);
}

void ow_activate_overlay(void) {
  xcb_set_input_focus(x_conn, XCB_INPUT_FOCUS_PARENT,
                      overlay_info.window_id, XCB_CURRENT_TIME);
  xcb_flush(x_conn);
}

void ow_focus_target(void) {
  xcb_set_input_focus(x_conn, XCB_INPUT_FOCUS_PARENT,
                      target_info.window_id, XCB_CURRENT_TIME);
  xcb_flush(x_conn);
}

/* ow_screenshot is not implemented on Linux. */
