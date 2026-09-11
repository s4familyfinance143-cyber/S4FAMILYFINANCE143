import { api } from "./api";

export const transactionService = {
  list(familyId: string, token?: string) {
    return api.get(`/api/v1/transactions/${familyId}`, token);
  },

  createIncome(familyId: string, body: object, token?: string) {
    return api.post(`/api/v1/transactions/income?family_id=${familyId}`, body, token);
  },

  createExpense(familyId: string, body: object, token?: string) {
    return api.post(`/api/v1/transactions/expense?family_id=${familyId}`, body, token);
  },

  voidTransaction(transactionId: string, familyId: string, reason?: string, token?: string) {
    const q = new URLSearchParams({ family_id: familyId });
    if (reason) q.set("reason", reason);
    return api.post(`/api/v1/transactions/${transactionId}/void?${q.toString()}`, {}, token);
  },

  listAccounts(familyId: string, token?: string) {
    return api.get(`/api/v1/accounts/family/${familyId}`, token);
  },

  listBudgets(familyId: string, token?: string) {
    return api.get(`/api/v1/budgets/${familyId}`, token);
  },

  listLoans(familyId: string, token?: string) {
    return api.get(`/api/v1/loans/${familyId}`, token);
  },

  dashboard(familyId: string, token?: string) {
    return api.get(`/api/v1/dashboard/${familyId}`, token);
  },
};
