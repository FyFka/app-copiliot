/**
 * platform/mac/mac.mm
 *
 * macOS Accessibility API backend for the overlay-window hook.
 *
 */

#import "include/OWFullscreenObserver.h"
#include "../../core/overlay_window.h"
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#import <array>

extern "C" {
/**
 * Undocumented but widely-used SPI to retrieve a CGWindowID from an
 * AXUIElementRef.
 * https://stackoverflow.com/questions/7422666/uniquely-identify-active-window-on-os-x
 */
AXError _AXUIElementGetWindow(AXUIElementRef, CGWindowID *out);
}

static void checkAndHandleWindow(pid_t pid, AXUIElementRef frontmostWindow);

/* ── Types ──────────────────────────────────────────────────────────────── */

struct ow_target_window {
  const char    *title;
  bool           titleIsOwned; /**< true if title was strdup'd by us */
  pid_t          pid;
  AXUIElementRef element;
  AXObserverRef  observer;
  bool           isFocused;
  bool           isDestroyed;
  bool           isFullscreen;
};

struct ow_overlay_window {
  NSWindow *window;
};

struct ow_frontmost_app {
  pid_t          pid;
  CGWindowID     windowID;
  AXUIElementRef element;
  AXObserverRef  observer;
};

/* Module-level state */

uv_thread_t hook_tid;

static struct ow_target_window targetInfo = {
    .title        = NULL,
    .titleIsOwned = false,
    .pid          = -1,
    .element      = NULL,
    .observer     = NULL,
    .isFocused    = false,
    .isDestroyed  = false,
    .isFullscreen = false,
};

static struct ow_overlay_window overlayInfo = {.window = NULL};

static struct ow_frontmost_app frontmostInfo = {
    .pid = -1, .windowID = 0, .element = NULL, .observer = NULL};

static OWFullscreenObserver *fullscreenObserver = NULL;

static std::array<CFStringRef, 4> windowNotificationTypes = {
    kAXUIElementDestroyedNotification, kAXMovedNotification,
    kAXResizedNotification,            kAXTitleChangedNotification};

static std::array<CFStringRef, 5> appFocusNotificationTypes = {
    kAXFocusedWindowChangedNotification,
    kAXApplicationDeactivatedNotification,
    kAXApplicationHiddenNotification,
    kAXMainWindowChangedNotification,
    kAXWindowMiniaturizedNotification};

/* Helpers */

bool requestAccessibility(bool showDialog) {
  NSDictionary *opts = @{(__bridge id)(kAXTrustedCheckOptionPrompt) :
                             showDialog ? @YES : @NO};
  return AXIsProcessTrustedWithOptions(static_cast<CFDictionaryRef>(opts));
}

static AXUIElementRef copyFrontmostWindow(pid_t pid) {
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  AXUIElementRef window = NULL;
  AXError err = AXUIElementCopyAttributeValue(
      app, kAXFocusedWindowAttribute, (CFTypeRef *)&window);
  CFRelease(app);
  return (err == kAXErrorSuccess) ? window : NULL;
}

static pid_t getFrontmostAppPID(void) {
  return [[[NSWorkspace sharedWorkspace] frontmostApplication]
      processIdentifier];
}

static CGWindowID getWindowID(AXUIElementRef window) {
  if (!window) return 0;
  CGWindowID wid = 0;
  _AXUIElementGetWindow(window, &wid);
  return wid;
}

static NSString *getTitleForWindow(AXUIElementRef window) {
  CFStringRef cfTitle = NULL;
  AXError err = AXUIElementCopyAttributeValue(window, kAXTitleAttribute,
                                               (CFTypeRef *)&cfTitle);
  if (err != kAXErrorSuccess) return nil;
  return CFBridgingRelease(cfTitle);
}

static NSDictionary *getWindowInfo(CGWindowID windowID) {
  NSArray *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(
      kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
      kCGNullWindowID));
  for (NSDictionary *info in windows) {
    if ([(NSNumber *)info[(id)kCGWindowNumber] intValue] == (int)windowID)
      return info;
  }
  return nil;
}

