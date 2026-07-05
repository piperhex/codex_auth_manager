import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "antd/dist/reset.css";
import "./styles.css";

const isFloatingUsageWindow = new URLSearchParams(window.location.search).get("window") === "bubble";
document.documentElement.classList.toggle("floating-usage-page", isFloatingUsageWindow);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
