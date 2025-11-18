import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
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
  const publicRoutes = ["/login", "/register", "/api/auth"];
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

