import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initAnalytics } from "./lib/analytics";
import { initErrorMonitoring } from "./lib/errorMonitoring";

if (window.location.pathname === "/bracket") {
  window.history.replaceState({}, "", "/");
}

initAnalytics();
initErrorMonitoring();

const path = window.location.pathname;

if (path === "/demo") {
  const { CascadeDemoPage } = await import("./CascadeDemoPage");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <CascadeDemoPage />
    </StrictMode>
  );
} else if (path === "/rankings") {
  const { RankingsPage } = await import("./RankingsPage");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RankingsPage />
    </StrictMode>
  );
} else if (path === "/predictor") {
  const { PredictorPage } = await import("./PredictorPage");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PredictorPage />
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
