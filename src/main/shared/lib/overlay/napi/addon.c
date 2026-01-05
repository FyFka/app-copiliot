#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <node_api.h>

#include "../napi/napi_helpers.h"
#include "../core/overlay_window.h"

/* Module-level state*/

static napi_threadsafe_function threadsafe_fn = NULL;

/**
 * The most recent window bounds reported by OW_ATTACH or OW_MOVERESIZE.
 * Used by AddonScreenshot to size the capture buffer.
 */
static struct ow_window_bounds last_reported_bounds = {0, 0, 0, 0};

/* ow_emit_event */

void ow_emit_event(struct ow_event *event) {
  if (threadsafe_fn == NULL) {
    return;
  }

  /* Deep-copy so the platform thread can reuse / free the original. */
  struct ow_event *copied_event = malloc(sizeof(struct ow_event));
  if (!copied_event) {
    /* Memory allocation failure – nothing we can do, drop the event. */
    return;
  }
  memcpy(copied_event, event, sizeof(struct ow_event));

  napi_status status =
      napi_call_threadsafe_function(threadsafe_fn, copied_event,
                                    napi_tsfn_nonblocking);

  if (status == napi_closing) {
    /* The environment is shutting down; discard silently. */
    threadsafe_fn = NULL;
    free(copied_event);
    return;
  }

  /* BUG FIX: original code did not free copied_event before the fatal path. */
  if (status != napi_ok) {
    free(copied_event);
    NAPI_FATAL_IF_FAILED(status, "ow_emit_event",
                         "napi_call_threadsafe_function");
  }
}

/* Event → JS object conversion */

static napi_value ow_event_to_js_object(napi_env env,
                                        const struct ow_event *event) {
  napi_status status;
  napi_value event_obj;

  status = napi_create_object(env, &event_obj);
  NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_object");

  napi_value e_type;
  status = napi_create_uint32(env, (uint32_t)event->type, &e_type);
  NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_uint32");

  if (event->type == OW_ATTACH) {
    /* has_access: boolean on Windows, undefined elsewhere */
    napi_value e_has_access;
    if (event->data.attach.has_access == -1) {
      status = napi_get_undefined(env, &e_has_access);
    } else {
      status = napi_get_boolean(env,
                                event->data.attach.has_access == 1,
                                &e_has_access);
    }
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object",
                         "napi_get_(undefined|boolean) [has_access]");

    /* is_fullscreen: boolean on Linux, undefined elsewhere */
    napi_value e_is_fullscreen;
    if (event->data.attach.is_fullscreen == -1) {
      status = napi_get_undefined(env, &e_is_fullscreen);
    } else {
      status = napi_get_boolean(env,
                                event->data.attach.is_fullscreen == 1,
                                &e_is_fullscreen);
    }
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object",
                         "napi_get_(undefined|boolean) [is_fullscreen]");

    napi_value e_x, e_y, e_width, e_height;
    status = napi_create_int32(env, event->data.attach.bounds.x, &e_x);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_int32 [x]");
    status = napi_create_int32(env, event->data.attach.bounds.y, &e_y);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_int32 [y]");
    status = napi_create_uint32(env, event->data.attach.bounds.width,  &e_width);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_uint32 [width]");
    status = napi_create_uint32(env, event->data.attach.bounds.height, &e_height);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_uint32 [height]");

    napi_property_descriptor descriptors[] = {
        {"type",         NULL, NULL, NULL, NULL, e_type,         napi_enumerable, NULL},
        {"hasAccess",    NULL, NULL, NULL, NULL, e_has_access,   napi_enumerable, NULL},
        {"isFullscreen", NULL, NULL, NULL, NULL, e_is_fullscreen, napi_enumerable, NULL},
        {"x",            NULL, NULL, NULL, NULL, e_x,            napi_enumerable, NULL},
        {"y",            NULL, NULL, NULL, NULL, e_y,            napi_enumerable, NULL},
        {"width",        NULL, NULL, NULL, NULL, e_width,        napi_enumerable, NULL},
        {"height",       NULL, NULL, NULL, NULL, e_height,       napi_enumerable, NULL},
    };
    status = napi_define_properties(env, event_obj,
                                    sizeof(descriptors) / sizeof(descriptors[0]),
                                    descriptors);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object",
                         "napi_define_properties [attach]");
    return event_obj;
  }

  if (event->type == OW_FULLSCREEN) {
    napi_value e_is_fullscreen;
    status = napi_get_boolean(env, event->data.fullscreen.is_fullscreen,
                              &e_is_fullscreen);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object",
                         "napi_get_boolean [fullscreen]");

    napi_property_descriptor descriptors[] = {
        {"type",         NULL, NULL, NULL, NULL, e_type,         napi_enumerable, NULL},
        {"isFullscreen", NULL, NULL, NULL, NULL, e_is_fullscreen, napi_enumerable, NULL},
    };
    status = napi_define_properties(env, event_obj,
                                    sizeof(descriptors) / sizeof(descriptors[0]),
                                    descriptors);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object",
                         "napi_define_properties [fullscreen]");
    return event_obj;
  }

  if (event->type == OW_MOVERESIZE) {
    napi_value e_x, e_y, e_width, e_height;
    status = napi_create_int32(env, event->data.moveresize.bounds.x, &e_x);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_int32 [x]");
    status = napi_create_int32(env, event->data.moveresize.bounds.y, &e_y);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_int32 [y]");
    status = napi_create_uint32(env, event->data.moveresize.bounds.width,  &e_width);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_uint32 [width]");
    status = napi_create_uint32(env, event->data.moveresize.bounds.height, &e_height);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_uint32 [height]");

    napi_property_descriptor descriptors[] = {
        {"type",   NULL, NULL, NULL, NULL, e_type,   napi_enumerable, NULL},
        {"x",      NULL, NULL, NULL, NULL, e_x,      napi_enumerable, NULL},
        {"y",      NULL, NULL, NULL, NULL, e_y,      napi_enumerable, NULL},
        {"width",  NULL, NULL, NULL, NULL, e_width,  napi_enumerable, NULL},
        {"height", NULL, NULL, NULL, NULL, e_height, napi_enumerable, NULL},
    };
    status = napi_define_properties(env, event_obj,
                                    sizeof(descriptors) / sizeof(descriptors[0]),
                                    descriptors);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object",
                         "napi_define_properties [moveresize]");
    return event_obj;
  }

  /* OW_FOCUS, OW_BLUR, OW_DETACH – only the type field is meaningful */
  napi_property_descriptor descriptors[] = {
      {"type", NULL, NULL, NULL, NULL, e_type, napi_enumerable, NULL},
  };
  status = napi_define_properties(env, event_obj,
                                  sizeof(descriptors) / sizeof(descriptors[0]),
                                  descriptors);
  NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object",
                       "napi_define_properties [simple]");
  return event_obj;
}

