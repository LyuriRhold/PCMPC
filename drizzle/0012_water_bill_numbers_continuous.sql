-- Water bill numbers (WB-{YYYYMM}-{000000}) never restart: the counter runs on across years,
-- like the meters (PCMPC answer to Q-06.7). Folds an existing yearly WB series into one
-- never-resetting row (year 0), keeping the highest next number so no number is reused.
UPDATE number_series AS s
SET resets_yearly = false,
    year = 0,
    next_no = (SELECT max(next_no) FROM number_series WHERE code = 'WB')
WHERE s.code = 'WB'
  AND s.year = (SELECT max(year) FROM number_series WHERE code = 'WB')
  AND NOT EXISTS (SELECT 1 FROM number_series WHERE code = 'WB' AND year = 0);
--> statement-breakpoint
DELETE FROM number_series WHERE code = 'WB' AND year <> 0;
