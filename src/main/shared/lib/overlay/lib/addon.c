#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <node_api.h>
#include "napi_helpers.h"
#include "overlay_window.h"

uv_thread_t hook_tid;

static napi_threadsafe_function threadsafe_fn = NULL;
static struct ow_window_bounds last_reported_bounds = {0, 0, 0, 0};

void ow_emit_event(struct ow_event* event) {
  if (threadsafe_fn == NULL) return;

  struct ow_event* copied_event = malloc(sizeof(struct ow_event));
  if (copied_event == NULL) return;
  memcpy(copied_event, event, sizeof(struct ow_event));

  napi_status status = napi_call_threadsafe_function(threadsafe_fn, copied_event, napi_tsfn_nonblocking);
  if (status == napi_closing) {
    threadsafe_fn = NULL;
    free(copied_event);
    return;
  }
  NAPI_FATAL_IF_FAILED(status, "ow_emit_event", "napi_call_threadsafe_function");
}

static napi_value ow_event_to_js_object(napi_env env, struct ow_event* event) {
  napi_status status;

  napi_value event_obj;
  status = napi_create_object(env, &event_obj);
  NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_object");

  napi_value e_type;
  status = napi_create_uint32(env, event->type, &e_type);
  NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_uint32");

  if (event->type == OW_ATTACH) {
    napi_value e_has_access;
    if (event->data.attach.has_access == -1) {
      status = napi_get_undefined(env, &e_has_access);
      NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_get_undefined");
    } else {
      status = napi_get_boolean(env, event->data.attach.has_access == 1, &e_has_access);
      NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_get_boolean");
    }

    napi_value e_is_fullscreen;
    if (event->data.attach.is_fullscreen == -1) {
      status = napi_get_undefined(env, &e_is_fullscreen);
      NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_get_undefined");
    } else {
      status = napi_get_boolean(env, event->data.attach.is_fullscreen == 1, &e_is_fullscreen);
      NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_get_boolean");
    }

    napi_value e_x, e_y, e_width, e_height;
    status = napi_create_int32(env, event->data.attach.bounds.x, &e_x);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_int32");
    status = napi_create_int32(env, event->data.attach.bounds.y, &e_y);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_int32");
    status = napi_create_uint32(env, event->data.attach.bounds.width, &e_width);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_uint32");
    status = napi_create_uint32(env, event->data.attach.bounds.height, &e_height);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_uint32");

    napi_property_descriptor descriptors[] = {
      { "type",         NULL, NULL, NULL, NULL, e_type,          napi_enumerable, NULL },
      { "hasAccess",    NULL, NULL, NULL, NULL, e_has_access,    napi_enumerable, NULL },
      { "isFullscreen", NULL, NULL, NULL, NULL, e_is_fullscreen, napi_enumerable, NULL },
      { "x",            NULL, NULL, NULL, NULL, e_x,             napi_enumerable, NULL },
      { "y",            NULL, NULL, NULL, NULL, e_y,             napi_enumerable, NULL },
      { "width",        NULL, NULL, NULL, NULL, e_width,         napi_enumerable, NULL },
      { "height",       NULL, NULL, NULL, NULL, e_height,        napi_enumerable, NULL },
    };
    status = napi_define_properties(env, event_obj, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_define_properties");
    return event_obj;
  }

  if (event->type == OW_FULLSCREEN) {
    napi_value e_is_fullscreen;
    status = napi_get_boolean(env, event->data.fullscreen.is_fullscreen, &e_is_fullscreen);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_get_boolean");

    napi_property_descriptor descriptors[] = {
      { "type",         NULL, NULL, NULL, NULL, e_type,          napi_enumerable, NULL },
      { "isFullscreen", NULL, NULL, NULL, NULL, e_is_fullscreen, napi_enumerable, NULL },
    };
    status = napi_define_properties(env, event_obj, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_define_properties");
    return event_obj;
  }

  if (event->type == OW_MOVERESIZE) {
    napi_value e_x, e_y, e_width, e_height;
    status = napi_create_int32(env, event->data.moveresize.bounds.x, &e_x);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_int32");
    status = napi_create_int32(env, event->data.moveresize.bounds.y, &e_y);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_int32");
    status = napi_create_uint32(env, event->data.moveresize.bounds.width, &e_width);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_uint32");
    status = napi_create_uint32(env, event->data.moveresize.bounds.height, &e_height);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_create_uint32");

    napi_property_descriptor descriptors[] = {
      { "type",   NULL, NULL, NULL, NULL, e_type,   napi_enumerable, NULL },
      { "x",      NULL, NULL, NULL, NULL, e_x,      napi_enumerable, NULL },
      { "y",      NULL, NULL, NULL, NULL, e_y,      napi_enumerable, NULL },
      { "width",  NULL, NULL, NULL, NULL, e_width,  napi_enumerable, NULL },
      { "height", NULL, NULL, NULL, NULL, e_height, napi_enumerable, NULL },
    };
    status = napi_define_properties(env, event_obj, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
    NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_define_properties");
    return event_obj;
  }

  // OW_FOCUS, OW_BLUR, OW_DETACH — only type field
  napi_property_descriptor descriptors[] = {
    { "type", NULL, NULL, NULL, NULL, e_type, napi_enumerable, NULL },
  };
  status = napi_define_properties(env, event_obj, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
  NAPI_FATAL_IF_FAILED(status, "ow_event_to_js_object", "napi_define_properties");
  return event_obj;
}

// Called on the JS thread by the threadsafe function machinery.
static void tsfn_to_js_proxy(napi_env env, napi_value js_callback, void* context, void* _event) {
  struct ow_event* event = (struct ow_event*)_event;

  // Track last known bounds so AddonScreenshot can use them.
  // Both this function and AddonScreenshot run on the JS thread, so no lock needed.
  if (event->type == OW_MOVERESIZE) {
    last_reported_bounds = event->data.moveresize.bounds;
  } else if (event->type == OW_ATTACH) {
    last_reported_bounds = event->data.attach.bounds;
  }

  napi_status status;
  napi_value event_obj = ow_event_to_js_object(env, event);
  free(event);

  napi_value global;
  status = napi_get_global(env, &global);
  NAPI_FATAL_IF_FAILED(status, "tsfn_to_js_proxy", "napi_get_global");

  status = napi_call_function(env, global, js_callback, 1, &event_obj, NULL);
  // Don't fatal on JS exceptions — the JS side can handle them.
  (void)status;
}

// Called when the threadsafe function is fully finalized.
static void tsfn_finalize(napi_env env, void* finalize_data, void* finalize_hint) {
  (void)env;
  (void)finalize_data;
  (void)finalize_hint;
  threadsafe_fn = NULL;
}

napi_value AddonStart(napi_env env, napi_callback_info info) {
  napi_status status;

  size_t info_argc = 3;
  napi_value info_argv[3];
  status = napi_get_cb_info(env, info, &info_argc, info_argv, NULL, NULL);
  NAPI_THROW_IF_FAILED(env, status, NULL);

  if (info_argc < 3) {
    NAPI_THROW(env, "ERR_INVALID_ARG", "AddonStart requires 3 arguments", NULL);
  }

  if (threadsafe_fn != NULL) {
    napi_release_threadsafe_function(threadsafe_fn, napi_tsfn_abort);
    threadsafe_fn = NULL;
  }

  void* overlay_window_id = NULL;
  bool has_window_id;
  status = napi_is_buffer(env, info_argv[0], &has_window_id);
  NAPI_THROW_IF_FAILED(env, status, NULL);
  if (has_window_id) {
    status = napi_get_buffer_info(env, info_argv[0], &overlay_window_id, NULL);
    NAPI_THROW_IF_FAILED(env, status, NULL);
  }

  size_t target_window_title_length;
  status = napi_get_value_string_utf8(env, info_argv[1], NULL, 0, &target_window_title_length);
  NAPI_THROW_IF_FAILED(env, status, NULL);
  char* target_window_title = malloc(sizeof(char) * (target_window_title_length + 1));
  if (target_window_title == NULL) {
    NAPI_THROW(env, "ERR_NOMEM", "AddonStart: malloc failed for title", NULL);
  }
  status = napi_get_value_string_utf8(env, info_argv[1], target_window_title, target_window_title_length + 1, NULL);
  NAPI_THROW_IF_FAILED(env, status, NULL);

  napi_value async_resource_name;
  status = napi_create_string_utf8(env, "OVERLAY_WINDOW", NAPI_AUTO_LENGTH, &async_resource_name);
  NAPI_THROW_IF_FAILED(env, status, NULL);

  status = napi_create_threadsafe_function(
    env, info_argv[2], NULL, async_resource_name,
    0, 1,
    NULL, tsfn_finalize, NULL,
    tsfn_to_js_proxy,
    &threadsafe_fn);
  NAPI_THROW_IF_FAILED(env, status, NULL);

  ow_start_hook(target_window_title, overlay_window_id);

  return NULL;
}

napi_value AddonActivateOverlay(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  ow_activate_overlay();
  return NULL;
}

napi_value AddonFocusTarget(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  ow_focus_target();
  return NULL;
}

napi_value AddonScreenshot(napi_env env, napi_callback_info info) {
  (void)info;

#ifndef _WIN32
  napi_value empty;
  napi_create_buffer(env, 0, NULL, &empty);
  return empty;
#else
  napi_status status;

  uint32_t width  = last_reported_bounds.width;
  uint32_t height = last_reported_bounds.height;

  if (width == 0 || height == 0) {
    napi_value empty;
    napi_create_buffer(env, 0, NULL, &empty);
    return empty;
  }

  size_t size = (size_t)width * height * 4;
  napi_value img_buffer;
  uint8_t* img_data;
  status = napi_create_buffer(env, size, (void**)&img_data, &img_buffer);
  NAPI_FATAL_IF_FAILED(status, "AddonScreenshot", "napi_create_buffer");

  ow_screenshot(img_data, width, height);
  return img_buffer;
#endif
}

static void AddonCleanUp(void* arg) {
  (void)arg;
  if (threadsafe_fn != NULL) {
    napi_release_threadsafe_function(threadsafe_fn, napi_tsfn_abort);
    threadsafe_fn = NULL;
  }
}

NAPI_MODULE_INIT() {
  napi_status status;
  napi_value export_fn;

#define EXPORT_FN(name, fn)                                                          \
  do {                                                                               \
    status = napi_create_function(env, NULL, 0, fn, NULL, &export_fn);              \
    NAPI_FATAL_IF_FAILED(status, "NAPI_MODULE_INIT", "napi_create_function");       \
    status = napi_set_named_property(env, exports, name, export_fn);                \
    NAPI_FATAL_IF_FAILED(status, "NAPI_MODULE_INIT", "napi_set_named_property");    \
  } while (0)

  EXPORT_FN("start",           AddonStart);
  EXPORT_FN("activateOverlay", AddonActivateOverlay);
  EXPORT_FN("focusTarget",     AddonFocusTarget);
  EXPORT_FN("screenshot",      AddonScreenshot);

#undef EXPORT_FN

  status = napi_add_env_cleanup_hook(env, AddonCleanUp, NULL);
  NAPI_FATAL_IF_FAILED(status, "NAPI_MODULE_INIT", "napi_add_env_cleanup_hook");

  return exports;
}
