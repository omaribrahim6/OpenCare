// Capital One Nessie client (mock banking, SPEC §8). Server-only: the API key goes in the query
// string, so never log request URLs and never send this client's errors to the browser verbatim.

import { CoreError } from "@abdulcare/core";
import { centsToDollars, nessieDate } from "./money";

export const NESSIE_BASE_URL = "https://api.nessieisreal.com";

export interface NessieAddress {
  street_number: string;
  street_name: string;
  city: string;
  state: string;
  zip: string;
}

export interface NessieCustomer {
  _id: string;
  first_name: string;
  last_name: string;
  address?: NessieAddress;
}

export interface NessieAccount {
  _id: string;
  type: "Checking" | "Savings" | "Credit Card";
  nickname: string;
  rewards: number;
  /** Dollars. */
  balance: number;
  customer_id: string;
}

export interface NessieMerchant {
  _id: string;
  name: string;
  category?: string | string[];
}

export type NessieBillStatus = "pending" | "cancelled" | "completed" | "recurring";

export interface NessieBill {
  _id: string;
  status: NessieBillStatus;
  payee: string;
  nickname?: string;
  creation_date?: string;
  payment_date?: string;
  /** Dollars. */
  payment_amount: number;
  account_id?: string;
}

export interface NessiePurchase {
  _id: string;
  merchant_id: string;
  medium: "balance" | "rewards";
  purchase_date?: string;
  /** Dollars. */
  amount: number;
  status: string;
  description?: string;
  payer_id?: string;
}

export interface NessieDeposit {
  _id: string;
  medium: "balance" | "rewards";
  transaction_date?: string;
  status: string;
  /** Dollars. */
  amount: number;
  description?: string;
  payee_id?: string;
}

/**
 * A failed Nessie call. `uncertain` means a write may or may not have happened (timeout, network
 * error, 5xx): reconcile by reading back before trying again (SPEC §8).
 */
export class NessieError extends CoreError {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly uncertain: boolean,
  ) {
    super("upstream_error", message);
    this.name = "NessieError";
  }
}

export interface NessieOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

type Method = "GET" | "POST" | "PUT";

