import { AuthHashHandler } from "@/components/auth-hash-handler"

type PageProps = {
  searchParams: Promise<{ next?: string }>
}

export default async function AuthCompletePage({ searchParams }: PageProps) {
  const { next } = await searchParams
  const defaultNext = next && next.startsWith("/") ? next : "/reset-password"

  return <AuthHashHandler defaultNext={defaultNext} />
}
