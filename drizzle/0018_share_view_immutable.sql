-- Member share balances (PHASE-08 data model) and share-capital immutability (PLAN §5 rule 3).
-- A teller-receipt row counts only while its receipt is VALID (cancelled receipts are reversed in
-- the GL; the share rows stay as history).

CREATE VIEW v_member_share_balance AS
SELECT
  t.member_id,
  COALESCE(SUM(CASE t.type
    WHEN 'SUBSCRIBE' THEN t.amount
    WHEN 'TRANSFER_IN' THEN t.amount
    WHEN 'TRANSFER_OUT' THEN -t.amount
    WHEN 'WITHDRAWAL' THEN -t.amount
    WHEN 'ADJUSTMENT' THEN -t.amount
    ELSE 0 END), 0)::bigint AS subscribed,
  COALESCE(SUM(CASE t.type
    WHEN 'PAYMENT' THEN t.amount
    WHEN 'CBU_RETENTION' THEN t.amount
    WHEN 'ISC_CAPITALIZED' THEN t.amount
    WHEN 'PR_CAPITALIZED' THEN t.amount
    WHEN 'TRANSFER_IN' THEN t.amount
    WHEN 'TRANSFER_OUT' THEN -t.amount
    WHEN 'WITHDRAWAL' THEN -t.amount
    ELSE 0 END), 0)::bigint AS paid_up,
  (COALESCE(SUM(CASE t.type
    WHEN 'SUBSCRIBE' THEN t.amount
    WHEN 'TRANSFER_IN' THEN t.amount
    WHEN 'TRANSFER_OUT' THEN -t.amount
    WHEN 'WITHDRAWAL' THEN -t.amount
    WHEN 'ADJUSTMENT' THEN -t.amount
    ELSE 0 END), 0)
   - COALESCE(SUM(CASE t.type
    WHEN 'PAYMENT' THEN t.amount
    WHEN 'CBU_RETENTION' THEN t.amount
    WHEN 'ISC_CAPITALIZED' THEN t.amount
    WHEN 'PR_CAPITALIZED' THEN t.amount
    WHEN 'TRANSFER_IN' THEN t.amount
    WHEN 'TRANSFER_OUT' THEN -t.amount
    WHEN 'WITHDRAWAL' THEN -t.amount
    ELSE 0 END), 0))::bigint AS unpaid
FROM share_transactions t
LEFT JOIN receipt_items ri ON ri.id = t.receipt_item_id
LEFT JOIN receipts r ON r.id = ri.receipt_id
WHERE t.receipt_item_id IS NULL OR r.status = 'VALID'
GROUP BY t.member_id;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION share_rows_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER share_transactions_immutable
  BEFORE UPDATE OR DELETE ON share_transactions
  FOR EACH ROW EXECUTE FUNCTION share_rows_reject_change();
--> statement-breakpoint
CREATE TRIGGER member_fees_immutable
  BEFORE UPDATE OR DELETE ON member_fees
  FOR EACH ROW EXECUTE FUNCTION share_rows_reject_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION share_subscriptions_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'share subscriptions can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'share subscriptions are immutable: only the status can change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER share_subscriptions_immutable
  BEFORE UPDATE OR DELETE ON share_subscriptions
  FOR EACH ROW EXECUTE FUNCTION share_subscriptions_reject_change();
