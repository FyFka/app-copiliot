#ifndef ADDON_SRC_NAPI_HELPERS_H_
#define ADDON_SRC_NAPI_HELPERS_H_

#include <node_api.h>

/* ── Internal: build a pending JS Error from the last napi failure ────── */
napi_value error_create(napi_env env);

/* ── Fatal abort on unexpected napi errors ───────────────────────────── */

/**
 * If @p status is not napi_ok, call napi_fatal_error with @p location and
 * @p message.  Use this for errors that are truly unrecoverable (e.g. during
 * module initialisation).
 */
#define NAPI_FATAL_IF_FAILED(status, location, message)        \
  do {                                                         \
    if ((status) != napi_ok) {                                 \
      napi_fatal_error((location), NAPI_AUTO_LENGTH,           \
                       (message),  NAPI_AUTO_LENGTH);          \
    }                                                          \
  } while (0)

/* ── Throw a pending JS exception and return from the current C function  */

/**
 * If @p status is not napi_ok, throw a JS exception (built from the current
 * napi extended error info) and return void.
 */
#define NAPI_THROW_IF_FAILED_VOID(env, status)                 \
  do {                                                         \
    if ((status) != napi_ok) {                                 \
      NAPI_FATAL_IF_FAILED(                                    \
          napi_throw((env), error_create(env)),                \
          "NAPI_THROW_IF_FAILED_VOID", "napi_throw");          \
      return;                                                  \
    }                                                          \
  } while (0)

/**
 * If @p status is not napi_ok, throw a JS exception and return @p retval.
 * Pass nothing after the status to return void (prefer NAPI_THROW_IF_FAILED_VOID
 * in that case for clarity).
 */
#define NAPI_THROW_IF_FAILED(env, status, retval)              \
  do {                                                         \
    if ((status) != napi_ok) {                                 \
      NAPI_FATAL_IF_FAILED(                                    \
          napi_throw((env), error_create(env)),                \
          "NAPI_THROW_IF_FAILED", "napi_throw");               \
      return (retval);                                         \
    }                                                          \
  } while (0)

/**
 * Throw a JS Error with an explicit string code and message, then return void.
 */
#define NAPI_THROW_VOID(env, code, msg)                        \
  do {                                                         \
    NAPI_FATAL_IF_FAILED(                                      \
        napi_throw_error((env), (code), (msg)),                \
        "NAPI_THROW_VOID", "napi_throw_error");                \
    return;                                                    \
  } while (0)

/**
 * Throw a JS Error with an explicit string code and message, then return
 * @p retval.
 */
#define NAPI_THROW(env, code, msg, retval)                     \
  do {                                                         \
    NAPI_FATAL_IF_FAILED(                                      \
        napi_throw_error((env), (code), (msg)),                \
        "NAPI_THROW", "napi_throw_error");                     \
    return (retval);                                           \
  } while (0)

#endif /* ADDON_SRC_NAPI_HELPERS_H_ */
