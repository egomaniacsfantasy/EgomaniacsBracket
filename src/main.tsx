import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AdminPage } from "./AdminPage";
import { initAnalytics } from "./lib/analytics";
import { AuthProvider } from "./AuthContext";

if (window.location.pathname === "/bracket") {
  window.history.replaceState({}, "", "/");
}

initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      {window.location.pathname === "/admin" ? <AdminPage /> : <App />}
    </AuthProvider>
  </StrictMode>
);
