import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isSyncCall } from "@/lib/syncAuth";

// Every route is protected except /sign-in and its sub-paths
const isPublicRoute = createRouteMatcher(["/sign-in(.*)"]);

// Comma-separated Clerk user IDs allowed in. Signed-in isn't enough on its own: /api/token hands out
// a Drive read token, so only the owner's account may pass.
const allowed = (process.env.ALLOWED_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export default clerkMiddleware((auth, req) => {
    if (isPublicRoute(req) || isSyncCall(req)) return;
    const { userId } = auth().protect();
    if (allowed.length && !allowed.includes(userId)) {
        return NextResponse.json({ error: "This account is not allowed" }, { status: 403 });
    }
}, { clockSkewInMs: 1000 * 60 * 60 * 24 }); // 24 hours of skew tolerance

export const config = {
    matcher: [
        // Skip Next.js internals and all static files
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
        // Always run for API routes
        "/(api|trpc)(.*)",
    ],
};
