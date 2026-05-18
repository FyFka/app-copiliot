import { BrowserRouter, Route, Routes } from "react-router-dom";
import { MainLayout } from "../layouts/main-layout";
import { Home } from "@/pages";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Home />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
