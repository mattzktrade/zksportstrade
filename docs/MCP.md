# ZK Sports CRM MCP server

Streamable HTTP endpoint for Grok Bot and other MCP clients.

## Endpoint

```
https://zk-sports.trade/mcp
```

Locally: `http://localhost:3000/mcp`.

- Transport: Streamable HTTP (JSON-RPC over `POST`)
- Auth: `Authorization: Bearer <api-key>`
- Protocol: MCP `2025-03-26` (also accepts `2024-11-05`, `2025-06-18`, `2025-11-25`)

Unsigned requests are rejected. Each key is limited to **60 calls per minute**.

## Create a key

1. Sign in as an admin.
2. Open **Settings → MCP keys** (`/admin/mcp`).
3. Name the key (for example `Grok Bot`) and choose a role:
   - **Read-only** — products, FAQs, contacts, deals
   - **Sales agent** — also create/update contacts, log activity, create draft deals, submit booking forms for director approval, and set draft / negotiating / lost
4. Copy the key immediately. It is stored hashed and will not be shown again.
5. In Grok Bot (or any MCP client), add a Streamable HTTP server:
   - URL: `https://zk-sports.trade/mcp`
   - Header: `Authorization: Bearer zkmcp_…`

Revoke a key on the same screen. The audit log lists every tool call with the key name, inputs, and result.

`create_deal` fails if quantity exceeds sellable stock, or if the agreed unit price is below the **deal price floor** on that page.

## What the assistant must not do

There are no delete tools. `create_booking_form` saves a draft and notifies Ollie and Michel. It never emails the client and never countersigns.

## Test

```bash
npx tsx scripts/test-mcp.ts
```

Against a live server (after creating a sales-agent key):

```bash
MCP_URL=https://zk-sports.trade/mcp MCP_API_KEY=zkmcp_… npx tsx scripts/test-mcp.ts
```
