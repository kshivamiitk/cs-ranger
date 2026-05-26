"use client";

import axios, { AxiosError, type AxiosInstance } from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";
const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";
const IS_DEV = process.env.NODE_ENV !== "production";

let _axios: AxiosInstance | null = null;
let isRefreshing = false;
let refreshWaiters: ((token: string | null) => void)[] = [];

// Dev-only client-side timing: surfaces slow API fetches in the browser console
// without any extra tooling. Never logs request bodies, tokens, or response data.
type TimedConfig = { metadata?: { start: number }; method?: string; url?: string };
function logTiming(config: TimedConfig | undefined, status: number) {
  const meta = config?.metadata;
  if (!IS_DEV || typeof window === "undefined" || !meta) return;
  const ms = Math.round((performance.now() - meta.start) * 10) / 10;
  const label = `[api] ${(config?.method || "get").toUpperCase()} ${config?.url} → ${status} ${ms}ms`;
  // eslint-disable-next-line no-console
  console[ms > 500 ? "warn" : "debug"](label);
}

function axiosClient(): AxiosInstance {
  if (_axios) return _axios;
  _axios = axios.create({
    baseURL: API_URL,
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
  });

  _axios.interceptors.request.use((config) => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("access_token");
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
    if (IS_DEV) (config as TimedConfig).metadata = { start: performance.now() };
    return config;
  });

  _axios.interceptors.response.use(
    (r) => {
      logTiming(r.config as TimedConfig, r.status);
      return r;
    },
    async (error: AxiosError) => {
      logTiming(error.config as TimedConfig, error.response?.status ?? 0);
      const original = error.config as AxiosError["config"] & { _retry?: boolean };
      if (error.response?.status === 401 && !original?._retry && typeof window !== "undefined") {
        original!._retry = true;
        const refreshToken = localStorage.getItem("refresh_token");
        if (!refreshToken) {
          return Promise.reject(error);
        }
        if (isRefreshing) {
          return new Promise<string | null>((resolve) => refreshWaiters.push(resolve)).then((token) => {
            if (!token) return Promise.reject(error);
            original!.headers!.Authorization = `Bearer ${token}`;
            return _axios!.request(original!);
          });
        }
        isRefreshing = true;
        try {
          const r = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
          const newAccess = r.data?.data?.accessToken as string;
          const newRefresh = r.data?.data?.refreshToken as string;
          localStorage.setItem("access_token", newAccess);
          localStorage.setItem("refresh_token", newRefresh);
          refreshWaiters.forEach((w) => w(newAccess));
          refreshWaiters = [];
          original!.headers!.Authorization = `Bearer ${newAccess}`;
          return _axios!.request(original!);
        } catch {
          refreshWaiters.forEach((w) => w(null));
          refreshWaiters = [];
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          window.location.href = "/login";
          return Promise.reject(error);
        } finally {
          isRefreshing = false;
        }
      }
      return Promise.reject(error);
    },
  );
  return _axios;
}

export interface ApiResponse<T> { success: boolean; data?: T; error?: { message: string; code?: string }; meta?: Record<string, unknown> }

async function unwrap<T>(call: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  try {
    const res = await call;
    if (!res.data?.success) throw new Error(res.data?.error?.message || "Request failed");
    return res.data.data as T;
  } catch (err) {
    // Axios rejects on any non-2xx, so the backend's helpful message (e.g.
    // "Email already registered") lives on err.response.data, not res.data.
    // Surface it so callers/forms show the real reason instead of "Request failed with status code 409".
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as ApiResponse<unknown> | undefined;
      throw new Error(body?.error?.message || err.message);
    }
    throw err;
  }
}

// Variant that also surfaces the response meta (pagination cursors, totals).
// `unwrap` discards meta because the vast majority of endpoints just need data;
// the catalog feed is one of the few that needs hasMore/total to drive
// useInfiniteQuery.
async function unwrapWithMeta<T>(call: Promise<{ data: ApiResponse<T> & { meta?: Record<string, unknown> } }>): Promise<{ data: T; meta: Record<string, unknown> }> {
  try {
    const res = await call;
    if (!res.data?.success) throw new Error(res.data?.error?.message || "Request failed");
    return { data: res.data.data as T, meta: res.data.meta || {} };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as ApiResponse<unknown> | undefined;
      throw new Error(body?.error?.message || err.message);
    }
    throw err;
  }
}

// Binary downloads (certificate / statement PDFs). Auth header comes from the
// axios interceptor, so these can't be plain <a href> links.
async function downloadBlob(path: string, params?: Record<string, unknown>): Promise<Blob> {
  try {
    const res = await axiosClient().get(path, { params, responseType: "blob" });
    return res.data as Blob;
  } catch (err) {
    if (axios.isAxiosError(err)) throw new Error(err.message || "Download failed");
    throw err;
  }
}

// Multipart uploads (avatars, thumbnails, attachments). Field name is always
// "file"; extra string fields ride along in the same form.
function uploadMultipart<T>(path: string, file: File, fields?: Record<string, string>, onProgress?: (percent: number) => void): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(fields || {})) form.append(k, v);
  return unwrap<T>(axiosClient().post(path, form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  }));
}

