#import "mac/OWFullscreenObserver.h"
#include "overlay_window.h"
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#import <array>
#import <string.h>

extern "C" {
AXError _AXUIElementGetWindow(AXUIElementRef, CGWindowID* out);
}

static void checkAndHandleWindow(pid_t pid, AXUIElementRef frontmostWindow);

struct ow_target_window {
  /** Heap-allocated copy of the target title; owned by this struct. */
  char*         title;
  /** -1 if not initialized yet */
  pid_t         pid;
  /** Window element matching the target title, or NULL */
  AXUIElementRef element;
  /** Observer that forwards all observed events to hookProcTargetWindow */
  AXObserverRef  observer;
  bool           isFocused;
  bool           isDestroyed;
  bool           isFullscreen;
};

struct ow_overlay_window {
  NSWindow* window;
};

struct ow_frontmost_app {
  /** -1 if not initialized */
  pid_t          pid;
  /** 0 if not initialized */
  CGWindowID     windowID;
  AXUIElementRef element;
  AXObserverRef  observer;
};

static struct ow_target_window targetInfo = {
  .title      = NULL,
  .pid        = -1,
  .element    = NULL,
  .observer   = NULL,
  .isFocused  = false,
  .isFullscreen = false,
};

static struct ow_overlay_window overlayInfo = { .window = NULL };

static struct ow_frontmost_app frontmostInfo = {
  .pid      = -1,
  .windowID = 0,
  .element  = NULL,
  .observer = NULL,
};

static OWFullscreenObserver* fullscreenObserver = NULL;

// Notifications attached to the target window (handled by hookProcTargetWindow).
static std::array<CFStringRef, 4> windowNotificationTypes = {
  kAXUIElementDestroyedNotification,
  kAXMovedNotification,
  kAXResizedNotification,
  kAXTitleChangedNotification,
};

