import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
// Load the local font before the first canvas render caches ruler labels.
await document.fonts.load('14px "JetBrains Mono"').catch(() => []);
createRoot(document.getElementById("root")!).render(<App />);
