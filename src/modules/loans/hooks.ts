import { registerPastDueHook } from "./eligibility";

/**
 * Eligibility rules 4 and 5 (past-due loans of the borrower and the comakers), PHASE-10: there are
 * no loans before Phase 11, so the check passes. Phase 11 registers the real check under the same
 * name ("loans"), which replaces this one.
 */
registerPastDueHook("loans", async () => null);
