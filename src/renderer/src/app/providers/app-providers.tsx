import { Toaster } from "sonner";
import { VisibleProvider } from "./visible-provider";

interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <VisibleProvider>
      {children}
      <Toaster
        toastOptions={{
          className: "!bg-background !border !border-stroke-separator !text-foreground-primary !rounded-2xl",
        }}
        position="top-center"
      />
    </VisibleProvider>
  );
}