/* Thread-safe function proxy (hook thread → JS main thread) */

static void tsfn_to_js_proxy(napi_env env, napi_value js_callback,
                              void *context, void *_event) {
  (void)context;

  struct ow_event *event = (struct ow_event *)_event;

  /* Keep last_reported_bounds up to date for screenshot sizing. */
  if (event->type == OW_MOVERESIZE) {
    last_reported_bounds = event->data.moveresize.bounds;
  } else if (event->type == OW_ATTACH) {
    last_reported_bounds = event->data.attach.bounds;
  }

  napi_value event_obj = ow_event_to_js_object(env, event);
  free(event);

  napi_value global;
  napi_status status = napi_get_global(env, &global);
  NAPI_FATAL_IF_FAILED(status, "tsfn_to_js_proxy", "napi_get_global");

  status = napi_call_function(env, global, js_callback, 1, &event_obj, NULL);
  NAPI_FATAL_IF_FAILED(status, "tsfn_to_js_proxy", "napi_call_function");
}

/* Exported JS functions */

/**
 * start(overlayWindowIdBuffer, targetTitle, callback)
 *
 * @param overlayWindowIdBuffer  Buffer containing the native window handle, or
 *                               null/undefined.
 * @param targetTitle            UTF-8 string with the window title to track.
 * @param callback               Function called for every overlay event.
 */
