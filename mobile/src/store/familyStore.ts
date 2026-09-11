import { create } from "zustand";
import { fastStorage } from "../lib/fastStorage";

const FAMILY_KEY = "s4_family_id";

export type FamilySummary = {
  id: string;
  name: string;
  default_currency?: string;
  timezone?: string;
  role?: string;
};

type FamilyStore = {
  familyId: string | null;
  families: FamilySummary[];
  setFamilyId: (familyId: string | null) => void;
  setFamilies: (families: FamilySummary[]) => void;
  hydrateFromStorage: () => void;
};

export const useFamilyStore = create<FamilyStore>((set) => ({
  familyId: null,
  families: [],
  setFamilyId: (familyId) => {
    if (familyId) fastStorage.set(FAMILY_KEY, familyId);
    else fastStorage.delete(FAMILY_KEY);
    set({ familyId });
  },
  setFamilies: (families) => set({ families }),
  hydrateFromStorage: () => {
    const familyId = fastStorage.getString(FAMILY_KEY) || null;
    set({ familyId });
  },
}));
