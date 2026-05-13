import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAuthRoute = path === "/login" || path === "/signup"
  const isUnderAuthPath = path.startsWith("/auth/")
  const isPendingPage = path === "/pending-approval"

  if (!user) {
    const isPublic = path === "/login" || path === "/signup" || path.startsWith("/auth/")
    if (isPublic) {
      return supabaseResponse
    }
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("redirect", path)
    return NextResponse.redirect(url)
  }

  const { data: profile } = await supabase.from("profiles").select("approval_status, role").eq("id", user.id).maybeSingle()

  if (!profile && !isUnderAuthPath) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("error", "no_profile")
    return NextResponse.redirect(url)
  }

  const isApproved = profile?.approval_status === "approved" || profile?.role === "admin"
  const isPending = profile?.approval_status === "pending"
  const isRejected = profile?.approval_status === "rejected"
  const isAdminRoute = path.startsWith("/admin")

  if (isAdminRoute && profile?.role !== "admin") {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  if (isRejected && !isAuthRoute && !isUnderAuthPath) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("error", "account_rejected")
    return NextResponse.redirect(url)
  }

  if (isAuthRoute) {
    if (isApproved) {
      const url = request.nextUrl.clone()
      url.pathname = "/"
      return NextResponse.redirect(url)
    }
    if (isPending) {
      const url = request.nextUrl.clone()
      url.pathname = "/pending-approval"
      return NextResponse.redirect(url)
    }
  }

  if (isPending && !isPendingPage && !isUnderAuthPath) {
    const url = request.nextUrl.clone()
    url.pathname = "/pending-approval"
    return NextResponse.redirect(url)
  }

  if (isApproved && isPendingPage) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
