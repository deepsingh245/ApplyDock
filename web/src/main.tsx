// The extension bridge must register its window listeners before anything renders.
import "./bridge/extension";
import "./styles/globals.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { queryClient } from "@/api/state";
import { DialogsProvider } from "@/components/ui/confirm";
import { Toaster } from "@/components/ui/toaster";
import { initTheme } from "@/lib/theme";
import { router } from "./app/router";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DialogsProvider>
        <RouterProvider router={router} />
        <Toaster />
      </DialogsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
