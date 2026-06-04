"use client";

import * as React from "react";

/**
 * Loaded inside the OAuth popup after Lichess redirects back. It hands the
 * `code`/`state` to the opener window and closes itself.
 */
export default function LichessCallback() {
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const payload = {
      type: "lichess-oauth" as const,
      code: p.get("code"),
      state: p.get("state"),
      error: p.get("error"),
    };
    if (window.opener) {
      window.opener.postMessage(payload, window.location.origin);
      window.close();
    }
  }, []);

  return (
    <main
      style={{
        display: "flex",
        minHeight: "100dvh",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        color: "#51526e",
        padding: 24,
        textAlign: "center",
      }}
    >
      Connecting your Lichess account… you can close this window.
    </main>
  );
}
