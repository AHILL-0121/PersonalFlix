import { google } from "googleapis";

let driveInstance: ReturnType<typeof google.drive> | null = null;

/**
 * Returns a singleton Google Drive v3 client authenticated with the
 * service account key stored in GOOGLE_SERVICE_ACCOUNT_KEY.
 *
 * The key must be the full JSON blob (as a string) in the environment variable.
 */
export function getDriveClient() {
    if (driveInstance) return driveInstance;

    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY env var is not set");
    }

    const key = JSON.parse(keyJson) as {
        client_email: string;
        private_key: string;
    };

    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: key.client_email,
            private_key: key.private_key,
        },
        scopes: [
            "https://www.googleapis.com/auth/drive.readonly",
        ],
    });

    driveInstance = google.drive({ version: "v3", auth });
    return driveInstance;
}
