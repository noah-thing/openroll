import { createRoot } from "react-dom/client";
import { loadFonts } from "../engine/fonts";
import { App } from "./ui/App";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/look.css";
import "./styles/ai.css";

document.documentElement.dataset.platform = window.openroll.platform;

// Text boxes measure with these faces, so the first render waits for them.
void loadFonts(document.fonts).then(() => createRoot(document.getElementById("root")!).render(<App />));
