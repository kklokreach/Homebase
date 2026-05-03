import { createRoot } from "react-dom/client";
import { getApiOrigin } from "@/lib/api-base";
import "./index.css";

function showFatal(message: string) {
  const root = document.getElementById("root");
  if (!root) return;

  root.replaceChildren();

  const wrapper = document.createElement("div");
  wrapper.style.padding = "16px";
  wrapper.style.fontFamily = "system-ui, Arial, sans-serif";
  wrapper.style.lineHeight = "1.5";
  wrapper.style.color = "#111";
  wrapper.style.background = "#fff";
  wrapper.style.minHeight = "100vh";

  const heading = document.createElement("h1");
  heading.style.fontSize = "18px";
  heading.style.margin = "0 0 12px";
  heading.textContent = "Homebase crashed on startup";

  const detail = document.createElement("pre");
  detail.style.whiteSpace = "pre-wrap";
  detail.style.wordBreak = "break-word";
  detail.style.background = "#f6f6f6";
  detail.style.padding = "12px";
  detail.style.borderRadius = "8px";
  detail.style.border = "1px solid #ddd";
  detail.textContent = String(message);

  wrapper.append(heading, detail);
  root.append(wrapper);
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

    apiClient.setBaseUrl(getApiOrigin());

    createRoot(document.getElementById("root")!).render(<App />);
  } catch (err) {
    showFatal(err instanceof Error ? err.stack || err.message : String(err));
  }
}

boot();
