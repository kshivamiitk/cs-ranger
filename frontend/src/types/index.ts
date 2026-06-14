export type Role = "learner" | "creator" | "admin";

export interface User {
  id: string;
  email: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  bio?: string;
  college?: string;
  roles: Role[];
  socialLinks?: {
    linkedin?: string;
    twitter?: string;
    github?: string;
    website?: string;
  };
  themePreference?: "light" | "dark" | "system";
  createdAt: string;
}

export type NodeType = "video" | "markdown" | "quiz" | "pdf" | "static_website" | "folder";

export interface CourseNode {
  id: string;
  moduleId: string;
  type: NodeType;
  title: string;
  parentNodeId?: string | null;
  durationSeconds?: number;
  position: number;
  isFreePreview?: boolean;
  // type-specific payloads
  videoUrl?: string;
  markdown?: string;
  quiz?: Quiz;
  pdfUrl?: string;
  staticWebsite?: { html: string; css: string; js: string };
}

export interface Quiz {
  timerSeconds?: number;
  questions: QuizQuestion[];
}

export interface QuizQuestion {
  id: string;
  prompt: string; // supports LaTeX
  options: string[];
  correctIndex: number;
  explanation?: string;
}

export interface Module {
  id: string;
  courseId: string;
  title: string;
  position: number;
  nodes: CourseNode[];
}

export interface Course {
  id: string;
  creatorId: string;
  title: string;
  subtitle: string;
  description: string;
  category: string;
  language: string;
  level: "Beginner" | "Intermediate" | "Advanced" | "All Levels";
  tags: string[];
  thumbnail: string;
  promoVideoUrl?: string;
  status: "draft" | "under_review" | "published" | "archived";
  price: number; // INR
  discountedPrice?: number;
  certificateEnabled: boolean;
  enrollmentCount: number;
  rating: number;
  ratingCount: number;
  durationSeconds: number;
  modules: Module[];
  createdAt: string;
  updatedAt: string;
}

export interface Enrollment {
  id: string;
  learnerId: string;
  courseId: string;
  enrolledAt: string;
  completedAt?: string;
  progressPercent: number;
  lastNodeId?: string;
}

export interface Payment {
  id: string;
  learnerId: string;
  courseId: string;
  amount: number;
  status: "pending" | "success" | "failed" | "refunded";
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  creatorId: string;
  type:
    | "enrollment_credit"
    | "commission_debit"
    | "refund_debit"
    | "payout_debit"
    | "tds_debit";
  amount: number;
  referenceId: string;
  createdAt: string;
}

export interface PayoutItem {
  id: string;
  creatorId: string;
  runId: string;
  amount: number;
  status: "processing" | "processed" | "failed";
  razorpayPayoutId?: string;
  failureReason?: string;
  initiatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type:
    | "enrollment"
    | "doubt"
    | "doubt_reply"
    | "new_course"
    | "payout"
    | "support"
    | "badge";
  title: string;
  body: string;
  href?: string;
  isRead: boolean;
  createdAt: string;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  ruleKey: string;
  earnedAt?: string;
  rarity?: "common" | "rare" | "epic" | "legendary";
}

export interface Certificate {
  id: string;
  learnerId: string;
  courseId: string;
  issuedAt: string;
  verificationToken: string;
}

export interface Comment {
  id: string;
  nodeId: string;
  authorId: string;
  body: string;
  upvotes: number;
  createdAt: string;
  isResolved?: boolean;
  replies?: Comment[];
}

export interface Review {
  id: string;
  courseId: string;
  learnerId: string;
  rating: number;
  body: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  status: "open" | "in_progress" | "resolved";
  assignedAdminId?: string;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  isInternalNote?: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string;
}

export interface Heatmap {
  // ISO date → activity count
  [date: string]: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
  meta?: { page?: number; pageSize?: number; total?: number };
}
