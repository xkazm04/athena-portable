"use client";

/**
 * `Toast` - a minimal notification stack. Mutating actions confirm here; the durable record goes to
 * the activity log, not to a toast.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { clsx } from "clsx";

export type ToastTone = "info" | "success" | "warn" | "error";

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastApi {
  toast: (text: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children, ttlMs = 4000 }: { children: ReactNode; ttlMs?: number }) {
  const [items, setItems] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (text: string, tone: ToastTone = "info") => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setItems((list) => [...list, { id, text, tone }]);
      window.setTimeout(() => dismiss(id), ttlMs);
    },
    [dismiss, ttlMs],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="dk-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx("dk-toast", `dk-toast-${t.tone}`)}>
            <span>{t.text}</span>
            <button type="button" className="dk-btn dk-btn-ghost" onClick={() => dismiss(t.id)}>
              dismiss
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Throws outside a `ToastProvider` so a missing provider is caught in development, not in a demo. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