// Notifications attached to the foreground (not necessarily target) app.
static std::array<CFStringRef, 5> appFocusNotificationTypes = {
  kAXFocusedWindowChangedNotification,
  kAXApplicationDeactivatedNotification,
  kAXApplicationHiddenNotification,
  kAXMainWindowChangedNotification,
  kAXWindowMiniaturizedNotification,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static AXUIElementRef copyFrontmostWindow(pid_t pid) {
  AXUIElementRef appElement = AXUIElementCreateApplication(pid);
  AXUIElementRef window = NULL;
  AXError error = AXUIElementCopyAttributeValue(
    appElement, kAXFocusedWindowAttribute, (CFTypeRef*)&window);
  CFRelease(appElement);
  return (error == kAXErrorSuccess) ? window : NULL;
}

static pid_t getFrontmostAppPID(void) {
  NSRunningApplication* app = [[NSWorkspace sharedWorkspace] frontmostApplication];
  return [app processIdentifier];
}

/**
 * Returns the CGWindowID (windowNumber) for a window element.
 * Returns 0 on failure (invalid per Apple docs).
 */
static CGWindowID getWindowID(AXUIElementRef window) {
  if (!window) return 0;
  CGWindowID windowID = 0;
  _AXUIElementGetWindow(window, &windowID);
  return windowID;
}

static NSString* getTitleForWindow(AXUIElementRef window) {
  CFStringRef cfTitle = NULL;
  AXError error = AXUIElementCopyAttributeValue(window, kAXTitleAttribute, (CFTypeRef*)&cfTitle);
  if (error != kAXErrorSuccess || cfTitle == NULL) return nil;
  return CFBridgingRelease(cfTitle);
}

static NSDictionary* getWindowInfo(CGWindowID windowID) {
  NSArray* windows = CFBridgingRelease(CGWindowListCopyWindowInfo(
    kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
    kCGNullWindowID));

  for (NSDictionary* info in windows) {
    NSNumber* windowNumber = info[(id)kCGWindowNumber];
    if ([windowNumber intValue] == (int)windowID) {
      return info;
    }
  }
  return nil;
}

static bool getBounds(CGWindowID windowID, ow_window_bounds* outputBounds) {
  if (windowID <= 0) return false;

  NSDictionary* windowInfo = getWindowInfo(windowID);
  if (!windowInfo) return false;

  NSDictionary* inputBounds = windowInfo[(id)kCGWindowBounds];
  if (!inputBounds) return false;

  NSNumber* x      = inputBounds[@"X"];
  NSNumber* y      = inputBounds[@"Y"];
  NSNumber* width  = inputBounds[@"Width"];
  NSNumber* height = inputBounds[@"Height"];

  if (!(x && y && width && height)) return false;

  *outputBounds = {
    .x      = [x intValue],
    .y      = [y intValue],
    .width  = static_cast<uint32_t>([width intValue]),
    .height = static_cast<uint32_t>([height intValue]),
  };
  return true;
}

static struct ow_window_bounds previousBounds = { .x = -1, .y = -1, .width = 0, .height = 0 };

static bool areBoundsEqual(const ow_window_bounds& lhs, const ow_window_bounds& rhs) {
  return lhs.x == rhs.x && lhs.y == rhs.y &&
         lhs.width == rhs.width && lhs.height == rhs.height;
}

static void maybeEmitMoveResizeEvent(CGWindowID windowID) {
  if (!targetInfo.element) return;
  if (windowID == 0 || windowID != getWindowID(targetInfo.element)) return;

  struct ow_window_bounds bounds;
  if (getBounds(windowID, &bounds) && !areBoundsEqual(bounds, previousBounds)) {
    struct ow_event e = { .type = OW_MOVERESIZE, .data.moveresize = { .bounds = bounds } };
    ow_emit_event(&e);
    previousBounds = bounds;
  }
}

static void handleFocusMaybeChanged(void) {
  pid_t pid = getFrontmostAppPID();
  AXUIElementRef frontmostWindow = copyFrontmostWindow(pid);
  checkAndHandleWindow(pid, frontmostWindow);
  if (frontmostWindow) CFRelease(frontmostWindow);
}

/**
 * Checks whether a given window is fullscreen by inspecting its y origin.
 * A y of 0 means the window starts at the very top of the screen (menu bar
 * hidden), which is the macOS fullscreen convention.
 */
static bool isFullscreen(CGWindowID targetWindowID) {
  ow_window_bounds bounds;
  return getBounds(targetWindowID, &bounds) && bounds.y == 0;
}

// ---------------------------------------------------------------------------
// AX Observers
// ---------------------------------------------------------------------------

static void hookProcFrontmostApplication(
  AXObserverRef observer, AXUIElementRef element,
  CFStringRef cfNotificationType, void* contextData
) {
  (void)observer; (void)element; (void)cfNotificationType; (void)contextData;
  handleFocusMaybeChanged();
}

static void hookProcTargetWindow(
  AXObserverRef observer, AXUIElementRef element,
  CFStringRef cfNotificationType, void* contextData
) {
  (void)observer; (void)contextData;
  NSString* notificationType = (__bridge NSString*)cfNotificationType;

  if ([notificationType isEqualToString:(__bridge NSString*)kAXMovedNotification] ||
      [notificationType isEqualToString:(__bridge NSString*)kAXResizedNotification]) {
    maybeEmitMoveResizeEvent(getWindowID(element));
    return;
  }

  if ([notificationType isEqualToString:(__bridge NSString*)kAXUIElementDestroyedNotification]) {
    targetInfo.isDestroyed = true;
    handleFocusMaybeChanged();
    return;
  }

  if ([notificationType isEqualToString:(__bridge NSString*)kAXTitleChangedNotification]) {
    NSString* title = getTitleForWindow(element);
    if (title) {
      char* old = targetInfo.title;
      targetInfo.title = strdup([title UTF8String]);
      // Free the previous copy only if it was itself heap-allocated
      // (i.e. set by a prior title-change, not the original ow_start_hook arg
      // which is also heap-allocated via malloc in addon.c).
      free(old);
    }
    return;
  }
}

template <std::size_t N>
static AXObserverRef createObserver(
  pid_t pid, AXUIElementRef element,
  std::array<CFStringRef, N> notificationTypes,
  bool isTargetWindow
) {
  AXObserverRef observer = NULL;
  AXError error = isTargetWindow
    ? AXObserverCreate(pid, hookProcTargetWindow, &observer)
    : AXObserverCreate(pid, hookProcFrontmostApplication, &observer);

  if (error != kAXErrorSuccess) return NULL;

  if (element) {
    for (auto& notificationType : notificationTypes) {
      AXObserverAddNotification(observer, element, notificationType, NULL);
    }
  }

  CFRunLoopAddSource(
    [[NSRunLoop currentRunLoop] getCFRunLoop],
    AXObserverGetRunLoopSource(observer),
    kCFRunLoopDefaultMode);

  return observer;
}

template <std::size_t N>
static void removeObserver(
  AXObserverRef observer, AXUIElementRef element,
  std::array<CFStringRef, N> notificationTypes
) {
  if (!observer) return;

  CFRunLoopRemoveSource(
    [[NSRunLoop currentRunLoop] getCFRunLoop],
    AXObserverGetRunLoopSource(observer),
    kCFRunLoopDefaultMode);

  if (element) {
    for (auto& notificationType : notificationTypes) {
      AXObserverRemoveNotification(observer, element, notificationType);
    }
  }
}

template <typename WindowInfo, std::size_t N>
static void clearWindowInfo(
  WindowInfo& windowInfo,
  std::array<CFStringRef, N> notificationTypes
) {
  if (windowInfo.observer) {
    removeObserver(windowInfo.observer, windowInfo.element, notificationTypes);
    CFRelease(windowInfo.observer);
    windowInfo.observer = NULL;
  }
  if (windowInfo.element) {
    CFRelease(windowInfo.element);
    windowInfo.element = NULL;
  }
}

template <typename WindowInfo, std::size_t N>
static void updateWindowInfo(
  pid_t pid, AXUIElementRef element, WindowInfo& windowInfo,
  std::array<CFStringRef, N> notificationTypes,
  bool isTargetWindow
) {
  clearWindowInfo(windowInfo, notificationTypes);
  windowInfo.element = element;
  CFRetain(windowInfo.element);
  windowInfo.observer = createObserver(pid, windowInfo.element, notificationTypes, isTargetWindow);
}

// ---------------------------------------------------------------------------
// Polling timer
// ---------------------------------------------------------------------------

static NSTimer* latestTimer = NULL;

/**
 * Polls for window changes for `secondsToPoll` seconds after we attach a new
 * observer or enter/exit fullscreen, because AX events may be delayed briefly.
 */
static void pollForWindowChanges(void) {
  NSTimeInterval secondsToPoll = 5.0;
  NSTimeInterval startTime = [[NSDate date] timeIntervalSince1970];

  if (latestTimer) {
    [latestTimer invalidate];
  }

  latestTimer = [NSTimer
    scheduledTimerWithTimeInterval:0.2
                           repeats:YES
                             block:^(NSTimer* timer) {
      NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
      if (now - startTime >= secondsToPoll) {
        [timer invalidate];
        if (timer == latestTimer) latestTimer = NULL;
        return;
      }
      handleFocusMaybeChanged();
    }];
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

static void checkAndHandleWindow(pid_t pid, AXUIElementRef frontmostWindow) {
  CGWindowID frontmostWindowID = getWindowID(frontmostWindow);
  CGWindowID targetWindowID    = getWindowID(targetInfo.element);
  CGWindowID overlayWindowID   = overlayInfo.window
    ? (CGWindowID)[overlayInfo.window windowNumber] : 0;

  bool targetFocused = (frontmostWindowID != 0) && (targetWindowID == frontmostWindowID);

  if (targetFocused && !targetInfo.isFocused) {
    targetInfo.isFocused = true;
    struct ow_event e = { .type = OW_FOCUS };
    ow_emit_event(&e);
  } else if (!targetFocused && targetInfo.isFocused) {
    // Stay focused if the overlay itself is frontmost.
    if (targetInfo.isDestroyed || frontmostWindowID != overlayWindowID) {
      targetInfo.isFocused = false;
      struct ow_event e = { .type = OW_BLUR };
      ow_emit_event(&e);
    }

    if (targetInfo.isDestroyed) {
      targetInfo.pid = -1;
      targetInfo.isDestroyed = false;
      clearWindowInfo(targetInfo, windowNotificationTypes);
      struct ow_event e = { .type = OW_DETACH };
      ow_emit_event(&e);
    }
  }

  // Emit fullscreen state change.
  bool fullscreen = isFullscreen(targetWindowID);
  if (fullscreen != targetInfo.isFullscreen) {
    targetInfo.isFullscreen = fullscreen;
    struct ow_event e = {
      .type = OW_FULLSCREEN,
      .data.fullscreen = { .is_fullscreen = fullscreen },
    };
    ow_emit_event(&e);
  }

  frontmostInfo.windowID = frontmostWindowID;

  // Re-attach focus/blur observers whenever the frontmost app changes.
  if (pid != frontmostInfo.pid) {
    frontmostInfo.pid = pid;
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    updateWindowInfo(pid, application, frontmostInfo, appFocusNotificationTypes,
                     /* isTargetWindow */ false);
    CFRelease(application); // updateWindowInfo retains it
    pollForWindowChanges();
  }

  // The rest only applies if the title matches.
  NSString* title = getTitleForWindow(frontmostWindow);
  if (!title || !targetInfo.title || ![title isEqualToString:@(targetInfo.title)]) {
    return;
  }

  // Emit move/resize while this window is frontmost (handles post-fullscreen animation).
  maybeEmitMoveResizeEvent(frontmostWindowID);

  // Nothing else to do if the target window hasn't changed.
  if (targetWindowID == frontmostWindowID) {
    return;
  }

  targetInfo.pid = pid;
  updateWindowInfo(pid, frontmostWindow, targetInfo, windowNotificationTypes,
                   /* isTargetWindow */ true);

  struct ow_event e = {
    .type = OW_ATTACH,
    .data.attach = { .has_access = -1, .is_fullscreen = (int)fullscreen },
  };
  if (getBounds(frontmostWindowID, &e.data.attach.bounds)) {
    ow_emit_event(&e);

    targetInfo.isFocused = true;
    e.type = OW_FOCUS;
    ow_emit_event(&e);
  } else {
    clearWindowInfo(targetInfo, windowNotificationTypes);
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

static void waitUntilAccessibilityGranted(void) {
  NSString* promptKey = (__bridge NSString*)kAXTrustedCheckOptionPrompt;
  bool trusted = AXIsProcessTrustedWithOptions(
    static_cast<CFDictionaryRef>(@{ promptKey : @YES }));

  while (!trusted) {
    [NSThread sleepForTimeInterval:1.0];
    trusted = AXIsProcessTrustedWithOptions(
      static_cast<CFDictionaryRef>(@{ promptKey : @NO }));
  }
}

static void observeFullscreen(void) {
  if (fullscreenObserver) return;

  fullscreenObserver = [OWFullscreenObserver alloc];
  void (^onPossibleFullscreen)(void) = ^{
    handleFocusMaybeChanged();
    pollForWindowChanges();
  };
  [fullscreenObserver addBlock:onPossibleFullscreen];

  [[NSApplication sharedApplication]
    addObserver:fullscreenObserver
     forKeyPath:@"currentSystemPresentationOptions"
        options:NSKeyValueObservingOptionNew
        context:NULL];

  [[[NSWorkspace sharedWorkspace] notificationCenter]
    addObserverForName:NSWorkspaceActiveSpaceDidChangeNotification
                object:NULL
                 queue:NULL
            usingBlock:^(NSNotification*) {
      handleFocusMaybeChanged();
      pollForWindowChanges();
    }];
}

static void observeActivateApplication(void) {
  [[[NSWorkspace sharedWorkspace] notificationCenter]
    addObserverForName:NSWorkspaceDidActivateApplicationNotification
                object:NULL
                 queue:NULL
            usingBlock:^(NSNotification*) {
      handleFocusMaybeChanged();
    }];
}

static void hookThread(void* _arg) {
  (void)_arg;

  observeFullscreen();
  observeActivateApplication();
  waitUntilAccessibilityGranted();
  handleFocusMaybeChanged();

  // Run the CFRunLoop so AXObservers added via CFRunLoopAddSource fire.
  CFRunLoopRun();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Safe to call repeatedly: the first call starts the hook thread, later calls
// only swap the target title (picked up on the next focus change). Spawning a
// thread per call would leak one on every window switch.
void ow_start_hook(char* target_window_title, void* overlay_window_id) {
  static bool hookStarted = false;
  static char* retiredTitle = NULL;

  // target_window_title is malloc'd in addon.c and owned by targetInfo. Freed
  // one generation late so the hook thread cannot be reading the pointer we are
  // replacing. See the Windows backend for the same reasoning.
  char* previousTitle = targetInfo.title;
  targetInfo.title = target_window_title;
  free(retiredTitle);
  retiredTitle = previousTitle;

  if (overlay_window_id != NULL) {
    NSView* __weak overlayView = *(NSView* __weak*)(overlay_window_id);
    overlayInfo.window = [overlayView window];
  }

  if (!hookStarted) {
    hookStarted = true;
    uv_thread_create(&hook_tid, hookThread, NULL);
  }
}

void ow_activate_overlay(void) {
  [[NSApplication sharedApplication] activateIgnoringOtherApps:YES];
}

void ow_focus_target(void) {
  if (targetInfo.pid < 0 || !targetInfo.element) return;

  AXUIElementRef app = AXUIElementCreateApplication(targetInfo.pid);
  AXUIElementSetAttributeValue(app, kAXFrontmostAttribute, kCFBooleanTrue);
  CFRelease(app);

  AXUIElementSetAttributeValue(targetInfo.element, kAXMainAttribute, kCFBooleanTrue);
}
