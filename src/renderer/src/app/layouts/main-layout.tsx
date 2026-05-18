import { Outlet } from "react-router-dom";

export const MainLayout = () => {
  return (
    <div className="h-dvh mx-auto my-0 flex flex-col">
      <div className="flex grow flex-col relative overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
};