static bool getBounds(CGWindowID windowID, ow_window_bounds *out) {
  if (windowID <= 0) return false;
  NSDictionary *info   = getWindowInfo(windowID);
  NSDictionary *bounds = info ? info[(id)kCGWindowBounds] : nil;
  if (!bounds) return false;

  NSNumber *x = bounds[@"X"], *y = bounds[@"Y"],
           *w = bounds[@"Width"], *h = bounds[@"Height"];
  if (!x || !y || !w || !h) return false;

  *out = {
      .x      = [x intValue],
      .y      = [y intValue],
      .width  = static_cast<uint32_t>([w intValue]),
      .height = static_cast<uint32_t>([h intValue]),
  };
  return true;
}

static struct ow_window_bounds previousBounds = {-1, -1, 0, 0};

static bool areBoundsEqual(const ow_window_bounds &a,
                            const ow_window_bounds &b) {
  return a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height;
}


static bool isFullscreen(CGWindowID /*targetWindowID*/) {
  NSApplicationPresentationOptions opts =
      [[NSApplication sharedApplication] currentSystemPresentationOptions];
  return (opts & NSApplicationPresentationFullScreen) != 0;
}

static void maybeEmitMoveResizeEvent(CGWindowID windowID) {
  if (!targetInfo.element) return;
  if (windowID != getWindowID(targetInfo.element)) return;

  struct ow_window_bounds bounds;
  if (getBounds(windowID, &bounds) && !areBoundsEqual(bounds, previousBounds)) {
    struct ow_event e = {.type = OW_MOVERESIZE, .data.moveresize = {bounds}};
    ow_emit_event(&e);
    previousBounds = bounds;
  }
}

/* Observer management */

template <std::size_t N>
static AXObserverRef createObserver(pid_t pid, AXUIElementRef element,
                                     std::array<CFStringRef, N> types,
                                     bool isTargetWindow);

static void hookProcFrontmostApplication(AXObserverRef, AXUIElementRef,
                                          CFStringRef, void *);
static void hookProcTargetWindow(AXObserverRef, AXUIElementRef,
                                  CFStringRef, void *);

template <std::size_t N>
static void removeObserver(AXObserverRef observer, AXUIElementRef element,
                            std::array<CFStringRef, N> types) {
  if (!observer) return;
  CFRunLoopRemoveSource([[NSRunLoop currentRunLoop] getCFRunLoop],
                        AXObserverGetRunLoopSource(observer),
                        kCFRunLoopDefaultMode);
  if (element) {
    for (auto &t : types) AXObserverRemoveNotification(observer, element, t);
  }
}

template <typename W, std::size_t N>
static void clearWindowInfo(W &wi, std::array<CFStringRef, N> types) {
  if (wi.observer) {
    removeObserver(wi.observer, wi.element, types);
    CFRelease(wi.observer);
    wi.observer = NULL;
  }
  if (wi.element) {
    CFRelease(wi.element);
    wi.element = NULL;
  }
}

template <typename W, std::size_t N>
static void updateWindowInfo(pid_t pid, AXUIElementRef element, W &wi,
                              std::array<CFStringRef, N> types,
                              bool isTargetWindow) {
  clearWindowInfo(wi, types);
  if (!element) return; /* BUG FIX: don't CFRetain NULL */

  wi.element = element;
  CFRetain(wi.element);
  wi.observer = createObserver(pid, wi.element, types, isTargetWindow);
}

template <std::size_t N>
static AXObserverRef createObserver(pid_t pid, AXUIElementRef element,
                                     std::array<CFStringRef, N> types,
                                     bool isTargetWindow) {
  AXObserverRef observer = NULL;
  AXError err = isTargetWindow
      ? AXObserverCreate(pid, hookProcTargetWindow, &observer)
      : AXObserverCreate(pid, hookProcFrontmostApplication, &observer);
  if (err != kAXErrorSuccess) return NULL;

  if (element) {
    for (auto &t : types) AXObserverAddNotification(observer, element, t, NULL);
  }
  CFRunLoopAddSource([[NSRunLoop currentRunLoop] getCFRunLoop],
                     AXObserverGetRunLoopSource(observer),
                     kCFRunLoopDefaultMode);
  return observer;
}

