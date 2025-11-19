import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Check for site password protection
  const sitePasswordCookie = request.cookies.get("site-access");
  const hasSiteAccess = sitePasswordCookie?.value === "authenticated";
  
  // Public routes that don't require site password
  const passwordExemptRoutes = ["/password", "/api/password", "/api/auth"];
  const isPasswordExempt = passwordExemptRoutes.some((route) => pathname.startsWith(route));
  
  // If no site password access and not on password page, redirect to password page
  if (!hasSiteAccess && !isPasswordExempt) {
    return NextResponse.redirect(new URL("/password", request.url));
  }
  
  // If already on password page and has access, redirect to home
  if (hasSiteAccess && pathname === "/password") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  
  // Log cookies for debugging
  const cookies = request.cookies.getAll();
  console.log("[Middleware] Request to:", pathname);
  console.log("[Middleware] Cookies:", cookies.map(c => ({ name: c.name, hasValue: !!c.value })));

  const token = await getToken({ 
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: process.env.NODE_ENV === "production" 
      ? "__Secure-authjs.session-token" 
      : "authjs.session-token",
  });

  console.log("[Middleware] Token exists:", !!token);
  if (token) {
    console.log("[Middleware] Token email:", token.email);
  }

  // Public routes that don't require authentication
  const publicRoutes = ["/login", "/register", "/api/auth", "/password", "/api/password"];
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));

  // If accessing a public route, allow it
  if (isPublicRoute) {
    console.log("[Middleware] Public route, allowing");
    return NextResponse.next();
  }

  // If no token and trying to access protected route, redirect to login
  if (!token) {
    console.log("[Middleware] No token, redirecting to login");
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  console.log("[Middleware] Token found, allowing access");
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (auth routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

