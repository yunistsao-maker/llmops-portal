import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AppV3 from "./v3/App";
import "./styles.css";
// `vite build --mode v3` (npm run build:v3) is the v3 portal: it reads the research pipeline's views/ at run time.
const Root = import.meta.env.MODE === "v3" ? AppV3 : App;
createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