static napi_value AddonStart(napi_env env, napi_callback_info info) {
  napi_status status;

  size_t argc = 3;
  napi_value argv[3];
  status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NAPI_THROW_IF_FAILED(env, status, NULL);

  if (argc < 3) {
    NAPI_THROW(env, "ERR_MISSING_ARGS",
               "start() requires 3 arguments: buffer, title, callback", NULL);
  }

  /* [0] Overlay window handle (optional Buffer) */
  void *overlay_window_id = NULL;
  bool has_window_id = false;
  status = napi_is_buffer(env, argv[0], &has_window_id);
  NAPI_THROW_IF_FAILED(env, status, NULL);
  if (has_window_id) {
    status = napi_get_buffer_info(env, argv[0], &overlay_window_id, NULL);
    NAPI_THROW_IF_FAILED(env, status, NULL);
  }

  /* [1] Target window title */
  size_t title_len = 0;
  status = napi_get_value_string_utf8(env, argv[1], NULL, 0, &title_len);
  NAPI_THROW_IF_FAILED(env, status, NULL);

  char *target_window_title = malloc(title_len + 1);
  if (!target_window_title) {
    NAPI_THROW(env, "ERR_OUT_OF_MEMORY", "malloc failed for window title", NULL);
  }
  status = napi_get_value_string_utf8(env, argv[1], target_window_title,
                                      title_len + 1, NULL);
  if (status != napi_ok) {
    free(target_window_title);
    NAPI_THROW_IF_FAILED(env, status, NULL);
  }

  /* [2] Event callback → threadsafe function */
  napi_value async_name;
  status = napi_create_string_utf8(env, "OVERLAY_WINDOW_HOOK",
                                   NAPI_AUTO_LENGTH, &async_name);
  NAPI_THROW_IF_FAILED(env, status, NULL);

  status = napi_create_threadsafe_function(
      env, argv[2], NULL, async_name,
      /* max_queue_size */ 0,
      /* initial_thread_count */ 1,
      /* thread_finalize_data */ NULL,
      /* thread_finalize_cb */ NULL,
      /* context */ NULL,
      tsfn_to_js_proxy,
      &threadsafe_fn);
  if (status != napi_ok) {
    free(target_window_title);
    NAPI_THROW_IF_FAILED(env, status, NULL);
  }

  ow_start_hook(target_window_title, overlay_window_id);
  return NULL;
}

static napi_value AddonActivateOverlay(napi_env env, napi_callback_info info) {
  (void)env; (void)info;
  ow_activate_overlay();
  return NULL;
}

static napi_value AddonFocusTarget(napi_env env, napi_callback_info info) {
  (void)env; (void)info;
  ow_focus_target();
  return NULL;
}

/**
 * screenshot() → Buffer (BGRA, width × height × 4 bytes)
 *
 */
static napi_value AddonScreenshot(napi_env env, napi_callback_info info) {
  (void)info;

  napi_value img_buffer;
  napi_status status;

#ifdef _WIN32
  size_t size = (size_t)last_reported_bounds.width *
                (size_t)last_reported_bounds.height * 4;
  uint8_t *img_data = NULL;
  status = napi_create_buffer(env, size, (void **)&img_data, &img_buffer);
  NAPI_FATAL_IF_FAILED(status, "AddonScreenshot", "napi_create_buffer");
  ow_screenshot(img_data, last_reported_bounds.width,
                last_reported_bounds.height);
#else
  /* ow_screenshot is not implemented on this platform. */
  status = napi_create_buffer(env, 0, NULL, &img_buffer);
  NAPI_FATAL_IF_FAILED(status, "AddonScreenshot",
                       "napi_create_buffer (unsupported platform)");
#endif

  return img_buffer;
}

/* Cleanup */


static void AddonCleanUp(void *arg) {
  (void)arg;
  if (threadsafe_fn != NULL) {
    napi_release_threadsafe_function(threadsafe_fn, napi_tsfn_abort);
    threadsafe_fn = NULL;
  }
}

/* Module registration */

#define EXPORT_FN(name, fn)                                              \
  do {                                                                   \
    napi_value _export_fn;                                               \
    status = napi_create_function(env, NULL, 0, (fn), NULL, &_export_fn); \
    NAPI_FATAL_IF_FAILED(status, "NAPI_MODULE_INIT",                     \
                         "napi_create_function [" name "]");             \
    status = napi_set_named_property(env, exports, (name), _export_fn);  \
    NAPI_FATAL_IF_FAILED(status, "NAPI_MODULE_INIT",                     \
                         "napi_set_named_property [" name "]");          \
  } while (0)

NAPI_MODULE_INIT() {
  napi_status status;

  EXPORT_FN("start",           AddonStart);
  EXPORT_FN("activateOverlay", AddonActivateOverlay);
  EXPORT_FN("focusTarget",     AddonFocusTarget);
  EXPORT_FN("screenshot",      AddonScreenshot);

  status = napi_add_env_cleanup_hook(env, AddonCleanUp, NULL);
  NAPI_FATAL_IF_FAILED(status, "NAPI_MODULE_INIT",
                       "napi_add_env_cleanup_hook");

  return exports;
}
