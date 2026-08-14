import { getSiteConfig } from "@/lib/site-config";
import { createLogger } from "@/src/infra/logging/logger";
import { maskAccountNumber } from "@/src/infra/logging/redaction";

const log = createLogger("payment.poppay", { module: "client" });

interface PoppayBankListFilter {
  key: string;
  value: string;
}

interface PoppayBankRecord {
  m_b_c: string;
  m_b_n: string;
  m_b_s: string;
  m_b_cu: string;
  m_b_ia: boolean;
  m_b_ca: string;
  m_b_cb: string;
  m_b_ua: string;
  m_b_im: boolean;
}

interface PoppayBankListResponse {
  success: boolean;
  code: number;
  data?: {
    recordsTotal: number;
    recordsFiltered: number;
    draw: number;
    data: PoppayBankRecord[];
    other: unknown;
  };
  message?: string;
}

interface PoppayCreateIncomingResponse {
  success: boolean;
  code: number;
  data?: {
    ref_id: string;
    ext_ref_id: string;
    agg_ref_id: string;
    checkout_url: string;
    expired_at: string;
    raw_qr: string;
  };
  message?: string;
}

interface PoppayCreateOutgoingResponse {
  success: boolean;
  code: number;
  data?: {
    ref_id: string;
    agg_ref_id: string;
    possible_after_balance?: number;
  };
  message?: string;
}

interface PoppayAuthLoginResponse {
  success: boolean;
  code: number;
  data?: {
    access_token?: string;
    email?: string;
    role_name?: string;
    "2fa_status"?: string;
  } | null;
  message?: string;
}

interface PoppayIncomingInquiryResponse {
  success: boolean;
  code: number;
  data?: Record<string, unknown> | null;
  message?: string;
}

export interface ListBanksInput {
  start?: number;
  length?: number;
  filters?: PoppayBankListFilter[];
}

