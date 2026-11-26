"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Copy, KeyRound, Plus, Search, ShieldOff } from "lucide-react"
import { toast } from "sonner"
import {
  AdminDesktopTable,
  AdminMobileList,
  AdminPageHeader,
  AdminPanel,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import { pageSearchProps } from "@/lib/browser/laptop-qol"
import type { McpAdminPageData } from "@/lib/mcp/admin"
import { mcpRoleLabel, type McpKeyRole } from "@/lib/mcp/types"
import {
  createMcpApiKeyAction,
  revokeMcpApiKeyAction,
  updateMcpDealPriceFloorAction,
} from "./actions"

function dateLabel(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function previewJson(value: unknown): string {
  if (value == null) return "—"
  try {
    const text = JSON.stringify(value)
    return text.length > 180 ? `${text.slice(0, 180)}…` : text
  } catch {
    return "—"
  }
}

export function McpAdminClient({ data }: { data: McpAdminPageData }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState("")
  const [role, setRole] = useState<McpKeyRole>("sales_agent")
  const [floor, setFloor] = useState(String(data.dealPriceFloor))
  const [createdKey, setCreatedKey] = useState<{ name: string; key: string } | null>(null)
  const [auditSearch, setAuditSearch] = useState("")

  const activeKeys = data.keys.filter((key) => !key.revokedAt)
  const revokedKeys = data.keys.filter((key) => key.revokedAt)
  const audit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase()
    if (!q) return data.audit
    return data.audit.filter((row) =>
      `${row.keyName} ${row.toolName} ${row.error ?? ""}`.toLowerCase().includes(q),
    )
  }, [data.audit, auditSearch])

  function createKey() {
    startTransition(async () => {
      const result = await createMcpApiKeyAction({ name, role })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      if (result.key) setCreatedKey({ name: result.name ?? name, key: result.key })
      setName("")
      toast.success(result.message)
      router.refresh()
    })
  }

  function revoke(id: string) {
    startTransition(async () => {
      const result = await revokeMcpApiKeyAction(id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function saveFloor() {
    const value = Number(floor)
    startTransition(async () => {
      const result = await updateMcpDealPriceFloorAction(value)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied.`)
    } catch {
      toast.error("Could not copy.")
    }
  }

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="MCP keys"
        description="API keys for Grok Bot and other MCP clients. Keys are stored hashed. The assistant cannot send a booking form or approve a signature."
      />

      <AdminPanel>
        <div className="space-y-3 px-4 py-4 text-[12px]">
          <p className="text-[11px] text-[#5f636b]">
            Endpoint (Streamable HTTP, HTTPS):{" "}
            <span className="font-mono text-[11px] text-[#18191c]">{data.endpointUrl}</span>
            <button
              type="button"
              className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary"
              onClick={() => copy(data.endpointUrl, "Endpoint")}
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
          </p>
          <p className="text-[11px] text-[#5f636b]">
            Send <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>. Read-only keys can look
            up products, FAQs, contacts, and deals. Sales-agent keys can also write contacts, activity, draft
            deals, and booking-form drafts for director approval.
          </p>
        </div>
      </AdminPanel>

      {createdKey ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px]">
          <p className="font-semibold text-amber-950">New key for {createdKey.name}</p>
          <p className="mt-1 text-[11px] text-amber-900">
            Copy this now. It is not stored in plain text and will not be shown again.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 font-mono text-[11px] text-[#18191c]">
              {createdKey.key}
            </code>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-[11px] font-semibold text-white"
              onClick={() => copy(createdKey.key, "API key")}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy key
            </button>
          </div>
        </div>
      ) : null}

      <AdminPanel>
        <div className="border-b border-[#eceef1] px-4 py-3">
          <h2 className="text-[11px] font-semibold text-[#25272b]">Create a key</h2>
        </div>
        <div className="flex flex-wrap items-end gap-2 px-4 py-3">
          <label className="min-w-[180px] flex-1 text-[11px]">
            <span className="mb-1 block font-medium text-[#5f636b]">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grok Bot"
              className="h-8 w-full rounded-md border border-[#e5e7eb] bg-white px-2 text-[11px] outline-none focus:border-primary/40"
            />
          </label>
          <label className="text-[11px]">
            <span className="mb-1 block font-medium text-[#5f636b]">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as McpKeyRole)}
              className="h-8 rounded-md border border-[#e5e7eb] bg-white px-2 text-[11px]"
            >
              <option value="sales_agent">Sales agent</option>
              <option value="read_only">Read-only</option>
            </select>
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={createKey}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Create key
          </button>
        </div>
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-[#eceef1] px-4 py-3">
          <h2 className="text-[11px] font-semibold text-[#25272b]">Deal price floor</h2>
        </div>
        <div className="flex flex-wrap items-end gap-2 px-4 py-3">
          <label className="text-[11px]">
            <span className="mb-1 block font-medium text-[#5f636b]">Minimum agreed unit price</span>
            <input
              type="number"
              min={0}
              step="1"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              className="h-8 w-40 rounded-md border border-[#e5e7eb] bg-white px-2 text-[11px] outline-none focus:border-primary/40"
            />
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={saveFloor}
            className="h-8 rounded-md border border-[#e5e7eb] bg-white px-3 text-[11px] font-medium text-[#25272b] disabled:opacity-50"
          >
            Save floor
          </button>
          <p className="text-[10px] text-[#80848d]">
            create_deal fails if the agreed price is below this number. Use the package currency.
          </p>
        </div>
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-[#eceef1] px-4 py-3">
          <h2 className="text-[11px] font-semibold text-[#25272b]">
            Keys · {activeKeys.length} active
          </h2>
        </div>
        <AdminDesktopTable>
          <table className="w-full min-w-[720px] text-left text-[10px]">
            <thead className="bg-[#fafbfc] text-[9px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Prefix</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5 font-medium">Last used</th>
                <th className="px-4 py-2.5 font-medium"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f1f3]">
              {data.keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[11px] text-[#80848d]">
                    No keys yet. Create one for Grok Bot.
                  </td>
                </tr>
              ) : (
                data.keys.map((key) => (
                  <tr key={key.id} className="align-middle">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <KeyRound className="h-3.5 w-3.5 text-slate-400" />
                        <span className="font-semibold text-slate-800">{key.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={key.role === "sales_agent" ? "green" : "gray"}>
                        {key.roleLabel}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px]">{key.keyPrefix}…</td>
                    <td className="px-4 py-3">{dateLabel(key.createdAt)}</td>
                    <td className="px-4 py-3">{dateLabel(key.lastUsedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {key.revokedAt ? (
                        <StatusPill tone="red">Revoked {dateLabel(key.revokedAt)}</StatusPill>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => revoke(key.id)}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-primary disabled:opacity-50"
                        >
                          <ShieldOff className="h-3 w-3" />
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {data.keys.map((key) => (
            <div key={key.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-[12px] font-semibold">{key.name}</p>
                <p className="text-[10px] text-[#80848d]">
                  {mcpRoleLabel(key.role)} · {key.keyPrefix}…
                </p>
              </div>
              {key.revokedAt ? (
                <StatusPill tone="red">Revoked</StatusPill>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => revoke(key.id)}
                  className="text-[10px] font-medium text-primary"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </AdminMobileList>
        {revokedKeys.length > 0 ? (
          <p className="border-t border-[#eceef1] px-4 py-2 text-[10px] text-[#80848d]">
            Revoked keys stay listed for the audit log. They cannot call /mcp.
          </p>
        ) : null}
      </AdminPanel>

      <AdminPanel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] px-4 py-3">
          <h2 className="text-[11px] font-semibold text-[#25272b]">Audit log</h2>
          <div className="relative ml-auto min-w-[200px] max-w-[320px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              {...pageSearchProps}
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Filter by key or tool..."
              className="h-8 w-full rounded-md border border-[#e5e7eb] bg-white pl-9 pr-3 text-[10px] outline-none placeholder:text-[#a0a3a9] focus:border-primary/40"
            />
          </div>
        </div>
        <AdminDesktopTable>
          <table className="w-full min-w-[860px] text-left text-[10px]">
            <thead className="bg-[#fafbfc] text-[9px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Key</th>
                <th className="px-4 py-2.5 font-medium">Tool</th>
                <th className="px-4 py-2.5 font-medium">Inputs</th>
                <th className="px-4 py-2.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f1f3]">
              {audit.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[11px] text-[#80848d]">
                    No tool calls yet.
                  </td>
                </tr>
              ) : (
                audit.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3">{dateLabel(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.keyName}</p>
                      <p className="text-[9px] text-slate-400">{row.keyRole}</p>
                    </td>
                    <td className="px-4 py-3 font-mono">{row.toolName}</td>
                    <td className="max-w-[280px] px-4 py-3 font-mono text-[9px] break-all text-slate-600">
                      {previewJson(row.arguments)}
                    </td>
                    <td className="max-w-[280px] px-4 py-3 font-mono text-[9px] break-all">
                      {row.error ? (
                        <span className="text-primary">{row.error}</span>
                      ) : (
                        <span className="text-slate-600">{previewJson(row.result)}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {audit.slice(0, 40).map((row) => (
            <div key={row.id} className="space-y-1 px-4 py-3">
              <p className="text-[11px] font-semibold">
                {row.toolName} · {row.keyName}
              </p>
              <p className="text-[10px] text-[#80848d]">{dateLabel(row.createdAt)}</p>
              {row.error ? <p className="text-[10px] text-primary">{row.error}</p> : null}
            </div>
          ))}
        </AdminMobileList>
      </AdminPanel>
    </div>
  )
}
