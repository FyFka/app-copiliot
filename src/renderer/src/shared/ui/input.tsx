export const Input = ({ placeholder, value, onChange, children, label, type }) => {
  const hasValue = value !== "" && value !== undefined && value !== null;
  return (
    <label className="w-full">
      <div className="pl-3 bg-secondary-background rounded-2xl flex gap-2 relative">
        <div className="py-2.5 pr-3 w-full flex gap-1">
          {label && hasValue && (
            <span className="absolute left-3 pointer-events-none text-foreground-secondary font-medium transition-all duration-200 ease-out top-0 text-foreground-primary text-[10px] opacity-65">
              {label}
            </span>
          )}
          <input
            className="w-full appearance-none bg-transparent outline-none text-sm text-foreground-primary font-medium"
            autoComplete="off"
            autoCapitalize="off"
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            type={type}
          />
          {children}
        </div>
      </div>
    </label>
  );
};
