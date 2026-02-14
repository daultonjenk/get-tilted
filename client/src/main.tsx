import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { BUILD_ID } from "./buildInfo";

console.info(`[get-tilted] build id: ${BUILD_ID}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
