import { Outlet } from "react-router-dom";

export const MainLayout = () => {
  return (
    // pointer-events-none keeps document.elementFromPoint from reporting the
    // full-screen shell as interactive, so only the panel blocks click-through.
    <div className="h-dvh w-dvw flex flex-col pointer-events-none">
      <div className="flex grow flex-col relative overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
};
