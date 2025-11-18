import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        console.log("[Auth] Authorize called", {
          hasEmail: !!credentials?.email,
          hasPassword: !!credentials?.password,
          env: process.env.NODE_ENV,
        });

        if (!credentials?.email || !credentials?.password) {
          console.log("[Auth] Missing credentials");
          return null;
        }

        if (!db) {
          console.error("[Auth] Database not initialized");
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        try {
          // Find user by email
          console.log("[Auth] Looking up user:", email);
          const userList = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

          const user = userList[0];
          if (!user || !user.password) {
            console.log("[Auth] User not found or no password");
            return null;
          }

          // Verify password
          console.log("[Auth] Verifying password");
          const isValid = await bcrypt.compare(password, user.password);

          if (!isValid) {
            console.log("[Auth] Invalid password");
            return null;
          }

          console.log("[Auth] Authentication successful for:", email);
          return {
            id: user.id,
            email: user.email,
            name: user.name,
          };
        } catch (error) {
          console.error("[Auth] Error during authorization:", error);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        console.log("[Auth] JWT callback - adding user to token:", user.email);
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        console.log("[Auth] Session callback - creating session for:", token.email);
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {
    sessionToken: {
      name: `${process.env.NODE_ENV === "production" ? "__Secure-" : ""}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  debug: process.env.NODE_ENV === "development",
});

