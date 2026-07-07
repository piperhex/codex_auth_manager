import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "antd/dist/reset.css";
import "./styles.css";

function normalizeWindowRoute(value: string | null) {
  return (value ?? "").replace(/^#\/?/, "").split(/[?#]/)[0];
}

function windowRoute() {
  const queryWindow = normalizeWindowRoute(new URLSearchParams(window.location.search).get("window"));
  const hashWindow = normalizeWindowRoute(window.location.hash);
  return queryWindow || hashWindow;
}

const currentWindowRoute = windowRoute();
document.documentElement.classList.toggle("floating-usage-page", currentWindowRoute === "bubble");
document.documentElement.classList.toggle("token-usage-page", currentWindowRoute === "token-usage");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
