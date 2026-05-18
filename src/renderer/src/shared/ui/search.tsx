import { SearchIcon } from "lucide-react";
import { debounce } from "@/shared";
import { useMemo } from "react";

export const Search = ({
  placeholder = "Search by name",
  onChange,
  labelClass = "pl-3 bg-secondary-background rounded-2xl flex gap-2 text-foreground-primary",
}) => {
  const handleChange = useMemo(
    () =>
      debounce((evt) => {
        onChange(evt);
      }, 300),
    [onChange],
  );

  return (
    <label className={labelClass}>
      <div className="flex items-center justify-center text-foreground">
        <SearchIcon />
      </div>
      <div className="py-2.5 pr-3 w-full">
        <input
          className="w-full appearance-none bg-transparent outline-none text-sm font-medium"
          autoComplete="off"
          autoCapitalize="off"
          placeholder={placeholder}
          onChange={handleChange}
        />
      </div>
    </label>
  );
};