export interface PoppayBank {
  code: string;
  name: string;
  swiftCode: string;
  currency: string;
  isActive: boolean;
  isManual: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CreateIncomingInput {
  aggRefId: string;
  amount: number;
  notes: string;
  payorName?: string | null;
  payorEmail?: string | null;
  callbackUrl?: string | null;
  expirationInterval?: number;
}

export interface PoppayIncomingTransaction {
  refId: string;
  externalRefId: string;
  aggregatorRefId: string;
  checkoutUrl: string;
  expiredAt: string;
  rawQr: string;
}

export interface PoppayIncomingInquiryResult {
  uid: string;
  status: "pending" | "completed" | "expired" | "failed" | "unknown";
  statusCode?: number;
  raw: Record<string, unknown> | null;
}

export interface CreateOutgoingInput {
  aggRefId: string;
  amount: number;
  bankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  notes?: string | null;
  callbackUrl?: string | null;
}

export interface PoppayOutgoingTransaction {
  refId: string;
  aggregatorRefId: string;
  possibleAfterBalance?: number;
  raw: Record<string, unknown> | null;
}

function mapPoppayStatusCode(statusCode: number | null | undefined): PoppayIncomingInquiryResult["status"] {
  if (statusCode === 0) return "pending";
  if (statusCode === 1 || statusCode === 2 || statusCode === 4) return "failed";
  if (statusCode === 3) return "expired";
  if (statusCode === 5) return "completed";
  return "unknown";
}

interface PoppayRuntimeConfig {
  baseUrl: string;
  versionPath: string;
  integratorToken: string;
  aggregatorCode: string;
  merchantAccountNumber: string;
  secretKey: string;
  email: string;
  password: string;
}

export interface PoppayDebugConfigSummary {
  baseUrl: string;
  versionPath: string;
  hasIntegratorToken: boolean;
  hasAggregatorCode: boolean;
  hasMerchantAccountNumber: boolean;
  merchantAccountNumberPreview?: string | null;
  hasValidMerchantAccountNumber: boolean;
  hasSecretKey: boolean;
  hasEmail: boolean;
  hasPassword: boolean;
}

const tokenCache = globalThis as unknown as {
  _poppayAccessToken?: string;
  _poppayAccessTokenAt?: number;
  _poppayAccessTokenFor?: string;
};

// Client Poppay menginfokan access token berlaku 30 menit.
// Kita refresh sedikit lebih cepat agar request create/inquiry tidak mepet expiry.
const ACCESS_TOKEN_TTL_MS = 25 * 60 * 1000;

function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function buildPoppayBaseUrlFromValues(explicitBaseValue: string, hostValue: string, portValue: string): string {
  const explicitBase = normalizeOrigin(explicitBaseValue);
  if (explicitBase) return explicitBase;

  const host = normalizeOrigin(hostValue);
  if (!host) return "";

  const port = portValue.trim();
  if (!port) return host;
  if (/:\d+$/.test(host)) return host;
  return `${host}:${port}`;
}

function buildPoppayVersionPath(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function normalizePoppayMerchantAccountNumber(value: string): string {
  return value.trim().replace(/[^\d]/g, "");
}

function parsePoppayMerchantAccountNumber(value: string): number | null {
  const normalized = normalizePoppayMerchantAccountNumber(value);
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

async function getPoppayRuntimeConfig(): Promise<PoppayRuntimeConfig> {
  const [
    dbApiBaseUrl,
    dbHost,
    dbPort,
    dbVersion,
    dbIntegratorToken,
    dbAggregatorCode,
    dbMerchantAccountNumber,
    dbSecretKey,
    dbEmail,
    dbPassword,
  ] = await Promise.all([
    getSiteConfig("POPPAY_API_BASE_URL"),
    getSiteConfig("POPPAY_URL"),
    getSiteConfig("POPPAY_PORT"),
    getSiteConfig("POPPAY_VERSION"),
    getSiteConfig("POPPAY_INTEGRATOR_TOKEN"),
    getSiteConfig("POPPAY_AGGREGATOR_CODE"),
    getSiteConfig("POPPAY_MERCHANT_ACCOUNT_NUMBER"),
    getSiteConfig("POPPAY_SECRET_KEY"),
    getSiteConfig("POPPAY_EMAIL"),
    getSiteConfig("POPPAY_PASSWORD"),
  ]);

  const baseUrl = buildPoppayBaseUrlFromValues(
    dbApiBaseUrl || process.env.POPPAY_API_BASE_URL || "",
    dbHost || process.env.POPPAY_URL || "",
    dbPort || process.env.POPPAY_PORT || ""
  );

  return {
    baseUrl,
    versionPath: buildPoppayVersionPath(dbVersion || process.env.POPPAY_VERSION || ""),
    integratorToken: (dbIntegratorToken || process.env.POPPAY_INTEGRATOR_TOKEN || "").trim(),
    aggregatorCode: (dbAggregatorCode || process.env.POPPAY_AGGREGATOR_CODE || "").trim(),
    merchantAccountNumber: normalizePoppayMerchantAccountNumber(
      dbMerchantAccountNumber || process.env.POPPAY_MERCHANT_ACCOUNT_NUMBER || ""
    ),
    secretKey: (dbSecretKey || process.env.POPPAY_SECRET_KEY || "").trim(),
    email: (dbEmail || process.env.POPPAY_EMAIL || "").trim(),
    password: (dbPassword || process.env.POPPAY_PASSWORD || "").trim(),
  };
}

export async function isPoppayConfigured(): Promise<boolean> {
  const cfg = await getPoppayRuntimeConfig();
  return Boolean(
    cfg.baseUrl &&
    cfg.versionPath &&
    cfg.integratorToken &&
    cfg.aggregatorCode &&
    cfg.merchantAccountNumber &&
    cfg.email &&
    cfg.password
  );
}

export async function getPoppayDebugConfigSummary(): Promise<PoppayDebugConfigSummary> {
  const cfg = await getPoppayRuntimeConfig();
  const merchantAccountNumber = cfg.merchantAccountNumber;
  const merchantAccountNumberPreview = merchantAccountNumber
    ? `${merchantAccountNumber.slice(0, 3)}...${merchantAccountNumber.slice(-4)}`
    : null;
  return {
    baseUrl: cfg.baseUrl,
    versionPath: cfg.versionPath,
    hasIntegratorToken: Boolean(cfg.integratorToken),
    hasAggregatorCode: Boolean(cfg.aggregatorCode),
    hasMerchantAccountNumber: Boolean(merchantAccountNumber),
    merchantAccountNumberPreview,
    hasValidMerchantAccountNumber: parsePoppayMerchantAccountNumber(merchantAccountNumber) !== null,
    hasSecretKey: Boolean(cfg.secretKey),
    hasEmail: Boolean(cfg.email),
    hasPassword: Boolean(cfg.password),
  };
}

export class PoppayClient {
  private async requireConfig(): Promise<PoppayRuntimeConfig> {
    const cfg = await getPoppayRuntimeConfig();
    if (!cfg.baseUrl || !cfg.versionPath || !cfg.integratorToken || !cfg.email || !cfg.password) {
      // Summary ini sudah dirancang bebas rahasia (hanya boolean + preview).
      log.error(await getPoppayDebugConfigSummary(), "poppay not configured");
      throw new Error(
        "Poppay belum terkonfigurasi. Isi URL/API base, version, integrator token, login email, dan login password."
      );
    }
    return cfg;
  }

  private getCacheKey(config: PoppayRuntimeConfig): string {
    return [config.baseUrl, config.versionPath, config.integratorToken, config.email].join("|");
  }

  private async login(config: PoppayRuntimeConfig): Promise<string> {
    const endpoint = `${config.baseUrl}/${config.versionPath}/auth/login`;
    const startedAt = performance.now();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "insomnia/8.1.0",
        "Accept-Language": "en",
        Accept: "application/json; charset=UTF-8",
        Authorization: `Bearer ${config.integratorToken}`,
      },
      body: JSON.stringify({
        email: config.email,
        password: config.password,
      }),
      cache: "no-store",
    });

    let json: PoppayAuthLoginResponse | null = null;
    try {
      json = (await res.json()) as PoppayAuthLoginResponse;
    } catch {
      throw new Error(`Respons login Poppay tidak valid (HTTP ${res.status}).`);
    }

    const durationMs = Math.round(performance.now() - startedAt);
    const accessToken = json?.data?.access_token?.trim();
    if (!res.ok || !json?.success || !accessToken) {
      log.error(
        { endpoint, httpStatus: res.status, durationMs, gatewayMessage: json?.message },
        "poppay login failed"
      );
      throw new Error(json?.message || `Login Poppay gagal (HTTP ${res.status}).`);
    }

    log.info({ endpoint, httpStatus: res.status, durationMs }, "poppay login ok");

    tokenCache._poppayAccessToken = accessToken;
    tokenCache._poppayAccessTokenAt = Date.now();
    tokenCache._poppayAccessTokenFor = this.getCacheKey(config);
    return accessToken;
  }

