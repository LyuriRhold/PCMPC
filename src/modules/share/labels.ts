import type { ShareTxnType } from "./schema";

/** Plain-language names of share transactions (screens and exports). */
export const TXN_LABEL: Record<ShareTxnType, string> = {
  SUBSCRIBE: "Subscription",
  PAYMENT: "Payment",
  CBU_RETENTION: "CBU retention (loan)",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  WITHDRAWAL: "Withdrawal",
  ISC_CAPITALIZED: "Interest on share capital added",
  PR_CAPITALIZED: "Patronage refund added",
  ADJUSTMENT: "Unpaid subscription cancelled",
};
