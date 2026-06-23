import { ErrorBoundary } from "@/components/error-boundary";
import { router } from "@/lib/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { platform } from "@tauri-apps/plugin-os";
import React from "react";
import ReactDOM from "react-dom/client";
import "@/styles/globals.css";

function detectMac(): boolean {
  try {
    const p = platform();
    if (p === "macos") return true;
  } catch {
    /* not in tauri */
  }
  if (typeof navigator !== "undefined" && /Mac/.test(navigator.platform)) return true;
  return false;
}
if (detectMac()) {
  document.documentElement.classList.add("has-vibrancy");
  console.log("[reviewly] mac detected — vibrancy class applied");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 10_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
