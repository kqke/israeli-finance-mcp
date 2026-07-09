import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { CompanyTypes, createScraper, SCRAPERS } from 'israeli-bank-scrapers';
import { z } from "zod";
import { getPlatform, listPlatforms, Platform } from "./registry.js";
import { loadSession, saveSession, clearSession } from "./sessions.js";

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

function getCredentialsForPlatform(platform: Platform): Record<string, string> {
  const missing: string[] = [];
  // Stored session data (e.g. long-term OTP tokens, cookies) supplements
  // env vars; env vars win for declared login fields.
  const session = loadSession(platform.id) ?? {};
  const credentials: Record<string, string> = { ...session };

  for (const field of platform.loginFields) {
    const envName = envVarName(platform.id, field);
    const value = process.env[envName] ?? session[field];
    if (!value) {
      missing.push(envName);
    } else {
      credentials[field] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required bank credentials: ${missing.join(", ")}`);
  }

  return credentials;
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
        banks: listPlatforms().map(platform => ({
          id: platform.id,
          name: platform.name,
          requiredCredentials: platform.loginFields,
          requiredEnvVars: platform.loginFields.map(f => envVarName(platform.id, f))
        }))
      })
    }]
  })
);

server.registerTool(
  "fetch-transactions",
  {
    inputSchema: {
      bankId: z.string().describe(`One of: ${listPlatforms().map(p => p.id).join(", ")}`),
      startDate: z.string().optional(),
      combineInstallments: z.boolean().optional()
    },
    annotations: fetchTransactionsAnnotations
  },
  async ({ bankId, startDate, combineInstallments }) => {
    try {
      const platform = getPlatform(bankId);
      if (!platform || !platform.fetchTransactions) {
        throw new Error(`Invalid bank ID: ${bankId}`);
      }

      const credentials = getCredentialsForPlatform(platform);

      const scrapeResult = await platform.fetchTransactions(credentials, {
        startDate: startDate ? new Date(startDate) : new Date(),
        combineInstallments: combineInstallments ?? false
      });

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
        if (!result.success) {
          return createGenericToolError(result.errorType);
        }
        // Persist the token locally instead of returning it into the
        // conversation; credential lookup picks it up automatically.
        saveSession(bankId, { otpLongTermToken: result.longTermTwoFactorAuthToken });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Long-term token stored locally" })
          }]
        };
      }
      throw new Error("Invalid action or missing OTP code");
    } catch {
      return createGenericToolError();
    }
  }
);

server.registerTool(
  "fetch-portfolio",
  {
    inputSchema: {
      platformId: z.string().describe("Platform to fetch holdings/balances from (insurance, pension, brokerage or equity platforms)")
    },
    annotations: fetchTransactionsAnnotations
  },
  async ({ platformId }) => {
    try {
      const platform = getPlatform(platformId);
      if (!platform || !platform.fetchPortfolio) {
        throw new Error(`Platform does not support portfolio fetching: ${platformId}`);
      }

      const credentials = getCredentialsForPlatform(platform);
      const result = await platform.fetchPortfolio(credentials, {});

      if (result.success) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result)
          }]
        };
      }
      return createGenericToolError(result.errorType);
    } catch {
      return createGenericToolError();
    }
  }
);

server.registerTool(
  "otp-login",
  {
    inputSchema: {
      platformId: z.string().describe("Platform to perform OTP login for"),
      action: z.enum(["trigger", "complete", "clear-session"]),
      otpCode: z.string().optional(),
      phoneNumber: z.string().optional()
    },
    annotations: twoFactorAuthAnnotations
  },
  async ({ platformId, action, otpCode, phoneNumber }) => {
    try {
      const platform = getPlatform(platformId);
      if (!platform) {
        throw new Error(`Invalid platform ID: ${platformId}`);
      }

      if (action === "clear-session") {
        clearSession(platform.id);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Stored session cleared" })
          }]
        };
      }

      if (!platform.otp) {
        throw new Error(`Platform does not support OTP login: ${platformId}`);
      }

      const credentials = getCredentialsForPlatform(platform);

      if (action === "trigger") {
        await platform.otp.trigger(credentials, phoneNumber);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "OTP code sent" })
          }]
        };
      }

      if (action === "complete" && otpCode) {
        // Session data (tokens/cookies) is persisted locally and never
        // returned into the conversation.
        const sessionData = await platform.otp.complete(credentials, otpCode);
        saveSession(platform.id, sessionData);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Login completed, session stored locally" })
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
