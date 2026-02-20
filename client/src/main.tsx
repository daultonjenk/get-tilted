import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { BUILD_ID } from "./buildInfo";

console.info(`[get-tilted] build id: ${BUILD_ID}`);

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("[get-tilted] service worker registration failed", error);
    });
  });
}

if (import.meta.env.PROD) {
  registerServiceWorker();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