  private async getAccessToken(config: PoppayRuntimeConfig, forceRefresh = false): Promise<string> {
    const cacheKey = this.getCacheKey(config);
    const hasFreshCache =
      !forceRefresh &&
      tokenCache._poppayAccessToken &&
      tokenCache._poppayAccessTokenFor === cacheKey &&
      tokenCache._poppayAccessTokenAt &&
      Date.now() - tokenCache._poppayAccessTokenAt < ACCESS_TOKEN_TTL_MS;

    if (hasFreshCache) {
      return tokenCache._poppayAccessToken!;
    }

    return this.login(config);
  }

  private async getFreshAccessToken(config: PoppayRuntimeConfig): Promise<string> {
    return this.login(config);
  }

  private async authorizedFetch(
    config: PoppayRuntimeConfig,
    endpoint: string,
    init: RequestInit
  ): Promise<Response> {
    const makeRequest = async (forceRefresh = false) => {
      const accessToken = await this.getAccessToken(config, forceRefresh);
      const headers = new Headers(init.headers ?? {});
      headers.set("Authorization", `Bearer ${accessToken}`);
      headers.set("User-Agent", headers.get("User-Agent") ?? "insomnia/8.1.0");
      headers.set("Accept-Language", headers.get("Accept-Language") ?? "en");
      headers.set("Accept", headers.get("Accept") ?? "application/json; charset=UTF-8");

      return fetch(endpoint, {
        ...init,
        headers,
        cache: "no-store",
      });
    };

    let res = await makeRequest(false);
    const rotatedToken = res.headers.get("Nrt")?.trim();
    if (rotatedToken) {
      tokenCache._poppayAccessToken = rotatedToken;
      tokenCache._poppayAccessTokenAt = Date.now();
      tokenCache._poppayAccessTokenFor = this.getCacheKey(config);
    }
    if (res.status === 401) {
      log.warn({ endpoint }, "poppay 401 — retrying with fresh token");
      res = await makeRequest(true);
      const retriedToken = res.headers.get("Nrt")?.trim();
      if (retriedToken) {
        tokenCache._poppayAccessToken = retriedToken;
        tokenCache._poppayAccessTokenAt = Date.now();
        tokenCache._poppayAccessTokenFor = this.getCacheKey(config);
      }
    }
    return res;
  }

