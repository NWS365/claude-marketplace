import { HttpClients } from "./http.js";
import { TtlCache } from "./cache.js";
import { stderrLog } from "./logging.js";
export function createDeps(server) {
    const cache = new TtlCache();
    const http = new HttpClients(cache);
    return {
        jsonGet: (url, opts) => http.jsonGet(url, opts),
        xmlGet: (url, opts) => http.xmlGet(url, opts),
        legislationGet: (url, opts) => http.legislationGet(url, opts),
        legislationGetHtml: (url, opts) => http.legislationGetHtml(url, opts),
        head: (url, opts) => http.head(url, opts),
        cache,
        async sample(prompt, maxTokens = 64) {
            try {
                const caps = server.server.getClientCapabilities?.();
                if (!caps?.sampling)
                    return null;
                const res = await server.server.createMessage({
                    messages: [{ role: "user", content: { type: "text", text: prompt } }],
                    maxTokens,
                });
                const content = res.content;
                if (content && content.type === "text")
                    return content.text.trim();
                return null;
            }
            catch {
                return null;
            }
        },
        log: (event) => stderrLog(event),
    };
}