/* Polling timer */

static void handleFocusMaybeChanged(void);
static void pollForWindowChanges(void);

static NSTimer *latestTimer = nil;

static void pollForWindowChanges(void) {
  NSTimeInterval secondsToPoll = 5.0;
  NSTimeInterval startTime = [[NSDate date] timeIntervalSince1970];

  if (latestTimer) {
    [latestTimer invalidate];
    latestTimer = nil;
  }

  latestTimer = [NSTimer
      scheduledTimerWithTimeInterval:0.2
                             repeats:YES
                               block:^(NSTimer *timer) {
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    if (now - startTime >= secondsToPoll) {
      [timer invalidate];
      latestTimer = nil;
    }
    handleFocusMaybeChanged();
  }];
}

/* Hook callbacks */

static void hookProcFrontmostApplication(AXObserverRef, AXUIElementRef,
                                          CFStringRef, void *) {
  handleFocusMaybeChanged();
}

static void hookProcTargetWindow(AXObserverRef, AXUIElementRef element,
                                  CFStringRef cfType, void *) {
  NSString *type = (__bridge NSString *)cfType;

  if ([type isEqualToString:(__bridge NSString *)kAXMovedNotification] ||
      [type isEqualToString:(__bridge NSString *)kAXResizedNotification]) {
    maybeEmitMoveResizeEvent(getWindowID(element));
  }

  if ([type isEqualToString:(__bridge NSString *)
                kAXUIElementDestroyedNotification]) {
    targetInfo.isDestroyed = true;
    handleFocusMaybeChanged();
  }

  if ([type isEqualToString:(__bridge NSString *)kAXTitleChangedNotification]) {
    NSString *title = getTitleForWindow(element);
    if (title) {
      if (targetInfo.titleIsOwned) {
        free(const_cast<char *>(targetInfo.title));
      }
      targetInfo.title        = strdup([title UTF8String]);
      targetInfo.titleIsOwned = true;
    }
  }
}

/* Focus change handler */

static void handleFocusMaybeChanged(void) {
  pid_t pid = getFrontmostAppPID();
  AXUIElementRef window = copyFrontmostWindow(pid);
  checkAndHandleWindow(pid, window);
  if (window) CFRelease(window);
}

/* Core window-tracking logic */

static void checkAndHandleWindow(pid_t pid, AXUIElementRef frontmostWindow) {
  CGWindowID frontmostWindowID = getWindowID(frontmostWindow);
  CGWindowID targetWindowID    = getWindowID(targetInfo.element);
  CGWindowID overlayWindowID   =
      overlayInfo.window ? (CGWindowID)[overlayInfo.window windowNumber] : 0;

  bool targetFocused =
      frontmostWindowID != 0 && targetWindowID == frontmostWindowID;

  if (targetFocused && !targetInfo.isFocused) {
    targetInfo.isFocused = true;
    struct ow_event e = {.type = OW_FOCUS};
    ow_emit_event(&e);
  } else if (!targetFocused && targetInfo.isFocused) {
    if (targetInfo.isDestroyed || frontmostWindowID != overlayWindowID) {
      targetInfo.isFocused = false;
      struct ow_event e = {.type = OW_BLUR};
      ow_emit_event(&e);
    }
    if (targetInfo.isDestroyed) {
      targetInfo.pid       = -1;
      targetInfo.isDestroyed = false;
      struct ow_event e = {.type = OW_DETACH};
      clearWindowInfo(targetInfo, windowNotificationTypes);
      ow_emit_event(&e);
    }
  }

  bool fullscreen = isFullscreen(targetWindowID);
  if (fullscreen != targetInfo.isFullscreen) {
    targetInfo.isFullscreen = fullscreen;
    struct ow_event e = {.type      = OW_FULLSCREEN,
                         .data.fullscreen = {fullscreen}};
    ow_emit_event(&e);
  }

  frontmostInfo.windowID = frontmostWindowID;
  if (pid != frontmostInfo.pid) {
    frontmostInfo.pid = pid;
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    updateWindowInfo(pid, app, frontmostInfo, appFocusNotificationTypes,
                     /* isTargetWindow */ false);
    CFRelease(app);
    pollForWindowChanges();
  }

  NSString *title = getTitleForWindow(frontmostWindow);
  if (!title || ![title isEqualToString:@(targetInfo.title)]) return;

  maybeEmitMoveResizeEvent(frontmostWindowID);

  if (targetWindowID == frontmostWindowID) return;

  targetInfo.pid = pid;
  updateWindowInfo(pid, frontmostWindow, targetInfo, windowNotificationTypes,
                   /* isTargetWindow */ true);

  struct ow_event e = {
      .type       = OW_ATTACH,
      .data.attach = {.has_access = -1, .is_fullscreen = (int)fullscreen},
  };
  if (getBounds(frontmostWindowID, &e.data.attach.bounds)) {
    ow_emit_event(&e);
    targetInfo.isFocused = true;
    e.type = OW_FOCUS;
    ow_emit_event(&e);
  }
  /* If getBounds failed: window died right after becoming active – no-op */
}

