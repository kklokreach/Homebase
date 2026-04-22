import { createRoot } from "react-dom/client";
import "./index.css";

function showFatal(message: string) {
  const root = document.getElementById("root");
  if (!root) return;

  root.innerHTML = `
    <div style="padding:16px;font-family:system-ui,Arial,sans-serif;line-height:1.5;color:#111;background:#fff;min-height:100vh">
      <h1 style="font-size:18px;margin:0 0 12px">Homebase crashed on startup</h1>
      <pre style="white-space:pre-wrap;word-break:break-word;background:#f6f6f6;padding:12px;border-radius:8px;border:1px solid #ddd">${String(message)}</pre>
    </div>
  `;
}

window.addEventListener("error", (event) => {
  showFatal(event.error?.stack || event.message || "Unknown window error");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  showFatal(reason?.stack || reason?.message || String(reason));
});

async function boot() {
  try {
    const [{ default: App }, apiClient] = await Promise.all([
      import("./App"),
      import("@workspace/api-client-react"),
    ]);

    const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? "https://homebase-ll6f.onrender.com")
      .replace(/\/api\/?$/, "")
      .replace(/\/$/, "");

    apiClient.setBaseUrl(API_ORIGIN);

    createRoot(document.getElementById("root")!).render(<App />);
  } catch (err) {
    showFatal(err instanceof Error ? err.stack || err.message : String(err));
  }
}

boot();
