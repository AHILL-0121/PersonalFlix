import { google } from "googleapis";

let driveInstance: ReturnType<typeof google.drive> | null = null;

function getCredentials() {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY env var is not set");
    return JSON.parse(keyJson) as { client_email: string; private_key: string };
}

/**
 * Returns a fresh access token for the Drive read-only scope.
 * Needed by FFmpeg to perform HTTP Range requests directly against the Drive API.
 */
export async function getDriveToken(): Promise<string | null> {
    const auth = new google.auth.GoogleAuth({
        credentials: getCredentials(),
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    return await auth.getAccessToken();
}

/**
 * Read-only Drive client — used for browsing and streaming.
 */
export function getDriveClient() {
    if (driveInstance) return driveInstance;
    const auth = new google.auth.GoogleAuth({
        credentials: getCredentials(),
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    driveInstance = google.drive({ version: "v3", auth });
    return driveInstance;
}

