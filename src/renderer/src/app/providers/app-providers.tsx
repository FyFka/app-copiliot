import { Toaster } from "sonner";

interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <>
      {children}
      <Toaster
        toastOptions={{
          className: "!bg-background !border !border-stroke-separator !text-foreground-primary !rounded-2xl",
        }}
        position="top-center"
      />
    </>
  );
}
