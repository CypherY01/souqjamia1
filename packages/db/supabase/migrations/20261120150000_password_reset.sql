-- Password reset audit (task 3.4, plan/task-3.4.md, item 6 of the owner's decisions): FR03,
-- API008, DEC73, AuditEvent (security audit trail).
-- Supabase Auth changes the password itself (API008 calls it from the recovery session), so the
-- database learns of the change only from our server, right after Supabase Auth has accepted it
-- and before the sessions are revoked. app.record_password_reset() writes account.password_reset
-- for the account of the session.
--  - Only a live limited session (DEC73: amr without password, a recovery link) may call it. A
--    guest or an ended session: UNAUTHENTICATED. An ordinary session: FORBIDDEN (task 3.6 audits
--    its own password change).
--  - Any account state: a suspended, banned or deletion-pending account may reset its password,
--    and the login sends it to /restricted afterwards (FR78, owner decision on item 4).
--  - The 5 minute window (DEC38) is checked by the server guard before Supabase Auth is called.
--    It is not checked again here: the password has already changed, and the audit row must not
--    be lost if those seconds cross the boundary.
--  - No metadata: no address, email or session id in the audit row (RET08).

create function app.record_password_reset()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.actor_id();
  v_limited boolean;
begin
  -- The live-session checks of task 3.1: the profile, the session row and its expiry.
  perform 1 from app.session_context();
  v_limited := app.limited_session();
  if not v_limited then
    perform app.raise_api_error('FORBIDDEN');
  end if;
  perform app.audit('account.password_reset', 'profile', v_id);
end;
$$;
comment on function app.record_password_reset() is
  'Task 3.4, API008: audits a password reset from a live recovery session (DEC73).';
grant execute on function app.record_password_reset() to souq_web;