export class NessieClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly merchantNames = new Map<string, string>();

  constructor(options: NessieOptions) {
    if (!options.apiKey) throw new Error("NESSIE_API_KEY is not set");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? NESSIE_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchFn = options.fetch ?? fetch;
  }

  /** Client from env: NESSIE_API_KEY and optional NESSIE_BASE_URL. */
  static fromEnv(): NessieClient {
    return new NessieClient({
      apiKey: process.env.NESSIE_API_KEY ?? "",
      baseUrl: process.env.NESSIE_BASE_URL || undefined,
    });
  }

  private async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(this.apiKey)}`;
    const label = `Nessie ${method} ${path}`; // never includes the key
    const isWrite = method !== "GET";
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new NessieError(`${label} did not respond`, null, isWrite);
    }

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    // Nessie sometimes reports errors in the body with a 200, as { code, message }.
    const bodyCode = typeof data === "object" && data !== null ? (data as { code?: unknown }).code : undefined;
    const status = !res.ok ? res.status : typeof bodyCode === "number" && bodyCode >= 400 ? bodyCode : null;
    if (status !== null) {
      throw new NessieError(`${label} failed with ${status}`, status, isWrite && status >= 500);
    }
    // Creates come back wrapped: { code: 201, message, objectCreated }.
    if (typeof data === "object" && data !== null && "objectCreated" in data) {
      return (data as { objectCreated: T }).objectCreated;
    }
    return data as T;
  }

  // Customers and accounts (seed script)

  listCustomers(): Promise<NessieCustomer[]> {
    return this.request("GET", "/customers");
  }

  createCustomer(input: { firstName: string; lastName: string; address: NessieAddress }): Promise<NessieCustomer> {
    return this.request("POST", "/customers", {
      first_name: input.firstName,
      last_name: input.lastName,
      address: input.address,
    });
  }

  createAccount(
    customerId: string,
    input: { nickname: string; balanceCents: number; type?: NessieAccount["type"] },
  ): Promise<NessieAccount> {
    return this.request("POST", `/customers/${encodeURIComponent(customerId)}/accounts`, {
      type: input.type ?? "Checking",
      nickname: input.nickname,
      rewards: 0,
      // Nessie account balances are whole dollars.
      balance: Math.floor(centsToDollars(input.balanceCents)),
    });
  }

  getAccount(accountId: string): Promise<NessieAccount> {
    return this.request("GET", `/accounts/${encodeURIComponent(accountId)}`);
  }

  // Merchants

  createMerchant(input: { name: string; category: string; address: NessieAddress }): Promise<NessieMerchant> {
    return this.request("POST", "/merchants", {
      name: input.name,
      category: input.category,
      address: input.address,
      geocode: { lat: 42.3732, lng: -72.5199 }, // Amherst, MA
    });
  }

  async getMerchant(merchantId: string): Promise<NessieMerchant> {
    const merchant = await this.request<NessieMerchant>("GET", `/merchants/${encodeURIComponent(merchantId)}`);
    this.merchantNames.set(merchantId, merchant.name);
    return merchant;
  }

  /** Merchant name for display and classification, cached per client. Unknown on failure. */
  async merchantName(merchantId: string): Promise<string> {
    const cached = this.merchantNames.get(merchantId);
    if (cached !== undefined) return cached;
    try {
      return (await this.getMerchant(merchantId)).name;
    } catch {
      return "Unknown merchant";
    }
  }

  // Bills

  listBills(accountId: string): Promise<NessieBill[]> {
    return this.request("GET", `/accounts/${encodeURIComponent(accountId)}/bills`);
  }

  getBill(billId: string): Promise<NessieBill> {
    return this.request("GET", `/bills/${encodeURIComponent(billId)}`);
  }

  createBill(
    accountId: string,
    input: { payee: string; nickname: string; amountCents: number; status?: NessieBillStatus; paymentDate?: string },
  ): Promise<NessieBill> {
    const today = nessieDate();
    return this.request("POST", `/accounts/${encodeURIComponent(accountId)}/bills`, {
      status: input.status ?? "pending",
      payee: input.payee,
      nickname: input.nickname,
      payment_date: input.paymentDate ?? today,
      recurring_date: 1,
      payment_amount: centsToDollars(input.amountCents),
    });
  }

  /** Mark a patient's bill paid after the fund's payout (SPEC §8). Safe to repeat. */
  completeBill(billId: string): Promise<unknown> {
    return this.request("PUT", `/bills/${encodeURIComponent(billId)}`, { status: "completed" });
  }

  // Purchases (also how the fund pays a provider: there is no "pay a bill" endpoint)

  listPurchases(accountId: string): Promise<NessiePurchase[]> {
    return this.request("GET", `/accounts/${encodeURIComponent(accountId)}/purchases`);
  }

  getPurchase(purchaseId: string): Promise<NessiePurchase> {
    return this.request("GET", `/purchases/${encodeURIComponent(purchaseId)}`);
  }

  createPurchase(
    accountId: string,
    input: { merchantId: string; amountCents: number; description: string; date?: string },
  ): Promise<NessiePurchase> {
    return this.request("POST", `/accounts/${encodeURIComponent(accountId)}/purchases`, {
      merchant_id: input.merchantId,
      medium: "balance",
      purchase_date: input.date ?? nessieDate(),
      amount: centsToDollars(input.amountCents),
      status: "completed",
      description: input.description,
    });
  }

  // Deposits (patient income history, and card donations into the fund)

  listDeposits(accountId: string): Promise<NessieDeposit[]> {
    return this.request("GET", `/accounts/${encodeURIComponent(accountId)}/deposits`);
  }

  createDeposit(
    accountId: string,
    input: { amountCents: number; description: string; date?: string },
  ): Promise<NessieDeposit> {
    return this.request("POST", `/accounts/${encodeURIComponent(accountId)}/deposits`, {
      medium: "balance",
      transaction_date: input.date ?? nessieDate(),
      status: "completed",
      amount: centsToDollars(input.amountCents),
      description: input.description,
    });
  }
}
