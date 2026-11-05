import { useCallback, useMemo, useState } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback((message: string) => showToast(message, "success"), [showToast]);
  const error = useCallback((message: string) => showToast(message, "error"), [showToast]);
  const info = useCallback((message: string) => showToast(message, "info"), [showToast]);
  const warning = useCallback((message: string) => showToast(message, "warning"), [showToast]);

  // Objek pembungkusnya ikut di-memo, bukan hanya fungsi-fungsinya. Tanpa ini
  // hook mengembalikan referensi baru pada SETIAP render, dan komponen yang
  // menaruhnya di dependency array sebuah efek akan berputar tanpa henti:
  // efek → setState → render → referensi baru → efek lagi.
  //
  // Identitasnya tetap berubah saat `toasts` berubah — itu memang state, dan
  // pemanggil yang merender daftarnya harus ikut render ulang. Karena itu efek
  // yang memuat data tidak boleh bergantung pada objek ini; lihat
  // app/seller/[slug]/page.tsx.
  return useMemo(
    () => ({ toasts, removeToast, showToast, success, error, info, warning }),
    [toasts, removeToast, showToast, success, error, info, warning]
  );
}
