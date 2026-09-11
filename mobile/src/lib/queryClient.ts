import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  families: ["families"] as const,
  dashboard: (familyId: string) => ["dashboard", familyId] as const,
  health: ["health"] as const,
};
