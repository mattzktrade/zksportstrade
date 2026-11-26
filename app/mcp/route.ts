import { mcpDeleteResponse, mcpGetResponse, handleMcpPost, mcpOptionsResponse } from "@/lib/mcp/http"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

export async function OPTIONS(request: Request) {
  return mcpOptionsResponse(request)
}

export async function GET(request: Request) {
  return mcpGetResponse(request)
}

export async function DELETE(request: Request) {
  return mcpDeleteResponse(request)
}

export async function POST(request: Request) {
  return handleMcpPost(request)
}
