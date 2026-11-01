import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/look.css";
import "./styles/ai.css";

document.documentElement.dataset.platform = window.openroll.platform;

createRoot(document.getElementById("root")!).render(<App />);
