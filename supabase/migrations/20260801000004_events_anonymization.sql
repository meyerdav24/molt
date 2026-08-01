-- The append-only trigger on events blocked the ON DELETE SET NULL cascades
-- from users/tabs/mandates - which would also have broken GDPR deletion
-- (OT-082: anonymize, never lose the audit trail). Allow exactly one kind of
-- UPDATE: anonymization, i.e. FK columns going to NULL with every other
-- column untouched. Everything else stays forbidden, DELETE stays forbidden.

create or replace function public.forbid_event_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id = old.id
       and new.actor = old.actor
       and new.type = old.type
       and new.payload = old.payload
       and new.created_at = old.created_at
       and (new.user_id is null or new.user_id = old.user_id)
       and (new.tab_id is null or new.tab_id = old.tab_id)
       and (new.mandate_id is null or new.mandate_id = old.mandate_id)
       and (new.user_id is distinct from old.user_id
            or new.tab_id is distinct from old.tab_id
            or new.mandate_id is distinct from old.mandate_id)
    then
      return new;
    end if;
  end if;
  raise exception 'events is append-only (audit log; only FK anonymization is permitted)';
end;
$$;
