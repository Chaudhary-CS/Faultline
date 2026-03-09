// Entry point — client-side router + React mount

import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { AboutPage } from "./about";
import "./styles.css";

function Router() {
  const [page, setPage] = useState(window.location.pathname);

  useEffect(() => {
    const handler = () => setPage(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setPage(path);
    window.scrollTo(0, 0);
  };

  if (page === "/about") return <AboutPage navigate={navigate} />;
  return <App navigate={navigate} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);
