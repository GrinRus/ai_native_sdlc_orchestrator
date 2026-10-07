import { createRoot } from "react-dom/client";
import "../../../../../apps/web/src/ui/tokens.css";
import "../../../../../apps/web/src/ui/components.css";
import "./prototype.css";
import App from "./main.jsx";

createRoot(document.getElementById("root")).render(<App />);
