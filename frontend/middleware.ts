import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Every route is protected except /sign-in and its sub-paths
const isPublicRoute = createRouteMatcher(["/sign-in(.*)"]);

export default clerkMiddleware((auth, req) => {
    if (!isPublicRoute(req)) {
        auth().protect();
    }
});

export const config = {
    matcher: [
        // Skip Next.js internals and all static files
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
        // Always run for API routes
        "/(api|trpc)(.*)",
    ],
};
