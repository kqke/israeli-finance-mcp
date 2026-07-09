import { CompanyTypes, createScraper, ScraperCredentials, ScraperOptions, SCRAPERS } from 'israeli-bank-scrapers';
import type { ScraperScrapingResult } from 'israeli-bank-scrapers';

export interface FetchTransactionsOptions {
  startDate: Date;
  combineInstallments?: boolean;
  // Debug aid: run the underlying browser visibly instead of headless.
  showBrowser?: boolean;
}

export interface FetchPortfolioOptions {
  showBrowser?: boolean;
}

export interface PortfolioHolding {
  name: string;
  symbol?: string;
  quantity?: number;
  value?: number;
  currency?: string;
}

export interface PortfolioAccount {
  accountId: string;
  accountType: "brokerage" | "equity" | "pension" | "insurance" | "savings";
  totalValue?: number;
  currency?: string;
  asOf?: string;
  cash?: number;
  holdings?: PortfolioHolding[];
}

export interface PortfolioResult {
  success: boolean;
  accounts?: PortfolioAccount[];
  errorType?: string;
  errorMessage?: string;
}

// OTP-based login for custom platforms. `complete` returns session data
// (tokens/cookies) which the server persists locally — it is never returned
// to the MCP client.
export interface OtpCapability {
  trigger(credentials: Record<string, string>, phoneNumber?: string): Promise<void>;
  complete(credentials: Record<string, string>, otpCode: string): Promise<Record<string, string>>;
}

export interface Platform {
  id: string;
  name: string;
  loginFields: readonly string[];
  fetchTransactions?(
    credentials: Record<string, string>,
    options: FetchTransactionsOptions
  ): Promise<ScraperScrapingResult>;
  fetchPortfolio?(
    credentials: Record<string, string>,
    options: FetchPortfolioOptions
  ): Promise<PortfolioResult>;
  otp?: OtpCapability;
}

function libraryPlatform(id: CompanyTypes, name: string): Platform | undefined {
  const scraperInfo = SCRAPERS[id];
  if (!scraperInfo) {
    return undefined;
  }
  return {
    id,
    name: scraperInfo.name ?? name,
    loginFields: scraperInfo.loginFields,
    async fetchTransactions(credentials, options) {
      const scraperOptions: ScraperOptions = {
        companyId: id,
        startDate: options.startDate,
        combineInstallments: options.combineInstallments ?? false,
        showBrowser: options.showBrowser ?? false,
        timeout: 120000
      };
      const scraper = createScraper(scraperOptions);
      return scraper.scrape(credentials as unknown as ScraperCredentials);
    }
  };
}

// Custom platforms (insurance, brokerage, equity portals) register here.
// Each entry implements the same Platform interface as the library-backed ones.
const CUSTOM_PLATFORMS: Platform[] = [];

const platforms = new Map<string, Platform>();

for (const [key, id] of Object.entries(CompanyTypes)) {
  const platform = libraryPlatform(id, key);
  if (platform) {
    platforms.set(id, platform);
  }
}

for (const platform of CUSTOM_PLATFORMS) {
  platforms.set(platform.id, platform);
}

export function getPlatform(id: string): Platform | undefined {
  return platforms.get(id);
}

export function listPlatforms(): Platform[] {
  return [...platforms.values()];
}
