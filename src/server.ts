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

function getCredentialsForBank(bankId: CompanyTypes): ScraperCredentials {
  if (bankId !== CompanyTypes.leumi) {
    throw new Error("Unsupported bank credentials configuration");
  }

  const username = process.env.LEUMI_USERNAME;
  const password = process.env.LEUMI_PASSWORD;

  if (!username || !password) {
    throw new Error("Missing required bank credentials");
  }

  return {
    username,
    password
  };
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

// Create an MCP server
const server = new McpServer({
  name: "Israeli Bank MCP",
  version: "1.0.0"
});

// Add a resource to list available banks
server.resource(
  "banks",
  "banks://list",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify({
        banks: Object.entries(CompanyTypes).map(([key, value]) => {
          const scraperInfo = SCRAPERS[value];
          return {
            id: value,
            name: key,
            requiredCredentials: scraperInfo?.loginFields || []
          };
        })
      })
    }]
  })
);

// Add a tool to fetch transactions from a bank
server.tool(
  "fetch-transactions",
  {
    bankId: z.enum(Object.values(CompanyTypes) as [string, ...string[]]),
    startDate: z.string().optional(),
    combineInstallments: z.boolean().optional()
  },
  fetchTransactionsAnnotations,
  async ({ bankId, startDate, combineInstallments }) => {
    try {
      // Ensure bankId is a valid CompanyTypes value
      const validBankIds = new Set(Object.values(CompanyTypes));
      if (!validBankIds.has(bankId as unknown as CompanyTypes)) {
        throw new Error(`Invalid bank ID: ${bankId}`);
      }

      const options: ScraperOptions = {
        companyId: bankId as unknown as CompanyTypes,
        startDate: startDate ? new Date(startDate) : new Date(),
        combineInstallments: combineInstallments ?? false
      };

      const scraper = createScraper(options);
      const credentials = getCredentialsForBank(bankId as unknown as CompanyTypes);
      const scrapeResult = await scraper.scrape(credentials as ScraperCredentials);

      if (scrapeResult.success) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify(scrapeResult)
          }]
        };
      } else {
        return createGenericToolError(scrapeResult.errorType);
      }
    } catch {
      return createGenericToolError();
    }
  }
);

// Add a tool for 2FA authentication
server.tool(
  "two-factor-auth",
  {
    bankId: z.enum(Object.values(CompanyTypes) as [string, ...string[]]),
    phoneNumber: z.string(),
    action: z.enum(["trigger", "get-token"]),
    otpCode: z.string().optional()
  },
  twoFactorAuthAnnotations,
  async ({ bankId, phoneNumber, action, otpCode }) => {
    try {
      const validBankIds = new Set(Object.values(CompanyTypes));
      if (!validBankIds.has(bankId as unknown as CompanyTypes)) {
        throw new Error(`Invalid bank ID: ${bankId}`);
      }

      const scraper = createScraper({
        companyId: bankId as unknown as CompanyTypes,
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
      } else {
        throw new Error("Invalid action or missing OTP code");
      }
    } catch {
      return createGenericToolError();
    }
  }
);

// Start the server
const transport = new StdioServerTransport();
server.connect(transport).catch(console.error); 
