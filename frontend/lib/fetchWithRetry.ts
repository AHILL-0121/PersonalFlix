export async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

    for (let i = 0; i < retries; i++) {
        try {
            // Note: Native fetch in Node 18+ on Windows can frequently throw ECONNRESET (fetch failed).
            // Passing a common User-Agent and disabling cache helps mitigate some strict CDNs/ISPs.
            const res = await fetch(url, {
                ...options,
                cache: options.cache || "no-store",
                headers: {
                    Accept: "application/json",
                    "User-Agent": "PersonalNetflix/1.0",
                    ...(options.headers || {})
                }
            });

            // If it's a 4xx error, don't retry (it's a bad request, not a network drop)
            if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                return res;
            }

            // 429 Too Many Requests -> force retry with backoff.
            if (res.status === 429) {
                if (i === retries - 1) return res;
                console.warn(`[fetchWithRetry] Rate limited (429) on ${url}. Retrying...`);
                await delay(2000 * (i + 1));
                continue;
            }

            if (res.ok) {
                return res;
            }

        } catch (error: any) {
            // Usually network failure (ECONNRESET, ETIMEDOUT, etc.)
            if (i === retries - 1) {
                throw error;
            }
            console.warn(`[fetchWithRetry] Fetch failed (${error.code || error.message}) on ${url}. Retrying ${i + 1}/${retries}...`);
            await delay(1000 * (i + 1)); // exponential backoff
        }
    }

    throw new Error(`Failed to fetch ${url} after ${retries} retries.`);
}
