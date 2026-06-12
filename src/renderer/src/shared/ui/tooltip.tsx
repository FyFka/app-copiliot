import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useFloating,
  useHover,
  useInteractions,
  useTransitionStyles,
  safePolygon,
  type Placement,
} from "@floating-ui/react";
import { useState, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  placement?: Placement;
  maxWidth?: number;
  children: ReactNode;
}

export const Tooltip = ({ content, placement = "bottom", maxWidth = 420, children }: TooltipProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { x, y, refs, strategy, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 4 }),
      size({
        padding: 4,
        apply({ availableWidth, elements }) {
          elements.floating.style.maxWidth = `${Math.min(availableWidth, maxWidth)}px`;
        },
      }),
    ],
  });

  const { isMounted, styles } = useTransitionStyles(context, {
    duration: 150,
    initial: { opacity: 0 },
    open: { opacity: 1 },
    close: { opacity: 0 },
  });

  const hover = useHover(context, {
    move: false,
    handleClose: safePolygon({
      blockPointerEvents: true,
    }),
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover]);
  const { setFloating, setReference } = refs;
  return (
    <>
      <span className="inline-block" ref={setReference} {...getReferenceProps()}>
        {children}
      </span>
      <FloatingPortal id="tooltips">
        {isMounted && (
          <div
            data-testid="tooltip"
            ref={setFloating}
            style={{
              position: strategy,
              top: y ?? 0,
              left: x ?? 0,
              width: "max-content",
              maxWidth: "calc(100vw - 16px)",
              ...styles,
            }}
            className="bg-background text-foreground-primary border border-stroke-separator text-sm font-semibold rounded-2xl px-3 py-1.5 z-1000"
            {...getFloatingProps()}
          >
            {content}
          </div>
        )}
      </FloatingPortal>
    </>
  );
};
