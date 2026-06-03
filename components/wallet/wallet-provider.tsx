"use client";

import * as React from "react";

type TxRequest = { to: string; data: string; value?: string };

interface WalletContextValue {
  /** Safe address the user selected in the Circles host, or null. */
  address: string | null;
  isConnected: boolean;
  /** True only when running inside the Circles host (iframe). */
  isMiniappHost: boolean;
  /** Submit a batch of transactions through the host's Safe. Returns tx hashes. */
  sendTransactions: (txs: TxRequest[]) => Promise<string[]>;
  /** Ask the host to sign a message with the user's Safe. */
  signMessage: (message: string) => Promise<{ signature: string; verified: boolean }>;
}

const WalletContext = React.createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = React.useState<string | null>(null);
  const [isMiniappHost, setIsMiniappHost] = React.useState(false);
  const sdkRef = React.useRef<typeof import("@aboutcircles/miniapp-sdk") | null>(null);

  React.useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        // The SDK touches `window`, so it must be imported on the client.
        const sdk = await import("@aboutcircles/miniapp-sdk");
        if (cancelled) return;
        sdkRef.current = sdk;

        // The SDK knows whether we're inside the Circles host iframe.
        setIsMiniappHost(sdk.isMiniappMode());

        unsubscribe = sdk.onWalletChange((addr: string | null) => {
          setAddress(addr ?? null);
        });
      } catch (err) {
        console.warn("[wallet] miniapp-sdk unavailable:", err);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const sendTransactions = React.useCallback(async (txs: TxRequest[]) => {
    const sdk = sdkRef.current;
    if (!sdk) throw new Error("Circles host not connected");
    return sdk.sendTransactions(
      txs.map((t) => ({ to: t.to, data: t.data, value: t.value ?? "0" }))
    );
  }, []);

  const signMessage = React.useCallback(async (message: string) => {
    const sdk = sdkRef.current;
    if (!sdk) throw new Error("Circles host not connected");
    return sdk.signMessage(message);
  }, []);

  const value = React.useMemo<WalletContextValue>(
    () => ({
      address,
      isConnected: Boolean(address),
      isMiniappHost,
      sendTransactions,
      signMessage,
    }),
    [address, isMiniappHost, sendTransactions, signMessage]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = React.useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within <WalletProvider>");
  return ctx;
}
