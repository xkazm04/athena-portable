"use client";

/**
 * `Toast` - a minimal notification stack. Mutating actions confirm here; the durable record goes to
 * the activity log, not to a toast.
 *
 * A toast may carry ONE action - an Undo for the act it reports, typically. It is optional, so a
 * caller that passes two arguments gets exactly the toast it always got. Pressing it runs the
 * action and dismisses the toast, so one press cannot fire it twice.
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

/** The one control a toast may carry. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
  action?: ToastAction;
}

interface ToastApi {
  toast: (text: string, tone?: ToastTone, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children, ttlMs = 4000 }: { children: ReactNode; ttlMs?: number }) {
  const [items, setItems] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (text: string, tone: ToastTone = "info", action?: ToastAction) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setItems((list) => [...list, action ? { id, text, tone, action } : { id, text, tone }]);
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
            {t.action ? (
              <button
                type="button"
                className="dk-btn"
                onClick={() => {
                  dismiss(t.id);
                  t.action?.onAction();
                }}
              >
                {t.action.label}
              </button>
            ) : null}
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
