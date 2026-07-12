import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDriveClient } from "@/lib/drive";

interface RouteParams {
    params: { folderId: string };
}

export async function GET(_req: Request, { params }: RouteParams) {
    const { userId } = auth();
    if (!userId)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const drive = getDriveClient();
        const res = await drive.files.list({
            q: `'${params.folderId}' in parents and trashed = false`,
            fields: "files(id,name,mimeType,size,modifiedTime)",
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            pageSize: 1000,
        });

        return NextResponse.json(res.data.files ?? []);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Drive error";
        console.error("[browse]", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