// ─── Typed API surface ────────────────────────────────────────────
export const api = {
  // Auth
  auth: {
    register: (b: { email: string; password: string; displayName: string; intent?: "learner" | "creator" | "both" }) =>
      unwrap<{ userId: string; status: string }>(axiosClient().post("/auth/register", b)),
    login: (b: { email: string; password: string }) =>
      unwrap<{ user: { id: string; displayName: string; roles: string[] }; accessToken: string; refreshToken: string }>(axiosClient().post("/auth/login", b)),
    verifyEmail: (token: string) => unwrap<{ verified: boolean; accessToken: string; refreshToken: string }>(axiosClient().post("/auth/verify-email", { token })),
    forgotPassword: (email: string) => unwrap<{ message: string }>(axiosClient().post("/auth/forgot-password", { email })),
    resetPassword: (token: string, password: string) => unwrap<{ reset: boolean }>(axiosClient().post("/auth/reset-password", { token, password })),
    logout: (refreshToken: string) => unwrap<{ loggedOut: boolean }>(axiosClient().post("/auth/logout", { refreshToken })),
    logoutAll: () => unwrap<{ loggedOut: boolean }>(axiosClient().post("/auth/logout-all", {})),
    changePassword: (currentPassword: string, newPassword: string) =>
      unwrap<{ changed: boolean }>(axiosClient().post("/auth/change-password", { currentPassword, newPassword })),
    deactivate: (password: string) =>
      unwrap<{ deactivated: boolean }>(axiosClient().post("/auth/deactivate", { password, confirm: "DEACTIVATE" })),
    // Exchange a Supabase OAuth session (Google) for the platform's own JWT pair.
    oauthExchange: (supabaseAccessToken: string) =>
      unwrap<{ user: { id: string; displayName: string; username: string; avatarUrl?: string | null; roles: string[] }; accessToken: string; refreshToken: string }>(
        axiosClient().post("/auth/oauth/exchange", { accessToken: supabaseAccessToken }),
      ),
  },

  // Users
  users: {
    me: () => unwrap<UserProfile>(axiosClient().get("/users/me")),
    // Accepts the backend's camelCase update fields alongside the row shape.
    updateMe: (b: Partial<UserProfile> & { displayName?: string; username?: string; bio?: string; college?: string; themePreference?: "light" | "dark" | "system"; socialLinks?: Record<string, string>; avatarUrl?: string }) =>
      unwrap<UserProfile>(axiosClient().put("/users/me", b)),
    checkUsername: (username: string) => unwrap<{ available: boolean }>(axiosClient().get("/users/check-username", { params: { username } })),
    byUsername: (username: string) => unwrap<{ profile: UserProfile; roles: string[]; courses: Course[] }>(axiosClient().get(`/users/by-username/${username}`)),
    subscribe: (creatorId: string) => unwrap<{ subscribed: boolean }>(axiosClient().post(`/users/${creatorId}/subscribe`, {})),
    unsubscribe: (creatorId: string) => unwrap<{ subscribed: boolean }>(axiosClient().delete(`/users/${creatorId}/subscribe`)),
    subscriberCount: (creatorId: string) => unwrap<{ count: number }>(axiosClient().get(`/users/${creatorId}/subscribers/count`)),
    mySubscriptions: () => unwrap<FollowedCreator[]>(axiosClient().get("/users/me/subscriptions")),
    feed: async (params?: { page?: number; pageSize?: number }): Promise<Paginated<FeedItem>> => {
      const { data, meta } = await unwrapWithMeta<FeedItem[]>(axiosClient().get("/users/me/feed", { params }));
      return { items: data, page: Number(meta.page) || 1, pageSize: Number(meta.pageSize) || 20, total: Number(meta.total) || 0 };
    },
    acceptCreatorTerms: (termsVersion: string, commissionRate: number) =>
      unwrap<{ accepted: boolean }>(axiosClient().post("/users/me/accept-creator-terms", { termsVersion, commissionRate })),
    creatorTermsStatus: () => unwrap<CreatorTermsStatus>(axiosClient().get("/users/me/creator-terms-status")),
    // Resumable onboarding wizard
    onboarding: () => unwrap<OnboardingState>(axiosClient().get("/users/me/onboarding")),
    updateOnboarding: (b: OnboardingPatchBody) => unwrap<{ saved: boolean }>(axiosClient().patch("/users/me/onboarding", b)),
    completeOnboarding: () => unwrap<{ completed: boolean }>(axiosClient().post("/users/me/onboarding/complete", {})),
    list: (params?: { role?: string; page?: number }) => unwrap<UserProfile[]>(axiosClient().get("/users/", { params })),
    uploadAvatar: (file: File, onProgress?: (percent: number) => void) =>
      uploadMultipart<UploadedFile>("/users/uploads/avatar", file, undefined, onProgress),
  },

  // Courses
  courses: {
    list: (params?: { page?: number; category?: string; minRating?: number }) =>
      unwrap<Course[]>(axiosClient().get("/courses/", { params })),
    // Creator-scoped: the authenticated creator's own courses across ALL statuses.
    // Server-side filtered by creator_id (no client-side over-fetch of the catalog).
    mine: () => unwrap<Course[]>(axiosClient().get("/courses/mine")),
    // Admin-only: courses of any status (the catalog list is published-only).
    // Pass { status: "under_review" } for the review queue.
    adminList: (params?: { status?: string }) => unwrap<Course[]>(axiosClient().get("/courses/admin/courses", { params })),
    detail: (id: string) => unwrap<{ course: Course; creator: UserProfile; reviews: Review[] }>(axiosClient().get(`/courses/${id}/detail`)),
    get: (id: string) => unwrap<Course>(axiosClient().get(`/courses/${id}`)),
    create: (b: Partial<Course>) => unwrap<Course>(axiosClient().post("/courses/", b)),
    update: (id: string, b: Partial<Course>) => unwrap<Course>(axiosClient().patch(`/courses/${id}`, b)),
    submitReview: (id: string) => unwrap<{ status: string }>(axiosClient().post(`/courses/${id}/submit-review`, {})),
    publish: (id: string) => unwrap<{ id: string; status: string; published_at?: string }>(axiosClient().post(`/courses/${id}/publish`, {})),
    approve: (id: string) => unwrap<{ status: string }>(axiosClient().post(`/courses/${id}/approve`, {})),
    reject: (id: string, reason: string) => unwrap<{ status: string }>(axiosClient().post(`/courses/${id}/reject`, { reason })),
    addModule: (courseId: string, title: string) => unwrap<Module>(axiosClient().post(`/courses/${courseId}/modules`, { title })),
    updateModule: (moduleId: string, b: { title?: string; position?: number }) => unwrap<Module>(axiosClient().patch(`/courses/modules/${moduleId}`, b)),
    deleteModule: (moduleId: string) => unwrap<{ deleted: boolean }>(axiosClient().delete(`/courses/modules/${moduleId}`)),
    addNode: (b: NodeCreate) => unwrap<CourseNode>(axiosClient().post("/courses/nodes", b)),
    updateNode: (nodeId: string, b: Partial<CourseNode>) => unwrap<CourseNode>(axiosClient().patch(`/courses/nodes/${nodeId}`, b)),
    deleteNode: (nodeId: string) => unwrap<{ deleted: boolean }>(axiosClient().delete(`/courses/nodes/${nodeId}`)),
    reviews: (courseId: string, page = 1) => unwrap<Review[]>(axiosClient().get(`/courses/${courseId}/reviews`, { params: { page } })),
    addReview: (courseId: string, rating: number, body?: string) => unwrap<Review>(axiosClient().post(`/courses/${courseId}/reviews`, { rating, body })),
    myReview: (courseId: string) => unwrap<Review | null>(axiosClient().get(`/courses/${courseId}/reviews/mine`)),
    comments: (nodeId: string, params?: { limit?: number; offset?: number; filter?: "comment" | "doubt" }) =>
      unwrap<{ items: Comment[]; total: number; hasMore: boolean }>(
        axiosClient().get(`/courses/nodes/${nodeId}/comments`, { params }),
      ),
    replies: (commentId: string, params?: { limit?: number; offset?: number }) =>
      unwrap<{ items: Comment[]; total: number; hasMore: boolean }>(
        axiosClient().get(`/courses/comments/${commentId}/replies`, { params }),
      ),
    addComment: (nodeId: string, body: string, kind: "comment" | "doubt" = "comment", parentId?: string) => unwrap<Comment>(axiosClient().post(`/courses/nodes/${nodeId}/comments`, { body, parentId, kind })),
    upvoteComment: (id: string) => unwrap<{ upvoted: boolean }>(axiosClient().post(`/courses/comments/${id}/upvote`, {})),
    resolveComment: (id: string) => unwrap<{ resolved: boolean }>(axiosClient().post(`/courses/comments/${id}/resolve`, {})),
    reopenComment: (id: string) => unwrap<{ resolved: boolean }>(axiosClient().post(`/courses/comments/${id}/reopen`, {})),
    doubtsInbox: async (params?: { page?: number; pageSize?: number; courseId?: string; status?: "open" | "resolved"; q?: string; dateFrom?: string; dateTo?: string }): Promise<DoubtsInboxResult> => {
      const { data, meta } = await unwrapWithMeta<DoubtInboxItem[]>(axiosClient().get("/courses/doubts/inbox", { params }));
      return {
        items: data,
        page: Number(meta.page) || 1,
        pageSize: Number(meta.pageSize) || 20,
        total: Number(meta.total) || 0,
        openCount: Number(meta.openCount) || 0,
        resolvedCount: Number(meta.resolvedCount) || 0,
      };
    },
    pdfUploadUrl: (b: { filename: string; sizeBytes: number }) =>
      unwrap<{ signedUrl: string; token: string; path: string }>(
        axiosClient().post("/courses/uploads/pdf-url", b),
      ),
    pdfViewUrl: (nodeId: string) =>
      unwrap<{ signedUrl: string; expiresIn: number }>(
        axiosClient().get(`/courses/nodes/${nodeId}/pdf-view-url`),
      ),
    pdfPreviewUrl: (path: string) =>
      unwrap<{ signedUrl: string }>(
        axiosClient().post("/courses/uploads/pdf-view-url", { path }),
      ),
    // ── Collaboration ──
    listCollaborators: (courseId: string) =>
      unwrap<Collaborator[]>(axiosClient().get(`/courses/${courseId}/collaborators`)),
    inviteCollaborator: (courseId: string, userId: string) =>
      unwrap<Collaborator>(axiosClient().post(`/courses/${courseId}/collaborators`, { userId })),
    removeCollaborator: (courseId: string, userId: string) =>
      unwrap<{ removed: boolean }>(axiosClient().delete(`/courses/${courseId}/collaborators/${userId}`)),
    respondToInvite: (courseId: string, accept: boolean) =>
      unwrap<{ status: string }>(axiosClient().post(`/courses/collaborations/${courseId}/respond`, { accept })),
    myCollaborations: (status?: "pending" | "accepted") =>
      unwrap<CollaborationListItem[]>(axiosClient().get("/courses/collaborations/mine", { params: status ? { status } : undefined })),
    // ── Edit lock ──
    getLock: (courseId: string) =>
      unwrap<{ lock: LockState | null; role: "owner" | "collaborator" | "admin" }>(
        axiosClient().get(`/courses/${courseId}/lock`),
      ),
    acquireLock: (courseId: string) =>
      unwrap<{ outcome: "acquired" | "held_by_other"; held_by: string; expires_at: string; holder_name: string }>(
        axiosClient().post(`/courses/${courseId}/lock`, {}),
      ),
    heartbeatLock: (courseId: string) =>
      unwrap<{ held: boolean; expires_at: string | null }>(
        axiosClient().post(`/courses/${courseId}/lock/heartbeat`, {}),
      ),
    releaseLock: (courseId: string) =>
      unwrap<{ released: boolean }>(axiosClient().delete(`/courses/${courseId}/lock`)),
    // ── Storage quota ──
    storageUsage: () => unwrap<StorageUsage>(axiosClient().get("/courses/storage/usage")),
    storagePurchaseOrder: (mb: number) =>
      unwrap<{ orderId: string; amountPaise: number; currency: string; mb: number; keyId: string }>(
        axiosClient().post("/courses/storage/purchase", { mb }),
      ),
    storageVerify: (b: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
      unwrap<{ granted_mb?: number; extra_until?: string; alreadyApplied?: boolean; ok?: boolean }>(
        axiosClient().post("/courses/storage/verify", b),
      ),
    // ── Uploads (thumbnails / node attachments) ──
    uploadThumbnail: (courseId: string, file: File, onProgress?: (percent: number) => void) =>
      uploadMultipart<UploadedFile>("/courses/uploads/course-thumbnail", file, { courseId }, onProgress),
    uploadNodeAttachment: (nodeId: string, file: File, onProgress?: (percent: number) => void) =>
      uploadMultipart<NodeAttachment>("/courses/uploads/node-attachment", file, { nodeId }, onProgress),
    nodeAttachments: (nodeId: string) => unwrap<NodeAttachment[]>(axiosClient().get(`/courses/nodes/${nodeId}/attachments`)),
    deleteUploadedAsset: (assetId: string) => unwrap<{ deleted: boolean }>(axiosClient().delete(`/courses/uploads/assets/${assetId}`)),
    // Content reports (course / lesson / comment)
    report: (b: { courseId?: string; nodeId?: string; commentId?: string; reason: string }) =>
      unwrap<{ reported: boolean }>(axiosClient().post("/courses/reports", b)),
    bookmarks: () => unwrap<{ course_id: string; courses: Course }[]>(axiosClient().get("/courses/bookmarks")),
    bookmark: (courseId: string) => unwrap<{ bookmarked: boolean }>(axiosClient().post("/courses/bookmarks", { courseId })),
    unbookmark: (courseId: string) => unwrap<{ bookmarked: boolean }>(axiosClient().delete(`/courses/bookmarks/${courseId}`)),
    lessonBookmarks: () => unwrap<LessonBookmark[]>(axiosClient().get("/courses/lesson-bookmarks")),
    bookmarkNode: (nodeId: string) => unwrap<{ bookmarked: boolean }>(axiosClient().post(`/courses/nodes/${nodeId}/bookmark`, {})),
    unbookmarkNode: (nodeId: string) => unwrap<{ bookmarked: boolean }>(axiosClient().delete(`/courses/nodes/${nodeId}/bookmark`)),
    categories: () => unwrap<Category[]>(axiosClient().get("/courses/categories")),
  },

  // Enrollments
  enrollments: {
    list: () => unwrap<Enrollment[]>(axiosClient().get("/enrollments/")),
    check: (courseId: string) => unwrap<{ enrolled: boolean; progress_percent?: number; last_node_id?: string }>(axiosClient().get("/enrollments/check", { params: { courseId } })),
    enrollFree: (courseId: string) => unwrap<Enrollment>(axiosClient().post("/enrollments/", { courseId })),
    markComplete: (nodeId: string) => unwrap<NodeProgressResult>(axiosClient().post(`/enrollments/progress/${nodeId}/complete`, {})),
    // Unified completion-engine update: scroll/watch signals + optional explicit markDone.
    updateProgress: (nodeId: string, b: { scrollPercent?: number; watchSeconds?: number; durationSeconds?: number; lastPositionSeconds?: number; markDone?: boolean }) =>
      unwrap<NodeProgressResult>(axiosClient().post(`/enrollments/progress/${nodeId}`, b)),
    saveWatchPosition: (nodeId: string, seconds: number) => unwrap<{ saved: boolean }>(axiosClient().put(`/enrollments/progress/${nodeId}/watch-position`, { seconds })),
    getWatchPosition: (nodeId: string) => unwrap<{ seconds: number; completed: boolean }>(axiosClient().get(`/enrollments/progress/${nodeId}/watch-position`)),
    courseProgress: (courseId: string) => unwrap<{ enrollment: Enrollment | null; completedNodeIds: string[] }>(axiosClient().get(`/enrollments/${courseId}/progress`)),
    submitQuiz: (nodeId: string, answers: { questionId: string; pickedIndex: number }[]) =>
      unwrap<{ score: number; max: number; passed: boolean; attemptId?: string; courseProgressPercent?: number; courseCompleted?: boolean; courseJustCompleted?: boolean }>(axiosClient().post(`/enrollments/quiz/${nodeId}/attempt`, { answers })),
    quizAttempts: (nodeId: string) => unwrap<QuizAttempt[]>(axiosClient().get(`/enrollments/quiz/${nodeId}/attempts`)),
    notes: (nodeId: string) => unwrap<{ id: string; body: string; timestamp_s: number }[]>(axiosClient().get(`/enrollments/notes/${nodeId}`)),
    addNote: (nodeId: string, body: string, timestamp_s?: number) => unwrap<{ saved: boolean }>(axiosClient().post(`/enrollments/notes/${nodeId}`, { body, timestamp_s })),
  },

  // Search — accept an optional AbortSignal so React Query can cancel stale
  // requests (debounced typing in the catalog filter and the navbar autocomplete).
  search: {
    // Catalog feed. Returns the paginated envelope so callers using
    // useInfiniteQuery can drive "Load more" off `hasMore` without an extra
    // empty-page round trip. Accepts `offset`/`limit` (preferred) and falls
    // through to `page`/`pageSize` for legacy callers.
    courses: async (
      params: { q?: string; category?: string; minRating?: number; sort?: string; page?: number; pageSize?: number; offset?: number; limit?: number; price?: "free" | "paid"; level?: string; language?: string; duration?: "short" | "medium" | "long"; creatorId?: string },
      signal?: AbortSignal,
    ): Promise<{ items: Course[]; total: number; hasMore: boolean }> => {
      const { data, meta } = await unwrapWithMeta<Course[]>(
        axiosClient().get("/search/courses", { params, signal }),
      );
      return {
        items: data,
        total: Number(meta.total) || 0,
        hasMore: !!meta.hasMore,
      };
    },
    creators: (
      params?: { q?: string; sort?: "subscribers" | "courses" | "rating" | "enrollments" | "name"; activeOnly?: boolean; limit?: number; offset?: number },
      signal?: AbortSignal,
    ) =>
      unwrap<CreatorListing[]>(axiosClient().get("/search/creators", { params, signal })),
    autocomplete: (q: string, signal?: AbortSignal) => unwrap<{ courses: { id: string; title: string; thumbnail_url?: string }[]; creators: { user_id: string; display_name: string; username: string; avatar_url?: string }[] }>(axiosClient().get("/search/autocomplete", { params: { q }, signal })),
  },

  // Payments
  payments: {
    createOrder: (courseId: string) => unwrap<{ orderId: string; keyId: string; amount: number; currency: string; courseTitle?: string }>(axiosClient().post("/payments/create-order", { courseId })),
    verify: (b: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
      unwrap<{ verified: boolean; courseId: string }>(axiosClient().post("/payments/verify", b)),
    list: () => unwrap<Payment[]>(axiosClient().get("/payments/")),
    refund: (paymentId: string) => unwrap<{ refunded: boolean }>(axiosClient().post(`/payments/${paymentId}/refund`, {})),
    transactions: (kind?: "course" | "storage") =>
      unwrap<UserTransaction[]>(axiosClient().get("/payments/transactions", { params: kind ? { kind } : undefined })),
  },

  // Wallet
  wallet: {
    balance: (creatorId: string) => unwrap<{ pending: number; total_earned: number; total_paid_out: number; total_commission: number }>(axiosClient().get(`/wallet/${creatorId}/balance`)),
    ledger: (creatorId: string, page = 1) => unwrap<LedgerEntry[]>(axiosClient().get(`/wallet/${creatorId}/ledger`, { params: { page } })),
    eligibleForPayout: () => unwrap<{ creator_id: string; pending: number; kyc_details: { account_number_last4?: string; upi_id?: string; kyc_status: string; razorpay_fund_account_id?: string } }[]>(axiosClient().get("/wallet/eligible-for-payout")),
  },

  // Payouts
  payouts: {
    kyc: (creatorId: string, b: { type: "bank" | "upi"; accountHolderName: string; email: string; contactNumber: string; accountNumber?: string; ifsc?: string; upiId?: string }) =>
      unwrap<{ contactId: string; fundAccountId: string; kycStatus: string }>(axiosClient().post(`/payouts/kyc/${creatorId}`, b)),
    kycStatus: (creatorId: string) => unwrap<{ kyc_status: string; bank_name?: string; account_number_last4?: string; upi_id?: string }>(axiosClient().get(`/payouts/kyc/${creatorId}`)),
    bulk: () => unwrap<{ runId: string; count: number; results: { creatorId: string; amount: number; status: string }[] }>(axiosClient().post("/payouts/bulk", {})),
    runs: () => unwrap<unknown[]>(axiosClient().get("/payouts/runs")),
    list: (creatorId?: string) => unwrap<unknown[]>(axiosClient().get("/payouts/", { params: { creatorId } })),
    retry: (id: string) => unwrap<{ retried: boolean; status?: string; payoutId?: string }>(axiosClient().post(`/payouts/${id}/retry`, {})),
    // Admin-only: off-cycle payout to a single creator. amountInr in rupees; backend converts to paise.
    manual: (b: { creatorId: string; amountInr: number; reason: string; override?: boolean }) =>
      unwrap<{ runId: string; payoutItemId: string; payoutId?: string; amount: number; status: string }>(axiosClient().post("/payouts/manual", b)),
    // Admin-only: off-platform manual flow used while bulk Razorpay payouts are down.
    // Queue returns eligible creators with their full bank/UPI details; mark-paid records
    // a wallet_ledger payout_debit (no Razorpay call) and stores an audit row.
    offplatformQueue: () => unwrap<OffPlatformPayoutEntry[]>(axiosClient().get("/payouts/offplatform/queue")),
    offplatformMarkPaid: (b: { creatorId: string; amountInr: number; method: "bank" | "upi" | "other"; txnReference?: string; note?: string }) =>
      unwrap<{ recordId: string; ledgerId: string; referenceId: string; amount: number }>(axiosClient().post("/payouts/offplatform/mark-paid", b)),
    failed: async (params?: { page?: number; pageSize?: number }): Promise<Paginated<FailedPayoutItem>> => {
      const { data, meta } = await unwrapWithMeta<FailedPayoutItem[]>(axiosClient().get("/payouts/failed", { params }));
      return { items: data, page: Number(meta.page) || 1, pageSize: Number(meta.pageSize) || 50, total: Number(meta.total) || 0 };
    },
    // Creator annual (financial-year) statement — JSON summary + PDF/CSV download.
    annualStatement: (fy?: string, creatorId?: string) =>
      unwrap<AnnualStatement>(axiosClient().get("/payouts/statements/annual", { params: { fy, creatorId } })),
    downloadAnnualStatement: (fy: string, format: "pdf" | "csv" = "pdf", creatorId?: string) =>
      downloadBlob("/payouts/statements/annual/download", { fy, format, creatorId }),
    // Scheduled payout runner (admin) — driven by platform_settings.payout_schedule.
    schedulerStatus: () => unwrap<PayoutSchedulerStatus>(axiosClient().get("/payouts/scheduler/status")),
    runDuePayouts: () => unwrap<ScheduledPayoutRunResult>(axiosClient().post("/payouts/scheduler/run-due", {})),
  },

  // Notifications
  notifications: {
    list: (page = 1) => unwrap<Notification[]>(axiosClient().get("/notifications/", { params: { page } })),
    unreadCount: () => unwrap<{ count: number }>(axiosClient().get("/notifications/unread-count")),
    markRead: (id: string) => unwrap<{ read: boolean }>(axiosClient().put(`/notifications/${id}/read`, {})),
    markAllRead: () => unwrap<{ read: boolean }>(axiosClient().put("/notifications/read-all", {})),
    preferences: () => unwrap<NotificationPreference[]>(axiosClient().get("/notifications/preferences")),
    savePreferences: (prefs: { eventType: string; emailEnabled: boolean; inappEnabled: boolean }[]) =>
      unwrap<{ saved: boolean }>(axiosClient().put("/notifications/preferences", prefs)),
  },

  // Support
  support: {
    create: (b: { subject: string; body: string; category?: string; relatedPaymentId?: string }) => unwrap<{ id: string; status: string }>(axiosClient().post("/support/", b)),
    list: (params?: { status?: string }) => unwrap<SupportTicket[]>(axiosClient().get("/support/", { params })),
    get: (id: string) => unwrap<SupportTicket & { refund_context?: RefundContext | null }>(axiosClient().get(`/support/${id}`)),
    reply: (id: string, body: string, isInternalNote = false) => unwrap<{ sent: boolean }>(axiosClient().post(`/support/${id}/messages`, { body, isInternalNote })),
    setStatus: (id: string, status: string) => unwrap<{ updated: boolean }>(axiosClient().put(`/support/${id}/status`, { status })),
    refundDecision: (id: string, approved: boolean, reason?: string) =>
      unwrap<{ recorded: boolean; approved: boolean }>(axiosClient().post(`/support/${id}/refund-decision`, { approved, reason })),
  },

  // Achievements
  achievements: {
    badges: (userId: string) => unwrap<{ earned: Badge[]; locked: Badge[] }>(axiosClient().get(`/achievements/${userId}/badges`)),
    streak: (userId: string) => unwrap<{ current_streak: number; longest_streak: number; last_activity_date: string }>(axiosClient().get(`/achievements/${userId}/streak`)),
    heatmap: (userId: string) => unwrap<Record<string, number>>(axiosClient().get(`/achievements/${userId}/heatmap`)),
    // Aggregated learner-dashboard payload: streak + badge counts + heatmap in one round trip.
    summary: (userId: string) => unwrap<{ streak: { current_streak: number; longest_streak: number }; badges: { earned: number; locked: number }; heatmap: Record<string, number> }>(axiosClient().get(`/achievements/${userId}/summary`)),
    verifyCertificate: (token: string) => unwrap<{ id: string; verification_token: string; issued_at: string; courses: { title: string }; profiles: { display_name: string; username: string } }>(axiosClient().get(`/achievements/certificates/verify/${token}`)),
    myCertificates: () => unwrap<CertificateItem[]>(axiosClient().get("/achievements/certificates/mine")),
    claimCertificate: (courseId: string) =>
      unwrap<{ certificate: CertificateItem; alreadyIssued: boolean }>(axiosClient().post("/achievements/certificates/claim", { courseId })),
    downloadCertificate: (certificateId: string) => downloadBlob(`/achievements/certificates/${certificateId}/download`),
  },

  // Analytics
  analytics: {
    learnerReportCard: (userId: string) => unwrap<{ totals: Record<string, number>; enrollments: Enrollment[] }>(axiosClient().get(`/analytics/learner/${userId}/report-card`)),
    creatorOverview: (creatorId: string) => unwrap<{ courseCount: number; totalStudents: number; avgRating: number; totalRevenue: number; pendingBalance: number }>(axiosClient().get(`/analytics/creator/${creatorId}/overview`)),
    creatorDashboard: (creatorId: string, range: CreatorDashboard["range"] = "30d") =>
      unwrap<CreatorDashboard>(axiosClient().get(`/analytics/creator/${creatorId}/dashboard`, { params: { range } })),
    courseAnalytics: (creatorId: string, courseId: string) => unwrap<{
      course: { title: string; enrollment_count: number; rating_avg: number; rating_count: number; price: number; discounted_price?: number } | null;
      enrollmentTrend: { enrolled_at: string }[];
      funnel: { nodeId: string; title: string; completions: number }[];
      revenue: number;
      refunds: number;
    }>(axiosClient().get(`/analytics/creator/${creatorId}/courses/${courseId}`)),
    adminOverview: () => unwrap<Record<string, number>>(axiosClient().get("/analytics/admin/overview")),
    adminRevenue: () => unwrap<{ month: string; revenue: number; commission: number }[]>(axiosClient().get("/analytics/admin/revenue")),
  },

  // Admin governance (user-service /admin/* routes): platform settings, audit log, user management.
  admin: {
    // Aggregated per-service health/metrics (gateway /api/ops, admin-only).
    ops: () => unwrap<OpsReport>(axiosClient().get("/ops")),
    platformSettings: () => unwrap<{ settings: PlatformSettings; rows: PlatformSettingRow[] }>(axiosClient().get("/users/admin/platform-settings")),
    updatePlatformSettings: (b: Partial<PlatformSettings>) =>
      unwrap<{ settings: PlatformSettings; changedKeys: string[] }>(axiosClient().patch("/users/admin/platform-settings", b)),
    auditLog: async (params?: { page?: number; pageSize?: number; actionType?: string; adminId?: string; targetType?: string; dateFrom?: string; dateTo?: string }): Promise<Paginated<AuditLogEntry>> => {
      const { data, meta } = await unwrapWithMeta<AuditLogEntry[]>(axiosClient().get("/users/admin/audit-log", { params }));
      return { items: data, page: Number(meta.page) || 1, pageSize: Number(meta.pageSize) || 20, total: Number(meta.total) || 0 };
    },
    users: async (params?: { page?: number; pageSize?: number; role?: string; status?: string; q?: string }): Promise<Paginated<AdminUser>> => {
      const { data, meta } = await unwrapWithMeta<AdminUser[]>(axiosClient().get("/users/admin/users", { params }));
      return { items: data, page: Number(meta.page) || 1, pageSize: Number(meta.pageSize) || 20, total: Number(meta.total) || 0 };
    },
    suspendUser: (userId: string, reason: string) => unwrap<{ suspended: boolean }>(axiosClient().post(`/users/admin/users/${userId}/suspend`, { reason })),
    unsuspendUser: (userId: string, reason: string) => unwrap<{ suspended: boolean }>(axiosClient().post(`/users/admin/users/${userId}/unsuspend`, { reason })),
    grantCreator: (userId: string, reason: string) => unwrap<{ roles: string[] }>(axiosClient().post(`/users/admin/users/${userId}/grant-creator`, { reason })),
    revokeCreator: (userId: string, reason: string, override?: boolean) =>
      unwrap<{ roles: string[] }>(axiosClient().post(`/users/admin/users/${userId}/revoke-creator`, { reason, override })),
    requestAdmin: (userId: string, reason: string) => unwrap<AdminRoleRequest>(axiosClient().post(`/users/admin/users/${userId}/request-admin`, { reason })),
    adminRequests: (status?: string) => unwrap<AdminRoleRequest[]>(axiosClient().get("/users/admin/admin-requests", { params: status ? { status } : undefined })),
    approveAdminRequest: (requestId: string) => unwrap<{ approved: boolean; targetUserId: string }>(axiosClient().post(`/users/admin/admin-requests/${requestId}/approve`, {})),
    rejectAdminRequest: (requestId: string) => unwrap<{ rejected: boolean }>(axiosClient().post(`/users/admin/admin-requests/${requestId}/reject`, {})),
    // Flagged content (course-service moderation queue)
    reports: async (params?: { page?: number; pageSize?: number; status?: string; type?: string }): Promise<Paginated<ContentReport>> => {
      const { data, meta } = await unwrapWithMeta<ContentReport[]>(axiosClient().get("/courses/admin/reports", { params }));
      return { items: data, page: Number(meta.page) || 1, pageSize: Number(meta.pageSize) || 20, total: Number(meta.total) || 0 };
    },
    dismissReport: (id: string) => unwrap<{ dismissed: boolean }>(axiosClient().post(`/courses/admin/reports/${id}/dismiss`, {})),
    reviewReport: (id: string) => unwrap<{ reviewed: boolean }>(axiosClient().post(`/courses/admin/reports/${id}/reviewed`, {})),
    suspendReportedCourse: (id: string) => unwrap<{ suspended: boolean; courseId: string }>(axiosClient().post(`/courses/admin/reports/${id}/suspend-course`, {})),
  },
};

// ─── Types (mirror backend) ───────────────────────────────────────
export interface UserProfile {
  user_id?: string; id?: string;
  display_name?: string; displayName?: string;
  username: string;
  email?: string; bio?: string; college?: string;
  avatar_url?: string; avatarUrl?: string;
  roles?: string[];
  social_links?: Record<string, string>;
  theme_preference?: "light" | "dark" | "system";
  has_completed_onboarding?: boolean;
}

export interface Course {
  id: string;
  creator_id?: string;
  title: string;
  subtitle?: string;
  description?: string;
  category_id?: string;
  language?: string;
  level?: "Beginner" | "Intermediate" | "Advanced" | "All Levels";
  tags?: string[];
  thumbnail_url?: string;
  promo_video_url?: string;
  status?: "draft" | "under_review" | "published" | "archived";
  price?: number;
  discounted_price?: number;
  certificate_enabled?: boolean;
  enrollment_count?: number;
  rating_avg?: number;
  rating_count?: number;
  duration_seconds?: number;
  modules?: Module[];
  profiles?: { display_name: string; avatar_url?: string };
  published_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Module { id: string; course_id?: string; title: string; position: number; nodes?: CourseNode[] }
export interface VideoChapter { title: string; seconds: number }
export interface VideoSubtitle { label: string; lang: string; url: string; format: "vtt" | "srt" }
export interface CourseNode {
  id: string; module_id?: string; type: "video" | "markdown" | "quiz" | "pdf" | "static_website";
  title: string; position: number; duration_seconds?: number; is_free_preview?: boolean;
  video_url?: string; video_provider?: "youtube" | "gdrive";
  video_chapters?: VideoChapter[] | null; video_subtitles?: VideoSubtitle[] | null;
  markdown?: string; pdf_url?: string;
  static_website?: { html: string; css: string; js: string };
  quiz_payload?: { timerSeconds?: number; passingPercent?: number; questions: { id: string; prompt: string; options: string[]; correctIndex: number; explanation?: string }[] };
}
export interface NodeCreate extends Omit<Partial<CourseNode>, "id" | "position"> { moduleId: string; type: CourseNode["type"]; title: string }

export interface Enrollment { id: string; learner_id: string; course_id: string; enrolled_at: string; completed_at?: string; progress_percent: number; last_node_id?: string; courses?: Course }
export interface Payment { id: string; learner_id: string; course_id: string; amount: number; status: "pending" | "success" | "failed" | "refunded"; razorpay_payment_id?: string; razorpay_order_id: string; created_at: string }
export interface LedgerEntry { id: string; creator_id: string; type: string; amount: number; reference_id: string; notes?: string; created_at: string }
export interface OffPlatformPayoutEntry {
  creator_id: string;
  pending: number;            // paise
  name: string | null;
  email: string | null;
  contact_number: string | null;
  kyc_status: string;
  method: "bank" | "upi" | null;
  account_holder_name: string | null;
  account_number: string | null;
  account_number_last4: string | null;
  ifsc: string | null;
  upi_id: string | null;
  bank_name: string | null;
}
export interface Notification { id: string; user_id: string; type: string; title: string; body: string; href?: string; is_read: boolean; created_at: string }
export interface Badge { id: string; rule_key: string; name: string; description: string; icon: string; rarity?: string; earned_at?: string }
export interface Review { id: string; course_id: string; learner_id: string; rating: number; body: string; created_at: string; profiles?: { display_name: string; avatar_url?: string } }
export interface Comment { id: string; node_id: string; author_id: string; parent_id?: string | null; body: string; upvotes: number; created_at: string; is_resolved?: boolean; kind?: "comment" | "doubt"; reply_count?: number; profiles?: { display_name: string; username: string; avatar_url?: string } | null }
export interface DoubtInboxItem { id: string; body: string; kind: "doubt"; is_resolved: boolean; created_at: string; node_id: string; author_id: string; node_title: string; course_id: string; course_title: string; profiles?: { display_name?: string; username?: string; avatar_url?: string } | null }
export interface CreatorListing { user_id: string; display_name: string; username: string; bio?: string | null; college?: string | null; avatar_url?: string | null; subscriber_count: number; course_count: number; total_enrollments: number; avg_rating: number }
export interface LessonBookmark { node_id: string; course_id: string; created_at: string; nodes?: { id: string; title: string; type: string } | null; courses?: { id: string; title: string; thumbnail_url?: string | null } | null }
export interface Collaborator { course_id: string; user_id: string; status: "pending" | "accepted" | "declined" | "removed"; role: "editor"; invited_by: string; invited_at: string; responded_at?: string | null; profiles?: { display_name?: string; username?: string; avatar_url?: string | null } | null }
export interface CollaborationListItem { course_id: string; user_id: string; status: "pending" | "accepted" | "declined"; role: "editor"; invited_by: string; invited_at: string; responded_at?: string | null; courses?: { id: string; title: string; thumbnail_url?: string | null; creator_id: string } | null; inviter?: { display_name?: string } | null }
export interface LockState { heldBy: string; expiresAt: string; holderName: string; expired: boolean }
export interface StorageUsage { bytesUsed: number; quotaBytes: number; remainingBytes: number; freeMb: number; extraBytes: number; extraUntil: string | null; pricing: { pricePerMbInr: number; durationDays: number } }
export interface UserTransaction { id: string; kind: "course" | "storage"; amount_paise: number; currency: string; status: string; description: string; reference_id: string | null; razorpay_order_id?: string | null; razorpay_payment_id?: string | null; created_at: string }
export interface SupportTicket { id: string; user_id: string; subject: string; status: "open" | "in_progress" | "resolved"; created_at: string; updated_at: string; messages?: { id: string; body: string; author_id: string; created_at: string; is_internal_note?: boolean }[] }
export interface Category { id: string; name: string; slug: string; icon?: string; position?: number }

// ─── Content moderation ──────────────────────────────────────────
export interface ContentReport {
  id: string;
  reason: string;
  status: "open" | "dismissed" | "actioned" | string;
  created_at: string;
  reviewed_at?: string | null;
  reporter?: { display_name?: string; username?: string } | null;
  target_type: "course" | "node" | "comment" | "user";
  course?: { id: string; title: string; status: string } | null;
  node?: { id: string; title: string } | null;
  comment?: { id: string; body: string; node_id: string } | null;
}

// ─── Following / feed ────────────────────────────────────────────
export interface FollowedCreator {
  creator_id: string;
  followed_at: string;
  profile?: { display_name?: string; username?: string; avatar_url?: string } | null;
}

export interface FeedItem {
  type: "course_published";
  at: string;
  course: Course;
  creator?: { display_name?: string; username?: string; avatar_url?: string } | null;
}

// ─── Notification preferences ────────────────────────────────────
export interface NotificationPreference {
  user_id?: string;
  event_type: string;
  email_enabled: boolean;
  inapp_enabled: boolean;
}

// ─── Refund-linked support tickets ───────────────────────────────
export interface RefundContext {
  payment_id: string;
  amount: number;                  // paise
  status: string;
  paid_at: string;
  course_id: string;
  course_title: string;
  learner_id: string;
  refund_window_days: number;
  within_window: boolean;
}

// ─── Onboarding ──────────────────────────────────────────────────
export interface OnboardingPreferences {
  domains?: string[];
  skillLevel?: "beginner" | "intermediate" | "advanced";
  language?: string;
  emailNotifications?: boolean;
  inappNotifications?: boolean;
}

export interface OnboardingState {
  completed: boolean;
  step: number;
  data: { roleIntent?: "learner" | "creator" | "both"; preferences?: OnboardingPreferences; creator?: { headline?: string } };
  roles: string[];
  profile: { display_name?: string; username?: string; bio?: string | null; avatar_url?: string | null };
}

export interface OnboardingPatchBody {
  step?: number;
  roles?: "learner" | "creator" | "both";
  profile?: { displayName?: string; username?: string; bio?: string };
  preferences?: OnboardingPreferences;
  creator?: { headline?: string };
}

// ─── Creator terms ───────────────────────────────────────────────
export interface CreatorTermsStatus {
  currentVersion: string;
  commissionRate: number;            // fraction, 0.15 = 15%
  acceptedVersion: string | null;
  acceptedAt: string | null;
  accepted: boolean;
}

// ─── Uploads ──────────────────────────────────────────────────────
export interface UploadedFile { url: string; path: string; storage: "supabase" | "local" }
export interface NodeAttachment {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  url: string;
}

// ─── Learner completion engine / certificates / creator ops ──────
export interface NodeProgressResult {
  completed: boolean;
  newlyCompleted: boolean;
  completedByRule: string | null;
  scrollPercent: number;
  watchSeconds: number;
  courseProgressPercent?: number;
  courseCompleted?: boolean;
  courseJustCompleted?: boolean;
}

export interface QuizAttempt {
  id: string;
  score: number;
  max_score: number;
  passed: boolean | null;
  answers: { questionId: string; pickedIndex: number }[];
  attempted_at: string;
}

export interface CertificateItem {
  id: string;
  course_id: string;
  pdf_url?: string | null;
  verification_token: string;
  issued_at: string;
  courses?: { title?: string; thumbnail_url?: string | null } | null;
}

export interface OpsDependencyHealth { configured: boolean; ok?: boolean; latencyMs?: number; error?: string }
export interface OpsServiceMetrics {
  startedAt: string;
  uptimeSeconds: number;
  requestsTotal: number;
  errors5xx: number;
  errors4xx: number;
  avgLatencyMs: number;
  latencyBuckets: Record<string, number>;
}
export interface OpsServiceReport {
  name: string;
  port: number;
  reachable: boolean;
  status?: "ok" | "degraded" | "down";
  uptimeSeconds?: number;
  connectivity?: { supabase: OpsDependencyHealth; redis: OpsDependencyHealth };
  metrics?: OpsServiceMetrics;
}
export interface OpsReport {
  gateway: { status: string; uptimeSeconds: number };
  services: OpsServiceReport[];
  generatedAt: string;
}

export interface PayoutSchedulerStatus {
  schedule: "manual" | "monthly_1st" | "monthly_1st_15th";
  mockMode: boolean;
  currentWindow: { key: string; opensAt: string; alreadyProcessed: boolean } | null;
  nextWindowOpensAt: string | null;
  lastScheduledRun: { id: string; initiated_at: string; total_amount: number; creator_count: number; scheduled_window: string } | null;
}

export interface ScheduledPayoutRunResult {
  status: "skipped" | "completed";
  reason?: "manual_schedule" | "already_processed" | "no_eligible";
  schedule: string;
  windowKey?: string;
  run?: { runId: string; totalAmount: number; count: number; results: { creatorId: string; amount: number; status: string }[] };
}

export interface AnnualStatement {
  financialYear: string;
  grossPaise: number;
  commissionPaise: number;
  refundsPaise: number;
  tdsPaise: number;
  netPaise: number;
  payoutsPaise: number;
  pendingPaise: number;
  months: { month: string; grossPaise: number; commissionPaise: number; refundsPaise: number; tdsPaise: number; netPaise: number }[];
  generatedAt: string;
  isEstimate: boolean;
}

export interface CreatorDashboard {
  range: "7d" | "30d" | "90d" | "all";
  kpis: {
    revenuePaise: number;
    enrollments: number;
    totalStudents: number;
    activeCourses: number;
    completionRate: number;
    quizPassRate: number;
    avgRating: number;
  };
  revenueTrend: { bucket: string; revenuePaise: number }[];
  enrollmentTrend: { bucket: string; enrollments: number }[];
  courses: { id: string; title: string; status: string; enrollment_count: number; rating_avg: number; revenuePaise: number; enrollmentsInRange: number }[];
  recentActivity: { kind: "enrollment" | "completion"; at: string; courseTitle: string; learnerName: string }[];
}

export interface DoubtsInboxResult {
  items: DoubtInboxItem[];
  page: number;
  pageSize: number;
  total: number;
  openCount: number;
  resolvedCount: number;
}

// ─── Admin governance ─────────────────────────────────────────────
export interface Paginated<T> { items: T[]; page: number; pageSize: number; total: number }

export interface PlatformSettings {
  site_name: string;
  commission_rate: number;          // fraction, 0.15 = 15%
  min_payout_inr: number;
  refund_window_days: number;
  tds_threshold_inr: number;
  tds_rate: number;                 // fraction, 0.10 = 10%
  refund_auto_approval: boolean;
  creator_terms_version: string;
  payout_schedule: "manual" | "monthly_1st" | "monthly_1st_15th";
  feature_flags: Record<string, boolean>;
}
export interface PlatformSettingRow { key: string; value: unknown; description?: string | null; updated_at?: string | null; updated_by?: string | null }

interface AdminActorRef { email: string; profiles?: { display_name?: string; username?: string; avatar_url?: string } | null }

export interface AuditLogEntry {
  id: number;
  admin_id: string;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  admin?: AdminActorRef | null;
}

export interface AdminUser {
  user_id: string;
  display_name: string;
  username: string;
  avatar_url?: string | null;
  college?: string | null;
  email: string;
  roles: string[];
  is_admin: boolean;
  is_verified: boolean;
  is_suspended: boolean;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  kyc_status?: string | null;
  joined_at: string;
  last_login_at?: string | null;
}

export interface AdminRoleRequest {
  id: string;
  target_user: string;
  requested_by: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | string;
  created_at: string;
  reviewed_at?: string | null;
  target?: AdminActorRef | null;
  requester?: AdminActorRef | null;
}

export interface FailedPayoutItem {
  id: string;
  run_id: string;
  creator_id: string;
  amount: number;                   // paise
  status: string;
  razorpay_payout_id?: string | null;
  failure_reason?: string | null;
  retry_count: number;
  created_at: string;
  creator?: AdminActorRef | null;
  payout_runs?: { initiated_at: string; notes?: string | null } | null;
}

export { USE_MOCKS, API_URL };
