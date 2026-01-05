#import "include/OWFullscreenObserver.h"

@implementation OWFullscreenObserver

- (void)addBlock:(FullscreenBlock)fullscreenBlock {
  self.fullscreenBlock = fullscreenBlock;
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context {
  (void)keyPath; (void)object; (void)change; (void)context;

  if (self.fullscreenBlock) {
    self.fullscreenBlock();
  }
}

@end
