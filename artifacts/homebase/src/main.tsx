import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? "https://homebase-ll6f.onrender.com").replace(/\/api\/?$/, "").replace(/\/$/, "");
setBaseUrl(API_ORIGIN);

createRoot(document.getElementById("root")!).render(<App />);
