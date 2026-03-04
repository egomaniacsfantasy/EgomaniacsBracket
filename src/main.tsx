import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initAnalytics } from "./lib/analytics";

if (window.location.pathname === "/bracket") {
  window.history.replaceState({}, "", "/");
}

initAnalytics();

const path = window.location.pathname;

if (path === "/demo") {
  const { CascadeDemoPage } = await import("./CascadeDemoPage");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <CascadeDemoPage />
    </StrictMode>
  );
} else {
  const [{ default: App }, { AdminPage }, { AuthProvider }] = await Promise.all([
    import("./App"),
    import("./AdminPage"),
    import("./AuthContext"),
  ]);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AuthProvider>
        {path === "/admin" ? <AdminPage /> : <App />}
      </AuthProvider>
    </StrictMode>
  );
}
