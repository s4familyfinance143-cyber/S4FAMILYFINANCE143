// Client for the FastAPI auth backend.
// Same-site (localhost) so the httpOnly refresh cookie flows with credentials.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8001/api";

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
};

export type Profile = {
  full_name: string | null;
  organization: string | null;
  country: string | null;
};

export type CurrentUser = {
  id: string;
  email: string;
  phone: string | null;
  is_verified: boolean;
  created_at: string;
  profile: Profile | null;
};

export type SessionInfo = {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
};

export type SupportTicketMessage = {
  id: string;
  author_type: string;
  body: string;
  created_at: string;
};

export type SupportTicket = {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  product_slug: string | null;
  platform: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportTicketDetail = SupportTicket & {
  messages: SupportTicketMessage[];
};

export type CustomerLicense = {
  id: string;
  order_id: string | null;
  product_slug: string;
  plan: string;
  license_key: string;
  status: string;
  seats: number;
  active_activation_count: number;
  download_url: string | null;
  issued_at: string;
  expires_at: string | null;
};

export type LicenseActivation = {
  id: string;
  license_id: string;
  device_label: string | null;
  platform: string | null;
  status: string;
  activated_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

export type AdminLicense = CustomerLicense & {
  user_id: string;
  user_email: string;
  created_at: string;
  updated_at: string;
};

export type CustomerOrder = {
  id: string;
  order_number: string;
  status: string;
  product_slug: string;
  plan: string;
  amount: string;
  currency: string;
  payment_method: string;
  payment_reference: string | null;
  notes: string | null;
  paid_at: string | null;
  created_at: string;
};

export type OrderReceipt = {
  order: CustomerOrder;
  customer: {
    email: string;
    full_name: string | null;
    organization: string | null;
    country: string | null;
    phone: string | null;
  };
  licenses: Array<{
    id: string;
    product_slug: string;
    plan: string;
    license_key: string;
    status: string;
    seats: number;
    expires_at: string | null;
  }>;
  receipt_number: string;
  issued_at: string;
  seller_name: string;
  seller_email: string;
};

export type AdminOrder = CustomerOrder & {
  user_id: string;
  user_email: string;
  updated_at: string;
};

export type AdminCustomerProfile = {
  full_name: string | null;
  organization: string | null;
  country: string | null;
};

export type AdminCustomer = {
  id: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  is_verified: boolean;
  locked_until: string | null;
  profile: AdminCustomerProfile | null;
  license_count: number;
  order_count: number;
  ticket_count: number;
  created_at: string;
  updated_at: string;
};

export type AdminCustomerDetail = AdminCustomer & {
  licenses: Array<{
    id: string;
    order_id: string | null;
    product_slug: string;
    plan: string;
    license_key: string;
    status: string;
    seats: number;
    expires_at: string | null;
    created_at: string;
  }>;
  orders: Array<{
    id: string;
    order_number: string;
    status: string;
    product_slug: string;
    plan: string;
    amount: string;
    currency: string;
    payment_method: string;
    payment_reference: string | null;
    created_at: string;
  }>;
  tickets: Array<{
    id: string;
    subject: string;
    category: string;
    priority: string;
    status: string;
    product_slug: string | null;
    created_at: string;
    updated_at: string;
  }>;
};

export type PublicRelease = {
  id: string;
  product_slug: string;
  platform: string;
  version: string;
  channel: string;
  status: string;
  file_name: string;
  file_size: string | null;
  sha256: string | null;
  release_notes: string | null;
  requires_license: boolean;
  published_at: string | null;
  created_at: string;
};

export type CustomerRelease = PublicRelease & {
  download_url: string | null;
  access: "licensed" | "public";
};

export type AdminRelease = PublicRelease & {
  download_url: string | null;
  storage_path: string | null;
  is_active: boolean;
  updated_at: string;
};

export type AdminDashboard = {
  metrics: {
    total_customers: number;
    active_customers: number;
    unverified_customers: number;
    active_licenses: number;
    paid_orders: number;
    pending_orders: number;
    open_tickets: number;
    available_releases: number;
  };
  recent_customers: Array<{
    id: string;
    email: string;
    full_name: string | null;
    is_active: boolean;
    is_verified: boolean;
    created_at: string;
  }>;
  recent_orders: Array<{
    id: string;
    user_email: string;
    order_number: string;
    status: string;
    amount: string;
    currency: string;
    created_at: string;
  }>;
  recent_tickets: Array<{
    id: string;
    user_email: string;
    subject: string;
    priority: string;
    status: string;
    updated_at: string;
  }>;
  recent_releases: Array<{
    id: string;
    product_slug: string;
    platform: string;
    version: string;
    status: string;
    is_active: boolean;
    updated_at: string;
  }>;
};

export type AdminEvent = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  event_type: string;
  ip: string | null;
  user_agent: string | null;
  detail: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export type PurchaseRequest = {
  id: string;
  product_slug: string;
  plan: string;
  amount: string | null;
  currency: string;
  payment_method: string | null;
  payment_reference: string | null;
  customer_notes: string | null;
  admin_notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type AdminPurchaseRequest = PurchaseRequest & {
  user_id: string;
  user_email: string;
};

export type PaymentTransaction = {
  id: string;
  order_id: string | null;
  purchase_request_id: string | null;
  provider: string;
  provider_payment_id: string | null;
  reference: string | null;
  method: string | null;
  status: string;
  amount: string;
  currency: string;
  notes: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminPaymentTransaction = PaymentTransaction & {
  user_id: string;
  user_email: string;
  raw_payload: Record<string, unknown> | null;
};

export type PaymentCheckoutResult = {
  payment: PaymentTransaction;
  provider: string;
  checkout_url: string | null;
  instructions: string | null;
};

type Options = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

function extractError(data: unknown): string | null {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length && typeof d[0] === "object") {
      const first = d[0] as { msg?: string };
      if (first.msg) return first.msg;
    }
  }
  return null;
}

export async function apiFetch<T>(
  path: string,
  { method = "GET", body, token }: Options = {}
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "Cannot reach the server. Please try again.",
    };
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    data: (data as T) ?? null,
    error: res.ok ? null : extractError(data) ?? "Request failed.",
  };
}
