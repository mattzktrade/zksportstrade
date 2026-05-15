import { AuthHashHandler } from "@/components/auth-hash-handler"
import { safeRedirectPath } from "@/lib/auth/safe-redirect"

type PageProps = {
  searchParams: Promise<{ next?: string }>
}

export default async function AuthCompletePage({ searchParams }: PageProps) {
  const { next } = await searchParams
  const defaultNext = safeRedirectPath(next, "/reset-password")

  return <AuthHashHandler defaultNext={defaultNext} />
}
