import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

setBaseUrl("https://homebase-ll6f.onrender.com/");

createRoot(document.getElementById("root")!).render(<App />);
