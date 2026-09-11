import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../store/authStore";
import { useFamilyStore } from "../store/familyStore";
import { transactionService } from "../services/transactionService";
import { queryKeys } from "../lib/queryClient";

export function useBudget() {
  const token = useAuthStore((s) => s.token);
  const familyId = useFamilyStore((s) => s.familyId);

  const budgetsQuery = useQuery({
    queryKey: ["budgets", familyId],
    enabled: Boolean(token && familyId),
    queryFn: () => transactionService.listBudgets(familyId!, token!),
  });

  const dashboardQuery = useQuery({
    queryKey: familyId ? queryKeys.dashboard(familyId) : ["dashboard", "none"],
    enabled: Boolean(token && familyId),
    queryFn: () => transactionService.dashboard(familyId!, token!),
  });

  return {
    familyId,
    budgets: budgetsQuery.data,
    dashboard: dashboardQuery.data,
    isLoading: budgetsQuery.isLoading || dashboardQuery.isLoading,
    isError: budgetsQuery.isError || dashboardQuery.isError,
    refetch: async () => {
      await Promise.all([budgetsQuery.refetch(), dashboardQuery.refetch()]);
    },
  };
}