  private async oneShotAuthorizedFetch(
    config: PoppayRuntimeConfig,
    endpoint: string,
    init: RequestInit
  ): Promise<Response> {
    const makeRequest = async () => {
      const accessToken = await this.getFreshAccessToken(config);
      const headers = new Headers(init.headers ?? {});
      headers.set("Authorization", `Bearer ${accessToken}`);
      headers.set("User-Agent", headers.get("User-Agent") ?? "insomnia/8.1.0");
      headers.set("Accept-Language", headers.get("Accept-Language") ?? "en");
      headers.set("Accept", headers.get("Accept") ?? "application/json; charset=UTF-8");

      return fetch(endpoint, {
        ...init,
        headers,
        cache: "no-store",
      });
    };

    let res = await makeRequest();
    const rotatedToken = res.headers.get("Nrt")?.trim();
    if (rotatedToken) {
      tokenCache._poppayAccessToken = rotatedToken;
      tokenCache._poppayAccessTokenAt = Date.now();
      tokenCache._poppayAccessTokenFor = this.getCacheKey(config);
    }
    if (res.status === 401) {
      log.warn({ endpoint }, "poppay 401 — retrying with fresh token");
      res = await makeRequest();
      const retriedToken = res.headers.get("Nrt")?.trim();
      if (retriedToken) {
        tokenCache._poppayAccessToken = retriedToken;
        tokenCache._poppayAccessTokenAt = Date.now();
        tokenCache._poppayAccessTokenFor = this.getCacheKey(config);
      }
    }
    return res;
  }

