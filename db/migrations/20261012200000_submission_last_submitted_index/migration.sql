-- M17: the dashboard and the "late submissions" lists read submissions from a rolling window of the last 14 days.
CREATE INDEX "submissions_last_submitted_at_idx" ON "submissions"("last_submitted_at");
