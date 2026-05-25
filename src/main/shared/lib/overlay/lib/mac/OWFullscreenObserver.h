#import <Foundation/Foundation.h>

typedef void (^FullscreenBlock)(void);

NS_ASSUME_NONNULL_BEGIN

@interface OWFullscreenObserver : NSObject

@property(copy) FullscreenBlock fullscreenBlock;

- (void)addBlock:(FullscreenBlock)fullscreenBlock;

@end

NS_ASSUME_NONNULL_END
