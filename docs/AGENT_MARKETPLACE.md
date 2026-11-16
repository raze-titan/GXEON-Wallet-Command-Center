# GXEON Agent Marketplace

The GXEON Agent Marketplace is a production public-discovery surface for agents that require small, metered API utility jobs. Its discovery server is available to any MCP client without authentication:

```text
https://gxeon-wallet-command-center.vercel.app/api/v1/mcp?view=public-market
```

It is published and active in the Official MCP Registry as `io.github.xpex-systems-ai/gxeon-agent-marketplace`, version `1.0.1`. A free listing submission has also been sent to mcpservers.org; directory approval is separate from the live GXEON service.

## Public discovery tools

| Tool | Purpose | Side effects |
| --- | --- | --- |
| `gxeon_list_services` | Lists available capabilities and credit costs. | None |
| `gxeon_list_credit_packs` | Lists prepaid credit packs and prices. | None |
| `gxeon_get_agent_buying_guide` | Returns the purchase and integration process. | None |

Every public tool is read-only. It never creates a checkout, charges a payment method, or exposes an API credential.

## Connect from an MCP client

Use Streamable HTTP with the endpoint above. The standard MCP handshake can be performed as follows:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "your-agent", "version": "1.0.0" }
  }
}
```

Then call `tools/list` and one of the public tools. For example:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": { "name": "gxeon_list_services", "arguments": {} }
}
```

## Capabilities and credits

The live catalog is the source of truth:

```text
GET https://gxeon-wallet-command-center.vercel.app/v1/services
GET https://gxeon-wallet-command-center.vercel.app/v1/billing/topup
```

| Capability | Price |
| --- | --- |
| JSON Validate | 2 credits per payload |
| URL Verify | 5 credits per URL |
| API Health | 10 credits per endpoint |

The prepaid catalog begins with PICO: 2 credits for BRL 0.99. Prices, packs, and available services can change; clients should fetch the catalog rather than hard-code values.

## Purchase and execution boundary

1. Discover services and packs through the public MCP or REST catalog.
2. Create a checkout via `POST /v1/billing/topup` with `packId` and a new agent/project `name`, or authenticate with an existing GXEON key.
3. Store a newly issued GXEON API key only in a private secret store.
4. Complete Stripe Checkout with an authorized payment method.
5. Wait for provider-verified settlement.
6. Use the API key with the authenticated execution MCP at `https://gxeon-wallet-command-center.vercel.app/api/v1/mcp`.

Do not put a GXEON API key in source code, a public plugin manifest, prompts, issues, or logs.

## Money Truth

Creating a checkout is not a completed payment. Listing a pack is not a completed payment. Credits become available only after the payment provider is verified by GXEON's settlement path. Revenue must be derived from that verified settlement evidence, not from catalog views, checkout sessions, or agent jobs.

## Support and verification

- Marketplace: <https://gxeon-wallet-command-center.vercel.app/market>
- MCP docs: <https://gxeon-wallet-command-center.vercel.app/mcp>
- Registry record: <https://registry.modelcontextprotocol.io/v0.1/servers/io.github.xpex-systems-ai%2Fgxeon-agent-marketplace/versions/latest>
- Source: <https://github.com/xpex-systems-ai/GXEON-Wallet-Command-Center>


## Payment rails

Production purchase/execution currently has two active BRL rails:

- Stripe LIVE direct service checkout.
- Stripe LIVE prepaid credit packs from BRL 0.99.

The live x402 status is available at `GET /v1/payment-methods`. When enabled, the Base USDC pilot serves `POST /x402/json-validate` and `POST /x402/csv-audit` for 0.01 USDC per call, paid to the verified treasury. The receiving wallet stays non-custodial. PayAI verifies and submits the buyer's signed x402 payment, and GXEON checks the finalized Base transaction before it records delivery and revenue together.

Start with the normal task input and read the `PAYMENT-REQUIRED` header. Retry the same input with the buyer's x402 v2 `PAYMENT-SIGNATURE` header. If the API reports `SETTLEMENT_PENDING`, follow `Retry-After` and reuse the same input and signature while the transaction finalizes. A successful response includes the result and the finalized Base transaction hash.

### PayAI merchant account

Use the API Key ID and API Key Secret from the [PayAI merchant dashboard](https://merchant.payai.network/dashboard). Save them as sensitive server variables `PAYAI_API_KEY_ID` and `PAYAI_API_KEY_SECRET` in the Vercel Production environment, then redeploy. The server uses these credentials to sign PayAI requests. The receiving address is still the verified Base treasury.

Check `facilitatorAuthentication` in the x402 entry of `GET /v1/payment-methods`. With neither variable set, `wallet` uses the PayAI allowance associated with the receiving address. With a valid local key pair, `merchant_configured` indicates the server can sign requests. PayAI checks whether it recognizes the key when it receives an authenticated request. If only one variable is supplied or the secret cannot be loaded, x402 is unavailable until the configuration is corrected.
