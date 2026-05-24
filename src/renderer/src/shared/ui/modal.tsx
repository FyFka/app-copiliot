import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useClick,
  useDismiss,
  useFloating,
  useId,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { X } from "lucide-react";

export const Modal = ({ title, children, isOpen, onOpenChange }) => {
  const headingId = useId();
  const descriptionId = useId();

  const { refs, context } = useFloating({ open: isOpen, onOpenChange });
  const click = useClick(context);
  const dismiss = useDismiss(context, { outsidePressEvent: "mousedown" });
  const role = useRole(context);
  const { getFloatingProps } = useInteractions([click, dismiss, role]);
  const handleClose = () => onOpenChange(false);

  if (!isOpen) return null;

  const { setFloating } = refs;
  return (
    <FloatingPortal id="modals">
      <FloatingOverlay lockScroll className="bg-basic-alpha flex items-center justify-center z-10 fixed inset-0">
        <FloatingFocusManager context={context}>
          <div className="relative flex items-center justify-center w-full h-full p-2">
            <div
              ref={setFloating}
              aria-labelledby={headingId}
              aria-describedby={descriptionId}
              {...getFloatingProps()}
              className="p-1 max-h-full w-full max-w-5xl"
            >
              <div className="relative bg-background-content border border-stroke-separator p-6 md:p-8 rounded-2xl flex flex-col">
                <div className="flex justify-between gap-1 mb-2">
                  {title && (
                    <h2 id={headingId} className="font-bold text-base text-foreground-primary">
                      {title}
                    </h2>
                  )}
                  <button
                    className="h-8 w-8 min-w-8 min-h-8 z-50 flex items-center justify-center cursor-pointer bg-secondary-background text-foreground-primary rounded-full"
                    onClick={handleClose}
                    aria-label="Close"
                  >
                    <X height={16} width={16} />
                  </button>
                </div>
                <div id={descriptionId} className="overflow-y-auto">
                  {children}
                </div>
              </div>
            </div>
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
};
