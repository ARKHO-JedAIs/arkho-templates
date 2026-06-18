import { create } from "zustand";

type ThemeMode = "light" | "dark";

interface UiState {
  // Example client/global state (FR-008a): theme preference and a sidebar toggle.
  theme: ThemeMode;
  sidebarOpen: boolean;
  toggleTheme: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: "light",
  sidebarOpen: true,
  toggleTheme: () =>
    set((state) => ({ theme: state.theme === "light" ? "dark" : "light" })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