  async listBanks(input: ListBanksInput = {}): Promise<{
    recordsTotal: number;
    recordsFiltered: number;
    draw: number;
    data: PoppayBank[];
  }> {
    const config = await this.requireConfig();
    const endpoint = `${config.baseUrl}/${config.versionPath}/master/bank/list`;
    const payload = {
      start: input.start ?? 0,
      length: input.length ?? 50,
      filters: input.filters ?? [{ key: "c", value: "IDR" }],
    };

    const res = await this.authorizedFetch(config, endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    let json: PoppayBankListResponse | null = null;
    try {
      json = (await res.json()) as PoppayBankListResponse;
    } catch {
      throw new Error(`Respons Poppay tidak valid (HTTP ${res.status}).`);
    }

    if (!res.ok || !json?.success || !json.data) {
      throw new Error(json?.message || `Gagal mengambil daftar bank Poppay (HTTP ${res.status}).`);
    }

    return {
      recordsTotal: json.data.recordsTotal,
      recordsFiltered: json.data.recordsFiltered,
      draw: json.data.draw,
      data: json.data.data.map((item) => ({
        code: item.m_b_c,
        name: item.m_b_n,
        swiftCode: item.m_b_s,
        currency: item.m_b_cu,
        isActive: item.m_b_ia,
        isManual: item.m_b_im,
        createdAt: item.m_b_ca,
        updatedAt: item.m_b_ua,
        createdBy: item.m_b_cb,
      })),
    };
  }

  async createIncoming(input: CreateIncomingInput): Promise<PoppayIncomingTransaction> {
    const config = await this.requireConfig();
    const endpoint = `${config.baseUrl}/${config.versionPath}/transaction/in/create`;
    const aggCode = config.aggregatorCode;
    const merchantAccNum = parsePoppayMerchantAccountNumber(config.merchantAccountNumber);

    if (!aggCode || !merchantAccNum) {
      throw new Error(
        "POPPAY_AGGREGATOR_CODE dan POPPAY_MERCHANT_ACCOUNT_NUMBER wajib diisi dengan nilai yang valid."
      );
    }

    const payload = {
      agg_code: aggCode,
      merchant_acc_num: merchantAccNum,
      agg_ref_id: input.aggRefId,
      notes: input.notes,
      amount: input.amount,
      callback_url: input.callbackUrl ?? null,
      payor_email: input.payorEmail ?? null,
      payor_name: input.payorName ?? null,
      expiration_interval: input.expirationInterval ?? 30,
    };

    // Baris terpenting di seluruh jalur pembayaran: mencatat persis apa yang
    // kita kirim ke gateway, termasuk callback_url. Tanpa ini, callback yang
    // tidak pernah datang mustahil didiagnosis dari sisi kita.
    log.info(
      {
        endpoint,
        aggRefId: input.aggRefId,
        amount: input.amount,
        callbackUrl: input.callbackUrl ?? null,
        expirationInterval: payload.expiration_interval,
        hasPayorEmail: Boolean(input.payorEmail),
      },
      "poppay create incoming request"
    );

    const startedAt = performance.now();
    const res = await this.oneShotAuthorizedFetch(config, endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const durationMs = Math.round(performance.now() - startedAt);

    let json: PoppayCreateIncomingResponse | null = null;
    try {
      json = (await res.json()) as PoppayCreateIncomingResponse;
    } catch {
      log.error(
        { endpoint, aggRefId: input.aggRefId, httpStatus: res.status, durationMs },
        "poppay create incoming: invalid json response"
      );
      throw new Error(`Respons create incoming Poppay tidak valid (HTTP ${res.status}).`);
    }

    if (!res.ok || !json?.success || !json.data) {
      log.error(
        {
          endpoint,
          aggRefId: input.aggRefId,
          httpStatus: res.status,
          durationMs,
          gatewayCode: json?.code,
          gatewayMessage: json?.message,
        },
        "poppay create incoming failed"
      );
      throw new Error(json?.message || `Gagal membuat QRIS Poppay (HTTP ${res.status}).`);
    }

    log.info(
      {
        aggRefId: json.data.agg_ref_id,
        refId: json.data.ref_id,
        extRefId: json.data.ext_ref_id,
        expiredAt: json.data.expired_at,
        // raw_qr adalah instrumen pembayaran — panjangnya saja sudah cukup
        // untuk memastikan QR benar-benar terbentuk.
        rawQrLength: json.data.raw_qr?.length ?? 0,
        httpStatus: res.status,
        durationMs,
      },
      "poppay create incoming ok"
    );

    const checkoutUrl = /^https?:\/\//i.test(json.data.checkout_url)
      ? json.data.checkout_url
      : `${config.baseUrl}/${json.data.checkout_url.replace(/^\/+/, "")}`;

    return {
      refId: json.data.ref_id,
      externalRefId: json.data.ext_ref_id,
      aggregatorRefId: json.data.agg_ref_id,
      checkoutUrl,
      expiredAt: json.data.expired_at,
      rawQr: json.data.raw_qr,
    };
  }

  async createOutgoing(input: CreateOutgoingInput): Promise<PoppayOutgoingTransaction> {
    const config = await this.requireConfig();
    const endpoint = `${config.baseUrl}/${config.versionPath}/transaction/out/create`;
    const aggCode = config.aggregatorCode;
    const merchantAccNum = parsePoppayMerchantAccountNumber(config.merchantAccountNumber);

    if (!aggCode || !merchantAccNum) {
      throw new Error(
        "POPPAY_AGGREGATOR_CODE dan POPPAY_MERCHANT_ACCOUNT_NUMBER wajib diisi dengan nilai yang valid."
      );
    }

    const payload = {
      agg_code: aggCode,
      merchant_acc_num: merchantAccNum,
      bank_code: input.bankCode.trim(),
      dst_acc_num: input.destinationAccountNumber.trim(),
      dst_name: input.destinationAccountName.trim(),
      agg_ref_id: input.aggRefId,
      notes: input.notes?.trim() || null,
      amount: input.amount,
      callback_url: input.callbackUrl ?? null,
    };

    // Ini uang KELUAR — jejaknya wajib ada. Nomor rekening tujuan di-mask.
    log.info(
      {
        endpoint,
        aggRefId: input.aggRefId,
        amount: input.amount,
        bankCode: payload.bank_code,
        dstAccNum: maskAccountNumber(payload.dst_acc_num),
        callbackUrl: input.callbackUrl ?? null,
      },
      "poppay create outgoing request"
    );

    const startedAt = performance.now();
    const res = await this.oneShotAuthorizedFetch(config, endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const durationMs = Math.round(performance.now() - startedAt);

    let json: PoppayCreateOutgoingResponse | null = null;
    try {
      json = (await res.json()) as PoppayCreateOutgoingResponse;
    } catch {
      log.error(
        { endpoint, aggRefId: input.aggRefId, httpStatus: res.status, durationMs },
        "poppay create outgoing: invalid json response"
      );
      throw new Error(`Respons create outgoing Poppay tidak valid (HTTP ${res.status}).`);
    }

    if (!res.ok || !json?.success || !json.data) {
      log.error(
        {
          endpoint,
          aggRefId: input.aggRefId,
          httpStatus: res.status,
          durationMs,
          gatewayCode: json?.code,
          gatewayMessage: json?.message,
        },
        "poppay create outgoing failed"
      );
      throw new Error(json?.message || `Gagal membuat payout Poppay (HTTP ${res.status}).`);
    }

    log.info(
      {
        aggRefId: json.data.agg_ref_id,
        refId: json.data.ref_id,
        httpStatus: res.status,
        durationMs,
      },
      "poppay create outgoing ok"
    );

    return {
      refId: json.data.ref_id,
      aggregatorRefId: json.data.agg_ref_id,
      possibleAfterBalance:
        typeof json.data.possible_after_balance === "number" ? json.data.possible_after_balance : undefined,
      raw: (json.data as Record<string, unknown>) ?? null,
    };
  }

  async inquireIncoming(uid: string): Promise<PoppayIncomingInquiryResult> {
    const config = await this.requireConfig();
    const safeUid = uid.trim();
    if (!safeUid) {
      throw new Error("uid inquiry wajib diisi.");
    }

    const endpoint = `${config.baseUrl}/${config.versionPath}/transaction/in/inquiry/${encodeURIComponent(safeUid)}`;
    const startedAt = performance.now();
    const res = await this.authorizedFetch(config, endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const durationMs = Math.round(performance.now() - startedAt);

    let json: PoppayIncomingInquiryResponse | null = null;
    try {
      json = (await res.json()) as PoppayIncomingInquiryResponse;
    } catch {
      log.error(
        { uid: safeUid, httpStatus: res.status, durationMs },
        "poppay inquiry: invalid json response"
      );
      throw new Error(`Respons inquiry Poppay tidak valid (HTTP ${res.status}).`);
    }

    if (!res.ok || !json?.success) {
      log.error(
        {
          uid: safeUid,
          httpStatus: res.status,
          durationMs,
          gatewayCode: json?.code,
          gatewayMessage: json?.message,
        },
        "poppay inquiry failed"
      );
      throw new Error(json?.message || `Gagal inquiry transaksi Poppay (HTTP ${res.status}).`);
    }

    const raw = json.data ?? null;
    const rawStatusCode =
      typeof raw?.status === "number"
        ? raw.status
        : typeof raw?.status === "string" && /^\d+$/.test(raw.status)
        ? Number(raw.status)
        : typeof raw?.transaction_status === "number"
        ? raw.transaction_status
        : typeof raw?.transaction_status === "string" && /^\d+$/.test(raw.transaction_status)
        ? Number(raw.transaction_status)
        : typeof raw?.payment_status === "number"
        ? raw.payment_status
        : typeof raw?.payment_status === "string" && /^\d+$/.test(raw.payment_status)
        ? Number(raw.payment_status)
        : null;

    const mappedStatus = mapPoppayStatusCode(rawStatusCode);

    // mappedStatus ikut dilog supaya kalau Poppay menambah kode status baru,
    // "unknown" langsung terlihat — bukan diam-diam jadi "pending".
    log.info(
      { uid: safeUid, httpStatus: res.status, durationMs, rawStatusCode, mappedStatus },
      "poppay inquiry ok"
    );

    return {
      uid: safeUid,
      status: mappedStatus,
      statusCode: rawStatusCode ?? undefined,
      raw,
    };
  }

  async testAuth(): Promise<{
    email: string;
    roleName: string | null;
    tokenPreview: string;
  }> {
    const config = await this.requireConfig();
    const token = await this.login(config);
    return {
      email: config.email,
      roleName: null,
      tokenPreview: `${token.slice(0, 10)}...`,
    };
  }
}
