import "@/shared";
import { AppProviders } from "./providers/app-providers";
import { AppRouter } from "./router/app-router";
import "./styles/fonts.css";
import "./styles/theme.css";

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
