"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      console.log("[Login] Attempting sign in for:", email);
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      console.log("[Login] Sign in result:", {
        error: result?.error,
        ok: result?.ok,
        status: result?.status,
        url: result?.url,
      });

      if (result?.error) {
        console.error("[Login] Sign in error:", result.error);
        toast.error("Invalid email or password");
        setIsLoading(false);
      } else if (result?.ok) {
        console.log("[Login] Sign in successful, checking cookies...");
        
        // Check if cookie is set
        const cookies = document.cookie.split(';').map(c => c.trim());
        console.log("[Login] Current cookies:", cookies);
        const hasSessionCookie = cookies.some(c => c.includes('next-auth'));
        console.log("[Login] Has session cookie:", hasSessionCookie);
        
        toast.success("Logged in successfully");
        
        // Wait a moment for the cookie to be set before redirecting
        // This ensures the session cookie is available when the page loads
        console.log("[Login] Waiting 1 second for cookie to be set...");
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check again after delay
        const cookiesAfter = document.cookie.split(';').map(c => c.trim());
        console.log("[Login] Cookies after delay:", cookiesAfter);
        const hasSessionCookieAfter = cookiesAfter.some(c => c.includes('next-auth'));
        console.log("[Login] Has session cookie after delay:", hasSessionCookieAfter);
        
        console.log("[Login] Redirecting to home page...");
        // Use window.location for a full page reload to ensure session cookie is set
        // This ensures the middleware sees the authenticated session
        window.location.href = "/";
      } else {
        console.warn("[Login] Unexpected sign in result:", result);
        toast.error("Login failed. Please try again.");
        setIsLoading(false);
      }
    } catch (error) {
      console.error("[Login] Exception during login:", error);
      toast.error("An error occurred during login");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-semibold">Sign in</CardTitle>
          <CardDescription>
            Enter your email and password to access your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-zinc-700">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-zinc-700">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-zinc-600">
            Don't have an account?{" "}
            <Link href="/register" className="font-medium text-zinc-900 hover:underline">
              Sign up
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