/* Startup helpers */

static void waitUntilAccessibilityGranted(void) {
  NSString *key = (__bridge NSString *)kAXTrustedCheckOptionPrompt;
  bool trusted  = AXIsProcessTrustedWithOptions(
      static_cast<CFDictionaryRef>(@{key : @YES}));
  while (!trusted) {
    [NSThread sleepForTimeInterval:1.0];
    trusted = AXIsProcessTrustedWithOptions(
        static_cast<CFDictionaryRef>(@{key : @NO}));
  }
}

static void observeFullscreen(void) {
  if (fullscreenObserver) return;

  fullscreenObserver = [OWFullscreenObserver alloc];
  [fullscreenObserver addBlock:^{
    handleFocusMaybeChanged();
    pollForWindowChanges();
  }];

  [[NSApplication sharedApplication]
      addObserver:fullscreenObserver
       forKeyPath:@"currentSystemPresentationOptions"
          options:NSKeyValueObservingOptionNew
          context:NULL];

  [[[NSWorkspace sharedWorkspace] notificationCenter]
      addObserverForName:NSWorkspaceActiveSpaceDidChangeNotification
                  object:nil queue:nil
              usingBlock:^(NSNotification *) {
                handleFocusMaybeChanged();
                pollForWindowChanges();
              }];
}

static void observeActivateApplication(void) {
  [[[NSWorkspace sharedWorkspace] notificationCenter]
      addObserverForName:NSWorkspaceDidActivateApplicationNotification
                  object:nil queue:nil
              usingBlock:^(NSNotification *) {
                handleFocusMaybeChanged();
              }];
}

static void hookThread(void *) {
  observeFullscreen();
  observeActivateApplication();
  waitUntilAccessibilityGranted();
  handleFocusMaybeChanged();
  CFRunLoopRun();
}

/* Public API */

void ow_start_hook(char *target_window_title, void *overlay_window_id) {
  targetInfo.title        = target_window_title;
  targetInfo.titleIsOwned = false; /* caller owns the initial string */

  if (overlay_window_id != NULL) {
    NSView   *view   = *(NSView * __weak *)(overlay_window_id);
    overlayInfo.window = [view window];
  }
  uv_thread_create(&hook_tid, hookThread, NULL);
}

void ow_activate_overlay(void) {
  [[NSApplication sharedApplication] activateIgnoringOtherApps:YES];
}

void ow_focus_target(void) {
  if (targetInfo.pid < 0 || !targetInfo.element) return;

  /* BUG FIX: CFRelease the AXUIElement created here */
  AXUIElementRef app = AXUIElementCreateApplication(targetInfo.pid);
  AXUIElementSetAttributeValue(app, kAXFrontmostAttribute, kCFBooleanTrue);
  CFRelease(app);

  AXUIElementSetAttributeValue(targetInfo.element, kAXMainAttribute,
                                kCFBooleanTrue);
}
