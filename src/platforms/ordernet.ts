import type {
  FetchPortfolioOptions,
  FetchTransactionsOptions,
  Platform,
  PortfolioAccount,
  PortfolioResult
} from "../registry.js";
import type { ScraperScrapingResult } from "israeli-bank-scrapers";

// Spark (OrderNet) is the trading platform behind Meitav Trade (and other
// Israeli brokers). It exposes a JSON API; responses use single-letter keys
// with a `_t` type discriminator. Field meanings follow the community
// mappings in itamarco/spark-ordernet-client and assafmo/OrdernetAPI.

interface OrdernetAccount {
  key: string;
  number: string;
  name: string;
}

// SUG_CUR currency codes (inferred from live data: 1 = ILS, 2 = USD).
// Unknown codes pass through as-is.
const CURRENCY_CODES: Record<string, string> = {
  "1": "ILS",
  "2": "USD"
};

async function api<T>(
  baseUrl: string,
  path: string,
  token: string | undefined,
  init?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(`Ordernet API ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function authenticate(baseUrl: string, credentials: Record<string, string>): Promise<string> {
  const auth = await api<{ a?: string; l?: string }>(baseUrl, "/api/Auth/Authenticate", undefined, {
    method: "POST",
    body: JSON.stringify({ username: credentials.username, password: credentials.password })
  });
  // a = LoginStatus, l = Token
  if (!auth.l) {
    throw new Error(`Ordernet authentication failed (status: ${auth.a ?? "unknown"})`);
  }
  return auth.l;
}

async function getAccounts(baseUrl: string, token: string): Promise<OrdernetAccount[]> {
  type StaticEntry = { b: string; a: Array<{ _k: string; a: { b: string; e: string } }> };
  const staticData = await api<StaticEntry[]>(baseUrl, "/api/DataProvider/GetStaticData", token);
  const accountsEntry = staticData.find(entry => entry.b === "ACC");
  if (!accountsEntry) {
    throw new Error("Ordernet: no accounts entry in static data");
  }
  return accountsEntry.a.map(entry => ({
    key: entry._k,
    number: entry.a.b,
    name: entry.a.e
  }));
}

export function createOrdernetPlatform(id: string, name: string, baseUrl: string): Platform {
  return {
    id,
    name,
    loginFields: ["username", "password"],

    async fetchPortfolio(
      credentials: Record<string, string>,
      _options: FetchPortfolioOptions
    ): Promise<PortfolioResult> {
      const token = await authenticate(baseUrl, credentials);
      const accounts = await getAccounts(baseUrl, token);

      const portfolioAccounts: PortfolioAccount[] = [];
      for (const account of accounts) {
        // SecuritiesData: a = Totals (SecuritiesTotalType); o = AccountValueMorning, d = CashCurrent
        const securities = await api<{ a?: { o?: number; d?: number } }>(
          baseUrl,
          `/api/Account/GetAccountSecurities?accountKey=${encodeURIComponent(account.key)}`,
          token
        );

        // RMType entries; i = SYMBOL_NAM, j = BNO_NAME, y = PRC, ba = SUG_CUR,
        // bd = NV (quantity), be = COST, bf = VL (market value)
        type Holding = { i?: string; j?: string; y?: number; ba?: string; bd?: number; bf?: number };
        const holdings = await api<Holding[]>(
          baseUrl,
          `/api/Account/GetHoldings?accountKey=${encodeURIComponent(account.key)}`,
          token
        );

        portfolioAccounts.push({
          accountId: account.number,
          accountType: "brokerage",
          totalValue: securities.a?.o,
          cash: securities.a?.d,
          currency: "ILS",
          asOf: new Date().toISOString(),
          holdings: holdings.map(holding => ({
            name: holding.j ?? holding.i ?? "unknown",
            symbol: holding.i,
            quantity: holding.bd,
            value: holding.bf,
            currency: holding.ba != null ? CURRENCY_CODES[holding.ba] ?? holding.ba : undefined
          }))
        });
      }

      return { success: true, accounts: portfolioAccounts };
    },

    async fetchTransactions(
      credentials: Record<string, string>,
      options: FetchTransactionsOptions
    ): Promise<ScraperScrapingResult> {
      const token = await authenticate(baseUrl, credentials);
      const accounts = await getAccounts(baseUrl, token);

      const resultAccounts = [];
      for (const account of accounts) {
        // StructAccountTransaction: b = Date, d = Ref, f = Bno_Name, i = Nv,
        // j = Action, l = Comission, m = Price, n = NetCredit, o = NetDebit
        type Txn = { b?: string; d?: string; f?: string; m?: number; n?: number; o?: number };
        const startDate = options.startDate.toISOString();
        const endDate = new Date().toISOString();
        const txns = await api<Txn[]>(
          baseUrl,
          `/api/Account/GetAccountTransactions?accountKey=${encodeURIComponent(account.key)}` +
            `&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
          token
        );

        resultAccounts.push({
          accountNumber: account.number,
          txns: txns.map(txn => {
            const amount = (txn.n ?? 0) - (txn.o ?? 0);
            return {
              type: "normal" as const,
              identifier: txn.d,
              date: txn.b ?? "",
              processedDate: txn.b ?? "",
              originalAmount: amount,
              originalCurrency: "ILS",
              chargedAmount: amount,
              description: txn.f ?? "",
              status: "completed" as const
            };
          })
        });
      }

      return { success: true, accounts: resultAccounts } as unknown as ScraperScrapingResult;
    }
  };
}
