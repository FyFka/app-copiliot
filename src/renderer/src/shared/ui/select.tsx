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
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  prefix?: ReactNode;
  btnClass?: string;
  placeholder?: string;
  children?: ReactNode;
  autoWidth?: boolean;
  noPlaceholder?: boolean;
}

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
}: SelectProps) => {
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
  // A stored value can outlive the option list (a renamed model, a provider that
  // no longer offers it), so fall back to the raw value rather than rendering an
  // empty button.
  const selectedLabel = options.find((option) => option.value === value)?.label || value || placeholder;

  return (
    <>
      <button ref={setReference} {...getReferenceProps()} className={btnClassName}>
        {prefix}
        {!noPlaceholder && <span className="truncate">{selectedLabel}</span>}
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
