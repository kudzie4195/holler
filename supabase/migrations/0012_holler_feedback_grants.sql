-- Holler: tighten member write access on holler_signal_feedback (follow-up to 0009, which is already applied; 0009 is not edited).
-- Purely additive and idempotent: it only changes privileges on one holler_ table.
--
-- 0009 granted members table-level insert and update, so a member could set created_at (and updated_at) to any value, and the owner
-- report groups by created_at. Members now hold column privileges only on the four columns the app writes:
--   insert (user_id, signal_id, verdict, job_value_usd)
--   update (user_id, signal_id, verdict, job_value_usd)
-- The app saves with an upsert on (user_id, signal_id), and PostgREST writes every column of the payload in the ON CONFLICT branch, so
-- update needs the same four columns. RLS still pins user_id to the caller and signal_id to an alert the member was sent.
-- created_at keeps its default; updated_at is set by the holler_signal_feedback_set_updated_at trigger, which needs no column privilege.
-- Select is unchanged. No delete for members, nothing for anon. The service role keeps full access.

revoke insert, update on table public.holler_signal_feedback from authenticated;
grant insert (user_id, signal_id, verdict, job_value_usd) on table public.holler_signal_feedback to authenticated;
grant update (user_id, signal_id, verdict, job_value_usd) on table public.holler_signal_feedback to authenticated;
