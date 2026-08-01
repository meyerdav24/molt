-- Atomic child-mandate mint (OT-022, DB layer).
--
-- Full narrowing validation lives in @molt/protocol (pure, unit- and
-- property-tested); the application validates BEFORE calling this. This
-- function is the atomicity + defense-in-depth layer: parent row lock,
-- velocity re-check, conditional budget decrement, child insert and audit
-- event in ONE transaction. No sequence of concurrent calls can overspend:
-- the UPDATE ... WHERE remaining_minor >= amount is atomic, and the parent
-- row lock serializes the velocity check.

create or replace function public.mint_child_mandate(
  p_tab_id uuid,
  p_parent_id uuid,
  p_amount_minor bigint,
  p_currency text,
  p_merchant_scope text,
  p_cart_hash text,
  p_reason text,
  p_bounds jsonb,
  p_expires_at timestamptz,
  p_id uuid default null
) returns public.mandates
language plpgsql
as $$
declare
  parent public.mandates;
  tab public.tabs;
  recent_count int;
  child public.mandates;
begin
  -- Lock the parent row: serializes velocity accounting per parent.
  select * into parent
    from public.mandates
    where id = p_parent_id and tab_id = p_tab_id
    for update;
  if not found then
    raise exception 'mint: parent mandate not found' using errcode = 'MT404';
  end if;
  if parent.status <> 'active' then
    raise exception 'mint: parent not active (status %)', parent.status using errcode = 'MT409';
  end if;
  if parent.expires_at <= now() then
    raise exception 'mint: parent expired' using errcode = 'MT410';
  end if;
  if p_expires_at > parent.expires_at then
    raise exception 'mint: child expiry exceeds parent' using errcode = 'MT422';
  end if;
  if p_currency <> parent.currency then
    raise exception 'mint: currency mismatch' using errcode = 'MT422';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'mint: invalid amount' using errcode = 'MT422';
  end if;

  select count(*) into recent_count
    from public.mandates
    where parent_id = p_parent_id
      and created_at > now() - interval '1 hour';
  if recent_count >= coalesce((parent.bounds ->> 'velocity_per_hour')::int, 1) then
    raise exception 'mint: velocity exceeded (% in last hour)', recent_count using errcode = 'MT429';
  end if;

  -- The core guarantee: conditional decrement, no double-spend.
  update public.tabs
    set remaining_minor = remaining_minor - p_amount_minor
    where id = p_tab_id and remaining_minor >= p_amount_minor
    returning * into tab;
  if not found then
    raise exception 'mint: insufficient remaining budget' using errcode = 'MT402';
  end if;

  insert into public.mandates
      (id, tab_id, parent_id, kind, status, bounds, amount_minor, currency,
       merchant_scope, cart_hash, reason, expires_at)
    values
      (coalesce(p_id, gen_random_uuid()), p_tab_id, p_parent_id, 'child', 'pending',
       p_bounds, p_amount_minor, p_currency, p_merchant_scope, p_cart_hash, p_reason,
       p_expires_at)
    returning * into child;

  insert into public.events (tab_id, mandate_id, user_id, actor, type, payload)
    values (p_tab_id, child.id, tab.user_id, 'ta', 'mandate.child_minted',
            jsonb_build_object(
              'parent_id', p_parent_id,
              'amount_minor', p_amount_minor,
              'merchant_scope', p_merchant_scope,
              'remaining_minor_after', tab.remaining_minor));

  return child;
end;
$$;

-- App roles never call this directly; only the TA server does.
revoke execute on function public.mint_child_mandate from public, anon, authenticated;
