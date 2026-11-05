// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useToast } from "@/hooks/useToast";

/**
 * `useToast()` mengembalikan objek literal baru pada setiap render. Semua
 * fungsinya sudah di-`useCallback`, tapi pembungkusnya tidak, sehingga
 * referensinya berubah terus.
 *
 * Komponen yang menaruh objek itu di dependency array sebuah `useEffect` yang
 * memanggil `setState` akan berputar tanpa henti: efek jalan → setState →
 * render → referensi toast baru → efek jalan lagi. Itulah yang membanjiri log
 * di halaman /seller/[slug].
 */

describe("useToast", () => {
  it("mengembalikan referensi yang sama saat render ulang tanpa perubahan state", () => {
    const { result, rerender } = renderHook(() => useToast());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("menjaga referensi fungsi aksi tetap sama walau daftar toast berubah", () => {
    const { result } = renderHook(() => useToast());
    const firstError = result.current.error;

    act(() => {
      result.current.error("gagal memuat");
    });

    expect(result.current.error).toBe(firstError);
  });

  it("tetap memperbarui daftar toast", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.success("berhasil");
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("berhasil");
  });
});
