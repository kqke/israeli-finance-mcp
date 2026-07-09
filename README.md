# Israeli Finance MCP

A project for managing Israeli bank, credit card, and investment accounts using the Model Context Protocol (MCP).

## Features

- List available Israeli banks and credit card companies with their required credentials
- Fetch transactions from any supported bank
- Fetch portfolio holdings and balances from brokerage/investment platforms
- Support for all major Israeli banks and credit card companies, plus custom platforms (e.g. Meitav Trade)
- Secure credential handling via environment variables or the macOS Keychain
- Flexible transaction date ranges
- Two-factor / OTP authentication support with local session persistence

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

3. Connect to MCP Clients

## Connecting to MCP Clients

The server can be connected to any MCP-compatible client. Here's how to configure it:

### Example Configuration

Credentials are read from environment variables (never from tool arguments — this avoids leaking them into the LLM conversation history). Each bank requires `<BANK_ID>_<FIELD>` env vars. For example, Bank Leumi needs `LEUMI_USERNAME` and `LEUMI_PASSWORD`; Hapoalim needs `HAPOALIM_USERCODE` and `HAPOALIM_PASSWORD`. Use the `banks://list` resource to see required env-var names per bank.

For clients that support configuration files (like Claude), add the following to your configuration:

```json
{
    "mcpServers": {
        "israeli-finance-mcp": {
            "command": "node",
            "args": [
                "/path/to/israeli-finance-mcp/build/server.js"
            ],
            "env": {
                "LEUMI_USERNAME": "your-username",
                "LEUMI_PASSWORD": "your-password"
            }
        }
    }
}
```

### Credential Storage

Credentials are resolved in this order for each field: **environment variable → macOS Keychain → stored session**.

On macOS you can keep credentials out of plaintext config by storing them in the Keychain instead of `env`. Use the service name `israeli-bank.<ENV_VAR_NAME>` with your user account:

```bash
security add-generic-password -a "$USER" -s israeli-bank.DISCOUNT_ID -w
security add-generic-password -a "$USER" -s israeli-bank.DISCOUNT_PASSWORD -w
security add-generic-password -a "$USER" -s israeli-bank.DISCOUNT_NUM -w
```

The `-w` flag prompts for the secret interactively so it never appears in your shell history. Add `-U` to update an existing entry. Environment variables, when set, take precedence over Keychain entries.

For platforms with OTP login (see the `otp-login` tool), the long-term token / session is persisted under `~/.israeli-finance-mcp/sessions/` (files `0600`, directory `0700`) so you don't re-authenticate on every fetch.

## Resources

- **Banks** (`banks://list`)
  - List available banks and their required credentials

## Tools

- **Fetch transactions** (`fetch-transactions`)
  - Fetch transactions from a bank or platform

- **Fetch portfolio** (`fetch-portfolio`)
  - Fetch holdings, balances, and cash from brokerage/investment platforms that support it

- **2FA** (`two-factor-auth`)
    - 2FA authentication for banks that require that

- **OTP login** (`otp-login`)
    - `trigger` / `complete` / `clear-session` for custom platforms with one-time-code login; the resulting session is stored locally, never returned to the client


## Supported Banks

The server supports all major Israeli banks and credit card companies through the [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) library:

- Bank Hapoalim
- Leumi Bank
- Discount Bank
- Mercantile Bank
- Mizrahi Bank
- Otsar Hahayal Bank
- Visa Cal
- Max (Formerly Leumi Card)
- Isracard
- Amex
- Union Bank
- Beinleumi
- Massad
- Yahav
- Beyhad Bishvilha
- OneZero (Experimental)
- Behatsdaa

## Custom Platforms

Beyond the library-backed banks, the server supports custom platforms registered in `src/registry.ts`. These implement the same interface and get credential handling, listing, and error sanitization for free.

- **Meitav Trade** (`meitavTrade`) — brokerage holdings and transactions via the Spark/OrderNet JSON API. Supports both `fetch-transactions` and `fetch-portfolio`. Requires `MEITAV_TRADE_USERNAME` and `MEITAV_TRADE_PASSWORD`.

## Security

- Please do not attempt this at home (I honestly don't know, it's probably not a good idea, but it's really cool)

## License

MIT 
