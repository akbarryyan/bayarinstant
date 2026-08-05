"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import Sidebar from "@/components/admin/Sidebar";
import Header from "@/components/admin/Header";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Summary {
  totalOrders: number;
  successOrders: number;
  failedOrders: number;
  pendingOrders: number;
  totalRevenue: number;
  totalDiscount: number;
  totalMarkup: number;
  totalFee: number;
  newMembers: number;
  successRate: number;
}

interface ByPayment {
  method: string;
  revenue: number;
  count: number;
}

interface ByCategory {
  category: string;
  revenue: number;
  count: number;
}

interface TopBrand {
  brand: string;
  revenue: number;
  count: number;
}

interface DailyRevenue {
  date: string;
  revenue: number;
  count: number;
}

interface ReportData {
  period: { from: string; to: string };
  summary: Summary;
  byPaymentMethod: ByPayment[];
  byCategory: ByCategory[];
  topBrands: TopBrand[];
  dailyRevenue: DailyRevenue[];
  topup: { totalAmount: number; count: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRp(n: number) {
  if (n >= 1000000000) return `Rp ${(n / 1000000000).toFixed(1)}M`;
  if (n >= 1000000)    return `Rp ${(n / 1000000).toFixed(1)}jt`;
  if (n >= 1000)       return `Rp ${(n / 1000).toFixed(0)}rb`;
  return `Rp ${n}`;
}

function formatRpFull(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short" }).format(new Date(iso));
}

const RANGES = [
  { key: "7",  label: "7 Hari" },
  { key: "30", label: "30 Hari" },
  { key: "90", label: "3 Bulan" },
];

// ── Mini bar chart ─────────────────────────────────────────────────────────────

function BarChart({ data }: { data: DailyRevenue[] }) {
  const max = Math.max(...data.map((d) => d.revenue), 1);
  // Show at most 30 bars (condense if > 30)
  const bars = data.length > 30 ? data.filter((_, i) => i % Math.ceil(data.length / 30) === 0) : data;

  return (
    <div className="flex items-end gap-[2px] h-32 w-full">
      {bars.map((d) => {
        const pct = (d.revenue / max) * 100;
        return (
          <div key={d.date} className="flex flex-col items-center flex-1 min-w-0 group relative">
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
              <div className="bg-slate-800 text-white text-[10px] rounded-lg px-2 py-1 whitespace-nowrap shadow-lg">
                <p className="font-bold">{formatRpFull(d.revenue)}</p>
                <p className="text-slate-300">{d.count} transaksi</p>
                <p className="text-slate-400">{formatDate(d.date)}</p>
              </div>
              <div className="w-2 h-2 bg-slate-800 rotate-45 -mt-1" />
            </div>
            <div
              className={`w-full rounded-t-sm transition-all ${d.revenue > 0 ? "bg-blue-500 hover:bg-blue-400" : "bg-slate-100"}`}
              style={{ height: `${Math.max(pct, d.revenue > 0 ? 4 : 2)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const iconProps = { fill: "none", stroke: "currentColor", strokeWidth: 2 } as const;

function IconBanknote() {
  return (
    <svg className="h-6 w-6" {...iconProps} viewBox="0 0 24 24">
      <rect x="2" y="6" width="20" height="12" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9v0M18 15v0" />
    </svg>
  );
}

function IconCheckCircle() {
  return (
    <svg className="h-6 w-6" {...iconProps} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 12.5l2.5 2.5 5-5" />
    </svg>
  );
}

function IconXCircle() {
  return (
    <svg className="h-6 w-6" {...iconProps} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9.5l5 5m0-5l-5 5" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg className="h-6 w-6" {...iconProps} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20v-1.5a3.5 3.5 0 00-3.5-3.5h-3A3.5 3.5 0 007 18.5V20" />
      <circle cx="12" cy="8" r="3.25" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 20v-1.5a3 3 0 00-2-2.83M15.5 5.1a3.25 3.25 0 010 6.3" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg className="h-6 w-6" {...iconProps} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.5 4H6a2 2 0 00-2 2v5.5a2 2 0 00.586 1.414l8.5 8.5a2 2 0 002.828 0l5.586-5.586a2 2 0 000-2.828l-8.5-8.5A2 2 0 0011.5 4z" />
      <circle cx="8" cy="8" r="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTrendingUp() {
  return (
    <svg className="h-6 w-6" {...iconProps} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l5.5-5.5 4 4L20 7M20 7h-5M20 7v5" />
    </svg>
  );
}

function IconWallet() {
  return (
    <svg className="h-6 w-6" {...iconProps} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A2.5 2.5 0 015.5 5H18a2 2 0 012 2v1" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5v9A2.5 2.5 0 005.5 19H19a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 000 4h13" />
      <circle cx="16.5" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconHourglass() {
  return (
    <svg className="h-6 w-6" {...iconProps} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3h12M6 21h12M7 3c0 4 3.5 5.5 5 6.5 1.5-1 5-2.5 5-6.5M7 21c0-4 3.5-5.5 5-6.5 1.5 1 5 2.5 5 6.5" />
    </svg>
  );
}

function IconCreditCard() {
  return (
    <svg className="h-4 w-4" {...iconProps} viewBox="0 0 24 24">
      <rect x="2.5" y="5" width="19" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 10h19" />
    </svg>
  );
}

function IconBank() {
  return (
    <svg className="h-4 w-4" {...iconProps} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M4 21V10m16 11V10M12 3L3 8h18L12 3zM7 10v6m5-6v6m5-6v6" />
    </svg>
  );
}

function IconMoneyCircle() {
  return (
    <svg className="h-6 w-6" {...iconProps} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v10M15 9.5c0-1.1-1.34-2-3-2s-3 .9-3 2 1.34 2 3 2 3 .9 3 2-1.34 2-3 2-3-.9-3-2" />
    </svg>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, color,
}: {
  icon: ReactNode; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm text-slate-500 truncate">{label}</p>
          <p className={`mt-1.5 text-2xl font-bold ${color}`}>{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${color.replace("text-", "bg-").replace("-600", "-100").replace("-700", "-100")} ${color}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminReportsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [range, setRange]     = useState("30");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]   = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [data, setData]       = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (useCustom && fromDate && toDate) {
        params.set("from", fromDate);
        params.set("to", toDate);
      } else {
        params.set("range", range);
      }
      const res = await fetch(`/api/admin/reports?${params}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [range, useCustom, fromDate, toDate]);

  useEffect(() => {
    if (!useCustom) fetchReport();
  }, [range, useCustom, fetchReport]);

  const s = data?.summary;
  const maxCatRevenue = Math.max(...(data?.byCategory.map((c) => c.revenue) ?? [1]));
  const maxBrandRevenue = Math.max(...(data?.topBrands.map((b) => b.revenue) ?? [1]));

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:gap-6">
          <Header onMenuClick={() => setSidebarOpen(true)} />

          {/* Page header */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Laporan</h1>
              <p className="mt-1 text-sm text-slate-500">Ringkasan performa transaksi dan pendapatan</p>
            </div>
            <button
              onClick={fetchReport}
              disabled={loading}
              className="flex items-center gap-2 rounded-full bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:opacity-50 w-fit"
            >
              <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {/* ── Filter bar ── */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">Periode:</span>

            {/* Preset range buttons */}
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => { setRange(r.key); setUseCustom(false); }}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  !useCustom && range === r.key
                    ? "bg-[#2563eb] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {r.label}
              </button>
            ))}

            {/* Custom date range */}
            <button
              onClick={() => setUseCustom(true)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                useCustom ? "bg-[#2563eb] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Custom
            </button>

            {useCustom && (
              <>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
                />
                <span className="text-slate-400 text-xs">s/d</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
                />
                <button
                  onClick={fetchReport}
                  disabled={!fromDate || !toDate}
                  className="rounded-full bg-[#2563eb] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-40 transition"
                >
                  Terapkan
                </button>
              </>
            )}

            {data && (
              <span className="ml-auto text-[11px] text-slate-400">
                {new Date(data.period.from).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                {" – "}
                {new Date(data.period.to).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            )}
          </div>

          {/* ── Summary stats ── */}
          {loading && !data ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 rounded-2xl bg-slate-200 animate-pulse" />
              ))}
            </div>
          ) : s && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={<IconBanknote />} label="Total Pendapatan" value={formatRp(s.totalRevenue)} sub={formatRpFull(s.totalRevenue)} color="text-blue-700" />
              <StatCard icon={<IconCheckCircle />} label="Transaksi Sukses" value={s.successOrders.toLocaleString()} sub={`${s.successRate}% success rate`} color="text-emerald-600" />
              <StatCard icon={<IconXCircle />} label="Gagal / Expired" value={s.failedOrders.toLocaleString()} sub={`${s.totalOrders} total`} color="text-rose-600" />
              <StatCard icon={<IconUsers />} label="Member Baru" value={s.newMembers.toLocaleString()} sub="dalam periode ini" color="text-purple-600" />
            </div>
          )}

          {/* ── Row 2: extra stats ── */}
          {s && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={<IconTag />} label="Total Diskon" value={formatRp(s.totalDiscount)} sub={formatRpFull(s.totalDiscount)} color="text-amber-600" />
              <StatCard icon={<IconTrendingUp />} label="Total Markup" value={formatRp(s.totalMarkup)} sub={formatRpFull(s.totalMarkup)} color="text-indigo-600" />
              <StatCard icon={<IconWallet />} label="Biaya Gateway" value={formatRp(s.totalFee)} sub={formatRpFull(s.totalFee)} color="text-slate-600" />
              <StatCard icon={<IconHourglass />} label="Transaksi Pending" value={s.pendingOrders.toLocaleString()} sub="belum selesai" color="text-amber-600" />
            </div>
          )}

          {/* ── Daily chart ── */}
          {data && data.dailyRevenue.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-800">Pendapatan Harian</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Pendapatan dari transaksi sukses</p>
                </div>
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
                  {data.dailyRevenue.length} hari
                </span>
              </div>
              <BarChart data={data.dailyRevenue} />
              {/* x-axis labels */}
              {data.dailyRevenue.length <= 30 && (
                <div className="flex justify-between mt-2">
                  <span className="text-[10px] text-slate-400">{formatDate(data.dailyRevenue[0].date)}</span>
                  <span className="text-[10px] text-slate-400">{formatDate(data.dailyRevenue[Math.floor(data.dailyRevenue.length / 2)].date)}</span>
                  <span className="text-[10px] text-slate-400">{formatDate(data.dailyRevenue[data.dailyRevenue.length - 1].date)}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Payment method + Top Up row ── */}
          {data && (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* By payment method */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-bold text-slate-800 mb-1">Metode Pembayaran</h2>
                <p className="text-xs text-slate-400 mb-4">Transaksi sukses per metode</p>
                {data.byPaymentMethod.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">Belum ada data</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {data.byPaymentMethod.map((pm) => {
                      const totalPmRevenue = data.byPaymentMethod.reduce((s, x) => s + x.revenue, 0);
                      const pct = totalPmRevenue > 0 ? Math.round((pm.revenue / totalPmRevenue) * 100) : 0;
                      return (
                        <div key={pm.method}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500">{pm.method === "WALLET" ? <IconCreditCard /> : <IconBank />}</span>
                              <span className="text-sm font-semibold text-slate-700">
                                {pm.method === "WALLET" ? "Saldo Wallet" : "Payment Gateway"}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-bold text-slate-800">{formatRp(pm.revenue)}</span>
                              <span className="ml-2 text-[11px] text-slate-400">{pm.count} trx</span>
                            </div>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">{pct}% dari total transaksi</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Top Up summary */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-bold text-slate-800 mb-1">Top Up Wallet</h2>
                <p className="text-xs text-slate-400 mb-4">Total deposit member dalam periode</p>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4 p-4 bg-purple-50 rounded-2xl">
                    <div className="w-12 h-12 rounded-2xl bg-purple-100 flex items-center justify-center text-purple-600 flex-shrink-0"><IconMoneyCircle /></div>
                    <div>
                      <p className="text-xs text-slate-500">Total Top Up Masuk</p>
                      <p className="text-xl font-bold text-purple-700">{formatRpFull(data.topup.totalAmount)}</p>
                      <p className="text-xs text-slate-400">{data.topup.count} permintaan selesai</p>
                    </div>
                  </div>
                  {s && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-slate-50 rounded-xl text-center">
                        <p className="text-[11px] text-slate-400">Avg. per Order</p>
                        <p className="text-base font-bold text-slate-700">
                          {s.successOrders > 0 ? formatRp(s.totalRevenue / s.successOrders) : "Rp 0"}
                        </p>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-xl text-center">
                        <p className="text-[11px] text-slate-400">Net Profit Est.</p>
                        <p className="text-base font-bold text-emerald-600">
                          {formatRp(s.totalMarkup - s.totalDiscount - s.totalFee)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Category + Top Brands row ── */}
          {data && (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* By category */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-bold text-slate-800 mb-1">Pendapatan per Kategori</h2>
                <p className="text-xs text-slate-400 mb-4">Top 8 kategori produk</p>
                {data.byCategory.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">Belum ada data</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {data.byCategory.map((c, i) => {
                      const pct = Math.round((c.revenue / maxCatRevenue) * 100);
                      const colors = ["bg-blue-500", "bg-purple-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-orange-500"];
                      return (
                        <div key={c.category}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-slate-700 capitalize truncate max-w-[60%]">
                              {c.category.replace(/-/g, " ")}
                            </span>
                            <span className="text-xs font-bold text-slate-800 ml-2">{formatRp(c.revenue)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${colors[i % colors.length]}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] text-slate-400 w-8 text-right">{c.count}x</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Top brands */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-bold text-slate-800 mb-1">Top 10 Brand</h2>
                <p className="text-xs text-slate-400 mb-4">Brand dengan pendapatan tertinggi</p>
                {data.topBrands.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">Belum ada data</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.topBrands.map((b, i) => {
                      const pct = Math.round((b.revenue / maxBrandRevenue) * 100);
                      return (
                        <div key={b.brand} className="flex items-center gap-3">
                          <span className="w-5 text-center text-[11px] font-bold text-slate-400 flex-shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-slate-700 truncate">{b.brand}</span>
                              <span className="text-xs font-bold text-slate-800 ml-2 flex-shrink-0">{formatRp(b.revenue)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-[#2563eb] rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-400 w-8 text-right">{b.count}x</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Daily revenue table ── */}
          {data && data.dailyRevenue.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-800">Detail Harian</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Rincian transaksi per hari</p>
                </div>
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
                  {data.dailyRevenue.length} hari
                </span>
              </div>

              {/* Mobile: card list */}
              <div className="sm:hidden divide-y divide-slate-50">
                {[...data.dailyRevenue].reverse().map((d) => (
                  <div key={d.date} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700">
                        {new Date(d.date).toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{d.count} transaksi</p>
                    </div>
                    <p className={`text-sm font-semibold flex-shrink-0 ml-3 ${d.revenue > 0 ? "text-emerald-600" : "text-slate-300"}`}>
                      {d.revenue > 0 ? formatRpFull(d.revenue) : "–"}
                    </p>
                  </div>
                ))}
                {/* Total */}
                <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-200">
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Total</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {data.dailyRevenue.reduce((s, d) => s + d.count, 0)} transaksi
                    </p>
                  </div>
                  <p className="text-sm font-bold text-emerald-600 flex-shrink-0 ml-3">
                    {formatRpFull(data.dailyRevenue.reduce((s, d) => s + d.revenue, 0))}
                  </p>
                </div>
              </div>

              {/* Desktop: full table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Tanggal</th>
                      <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Transaksi</th>
                      <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Pendapatan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {[...data.dailyRevenue].reverse().map((d) => (
                      <tr key={d.date} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 text-slate-700 font-medium">
                          {new Date(d.date).toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-600">{d.count}</td>
                        <td className={`px-5 py-3 text-right font-semibold ${d.revenue > 0 ? "text-emerald-600" : "text-slate-300"}`}>
                          {d.revenue > 0 ? formatRpFull(d.revenue) : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200">
                    <tr>
                      <td className="px-5 py-3 text-xs font-bold text-slate-600 uppercase">Total</td>
                      <td className="px-5 py-3 text-right text-sm font-bold text-slate-700">
                        {data.dailyRevenue.reduce((s, d) => s + d.count, 0)}
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-bold text-emerald-600">
                        {formatRpFull(data.dailyRevenue.reduce((s, d) => s + d.revenue, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
