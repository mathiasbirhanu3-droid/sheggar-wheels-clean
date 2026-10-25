import { Badge } from "@/components/ui/badge";
import type { BookingStatus, PaymentStatus, CarStatus, LicenseStatus } from "@prisma/client";

const BOOKING_STYLES: Record<BookingStatus, string> = {
  REQUESTED: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  CONFIRMED: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  IN_PROGRESS: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  COMPLETED: "bg-stone-200 text-stone-800 hover:bg-stone-200",
  REVIEWED: "bg-violet-100 text-violet-800 hover:bg-violet-100",
  DECLINED: "bg-red-100 text-red-800 hover:bg-red-100",
  CANCELLED: "bg-stone-200 text-stone-600 hover:bg-stone-200",
  DISPUTED: "bg-orange-100 text-orange-800 hover:bg-orange-100",
  RESOLVED: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge className={BOOKING_STYLES[status]} variant="secondary">{status.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const styles: Record<PaymentStatus, string> = {
    UNPAID: "bg-stone-200 text-stone-700 hover:bg-stone-200",
    HELD: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    PAID: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    REFUNDED: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  };
  const labels: Record<PaymentStatus, string> = {
    UNPAID: "unpaid",
    HELD: "held in escrow",
    PAID: "paid",
    REFUNDED: "refunded",
  };
  return <Badge className={styles[status]} variant="secondary">{labels[status]}</Badge>;
}

export function CarStatusBadge({ status }: { status: CarStatus }) {
  const styles: Record<CarStatus, string> = {
    DRAFT: "bg-stone-200 text-stone-700 hover:bg-stone-200",
    PENDING: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    APPROVED: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    REJECTED: "bg-red-100 text-red-800 hover:bg-red-100",
    INACTIVE: "bg-stone-200 text-stone-600 hover:bg-stone-200",
  };
  return <Badge className={styles[status]} variant="secondary">{status.toLowerCase()}</Badge>;
}

// NOTE: the live database's LicenseStatus enum also carries a legacy NONE value
// (used by the older user-profile licence feature). String-keyed lookup with
// fallbacks renders ANY enum member without breaking the build in either schema shape.
export function LicenseStatusBadge({ status }: { status: LicenseStatus }) {
  const styles: Record<string, string> = {
    NONE: "bg-stone-200 text-stone-600 hover:bg-stone-200",
    PENDING: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    APPROVED: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    REJECTED: "bg-red-100 text-red-800 hover:bg-red-100",
  };
  const labels: Record<string, string> = {
    NONE: "no licence submitted",
    PENDING: "licence pending review",
    APPROVED: "licence approved",
    REJECTED: "licence rejected",
  };
  const key = String(status);
  return <Badge className={styles[key] ?? "bg-stone-200 text-stone-600 hover:bg-stone-200"} variant="secondary">{labels[key] ?? key.toLowerCase()}</Badge>;
}
