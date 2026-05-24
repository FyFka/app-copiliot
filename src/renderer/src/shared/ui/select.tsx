import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useTransitionStyles,
} from "@floating-ui/react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export const Select = ({
  options,
  value,
  onChange,
  prefix,
  btnClass,
  placeholder = "",
  children,
  autoWidth = false,
  noPlaceholder = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { x, y, refs, strategy, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip(),
      shift({ padding: 4 }),
      size({
        apply({ rects, elements }) {
          if (!autoWidth) {
            Object.assign(elements.floating.style, {
              width: `${rects.reference.width}px`,
            });
          }
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

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);
  const btnClassName =
    btnClass ??
    "rounded-2xl w-full flex gap-2 justify-center items-center border-none text-foreground-primary cursor-pointer";
  const { setFloating, setReference } = refs;
  return (
    <>
      <button ref={setReference} {...getReferenceProps()} className={btnClassName}>
        {prefix}
        {!noPlaceholder && <span>{value ? options.find((o) => o.value === value)?.label : placeholder}</span>}
        {children ? children : <ChevronDown height={18} width={18} className={isOpen ? "rotate-180" : ""} />}
      </button>

      <FloatingPortal id="modals">
        {isMounted && (
          <ul
            ref={setFloating}
            style={{ position: strategy, top: y ?? 0, left: x ?? 0, ...styles }}
            className="pointer-events-auto bg-background border border-stroke-separator text-foreground-primary text-sm rounded-2xl overflow-hidden m-0 list-none z-50 focus:outline-none"
            {...getFloatingProps()}
          >
            {options.map((option) => (
              <li
                key={option.value}
                className={`px-4 py-2.75 cursor-pointer font-medium hover:bg-secondary-background text-sm ${option.value === value ? "bg-secondary-background/85" : ""}`}
                onClick={(evt) => {
                  evt.stopPropagation();
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                {option.label}
              </li>
            ))}
          </ul>
        )}
      </FloatingPortal>
    </>
  );
};
