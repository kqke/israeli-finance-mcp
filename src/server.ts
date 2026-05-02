import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { CompanyTypes, createScraper, ScraperOptions, ScraperCredentials, SCRAPERS } from 'israeli-bank-scrapers';
import { z } from "zod";

const BANK_SCRAPER_ERROR_MESSAGE = "Bank scraper error occurred";

const fetchTransactionsAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false
};

const twoFactorAuthAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false
};

function envVarName(bankId: string, field: string): string {
  return `${bankId.replace(/[A-Z]/g, m => `_${m}`).toUpperCase()}_${field.replace(/[A-Z]/g, m => `_${m}`).toUpperCase()}`;
}

function getCredentialsForBank(bankId: CompanyTypes): ScraperCredentials {
  const scraperInfo = SCRAPERS[bankId];
  if (!scraperInfo) {
    throw new Error(`Unsupported bank: ${bankId}`);
  }

  const credentials: Record<string, string> = {};
  const missing: string[] = [];

  for (const field of scraperInfo.loginFields) {
    const envName = envVarName(bankId, field);
    const value = process.env[envName];
    if (!value) {
      missing.push(envName);
    } else {
      credentials[field] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required bank credentials: ${missing.join(", ")}`);
  }

  return credentials as unknown as ScraperCredentials;
}

function createGenericToolError(errorType = "BANK_SCRAPER_ERROR") {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        error: errorType,
        message: BANK_SCRAPER_ERROR_MESSAGE
      })
    }],
    isError: true
  };
}

const server = new McpServer({
  name: "Israeli Bank MCP",
  version: "1.0.0"
});

server.resource(
  "banks",
  "banks://list",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify({
        banks: Object.entries(CompanyTypes).map(([key, value]) => {
          const scraperInfo = SCRAPERS[value];
          const loginFields = scraperInfo?.loginFields || [];
          return {
            id: value,
            name: key,
            requiredCredentials: loginFields,
            requiredEnvVars: loginFields.map(f => envVarName(value, f))
          };
        })
      })
    }]
  })
);

server.registerTool(
  "fetch-transactions",
  {
    inputSchema: {
      bankId: z.string().describe(`One of: ${Object.values(CompanyTypes).join(", ")}`),
      startDate: z.string().optional(),
      combineInstallments: z.boolean().optional()
    },
    annotations: fetchTransactionsAnnotations
  },
  async ({ bankId, startDate, combineInstallments }) => {
    try {
      const company = bankId as unknown as CompanyTypes;
      if (!SCRAPERS[company]) {
        throw new Error(`Invalid bank ID: ${bankId}`);
      }

      const credentials = getCredentialsForBank(company);

      const options: ScraperOptions = {
        companyId: company,
        startDate: startDate ? new Date(startDate) : new Date(),
        combineInstallments: combineInstallments ?? false
      };

      const scraper = createScraper(options);
      const scrapeResult = await scraper.scrape(credentials);

      if (scrapeResult.success) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify(scrapeResult)
          }]
        };
      }
      return createGenericToolError(scrapeResult.errorType);
    } catch {
      return createGenericToolError();
    }
  }
);

server.registerTool(
  "two-factor-auth",
  {
    inputSchema: {
      bankId: z.string().describe(`One of: ${Object.values(CompanyTypes).join(", ")}`),
      phoneNumber: z.string(),
      action: z.enum(["trigger", "get-token"]),
      otpCode: z.string().optional()
    },
    annotations: twoFactorAuthAnnotations
  },
  async ({ bankId, phoneNumber, action, otpCode }) => {
    try {
      const company = bankId as unknown as CompanyTypes;
      if (!SCRAPERS[company]) {
        throw new Error(`Invalid bank ID: ${bankId}`);
      }

      const scraper = createScraper({
        companyId: company,
        startDate: new Date()
      });

      if (action === "trigger") {
        await scraper.triggerTwoFactorAuth(phoneNumber);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "2FA code sent" })
          }]
        };
      } else if (action === "get-token" && otpCode) {
        const result = await scraper.getLongTermTwoFactorToken(otpCode);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result)
          }]
        };
      }
      throw new Error("Invalid action or missing OTP code");
    } catch {
      return createGenericToolError();
    }
  }
);

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
