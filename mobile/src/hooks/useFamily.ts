import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../store/authStore";
import { useFamilyStore } from "../store/familyStore";
import { api } from "../services/api";
import { queryKeys } from "../lib/queryClient";

export function useFamily() {
  const token = useAuthStore((s) => s.token);
  const familyId = useFamilyStore((s) => s.familyId);
  const families = useFamilyStore((s) => s.families);
  const setFamilyId = useFamilyStore((s) => s.setFamilyId);
  const setFamilies = useFamilyStore((s) => s.setFamilies);

  const familiesQuery = useQuery({
    queryKey: queryKeys.families,
    enabled: Boolean(token),
    queryFn: async () => {
      const rows = await api.get("/api/v1/families", token);
      const list = Array.isArray(rows) ? rows : rows?.families || [];
      setFamilies(list);
      if (!familyId && list[0]?.id) setFamilyId(list[0].id);
      return list;
    },
  });

  const active = (familiesQuery.data || families).find((f: any) => f.id === familyId) || null;

  return {
    familyId,
    families: familiesQuery.data || families,
    activeFamily: active,
    setFamilyId,
    isLoading: familiesQuery.isLoading,
    refetch: familiesQuery.refetch,
    currency: active?.default_currency || "BDT",
  };
}
