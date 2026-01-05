#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^FullscreenBlock)(void);

/**
 * A minimal KVO observer that forwards key-value change notifications to a
 * stored block.  Used by the macOS backend to watch
 * `NSApplication.currentSystemPresentationOptions`.
 */
@interface OWFullscreenObserver : NSObject

/** The block invoked on every observed change. */
@property (nonatomic, copy, nullable) FullscreenBlock fullscreenBlock;

/** Register the block to be called on KVO notifications. */
- (void)addBlock:(FullscreenBlock)fullscreenBlock;

@end

NS_ASSUME_NONNULL_END
