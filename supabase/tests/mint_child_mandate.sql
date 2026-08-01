-- Tests for the atomic mint function (OT-022, DB layer).
-- Run with: pnpm test:db  — everything rolls back.

begin;

create function pg_temp.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'MINT TEST FAILED: %', msg;
  end if;
end;
$$;

-- Fixture: one user, one tab (€400, per-tx irrelevant here), root mandate
-- with velocity 2/h.
insert into public.users (id, email) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'mint-test@test.invalid');
insert into public.tabs (id, user_id, total_minor, remaining_minor, expires_at) values
  ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   40000, 40000, now() + interval '7 days');
insert into public.mandates
  (id, tab_id, kind, status, bounds, amount_minor, currency, merchant_scope,
   task_declaration, step_up_policy, webauthn_assertion, challenge_hash, expires_at)
values
  ('cccccccc-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001',
   'root', 'active', '{"velocity_per_hour": 2}'::jsonb, 40000, 'EUR', '*',
   'mint test', '{}'::jsonb, '{}'::jsonb, repeat('0', 64), now() + interval '7 days');

-- 1) Successful mint decrements the budget and writes the audit event.
select public.mint_child_mandate(
  'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002',
  3400, 'EUR', 'https://store-a.test.invalid', repeat('a', 64), 'test purchase',
  '{"amount_minor":3400}'::jsonb, now() + interval '15 minutes');

select pg_temp.assert(
  (select remaining_minor from public.tabs where id = 'cccccccc-0000-4000-8000-000000000001') = 36600,
  'remaining must be decremented by the minted amount');
select pg_temp.assert(
  (select count(*) from public.events
    where tab_id = 'cccccccc-0000-4000-8000-000000000001' and type = 'mandate.child_minted') = 1,
  'mint must write an audit event');

-- 2) Over-budget mint fails atomically: no child, no decrement.
do $$
begin
  begin
    perform public.mint_child_mandate(
      'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002',
      36601, 'EUR', 'https://store-b.test.invalid', repeat('b', 64), 'overdraw',
      '{}'::jsonb, now() + interval '15 minutes');
    raise exception 'MINT TEST FAILED: over-budget mint must be refused';
  exception when sqlstate 'MT402' then null;
  end;
end $$;
select pg_temp.assert(
  (select remaining_minor from public.tabs where id = 'cccccccc-0000-4000-8000-000000000001') = 36600,
  'failed mint must not change the budget');
select pg_temp.assert(
  (select count(*) from public.mandates where kind = 'child'
    and tab_id = 'cccccccc-0000-4000-8000-000000000001') = 1,
  'failed mint must not create a child');

-- 3) Velocity: second mint within the hour is fine (limit 2), third is refused.
select public.mint_child_mandate(
  'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002',
  1200, 'EUR', 'https://store-c.test.invalid', repeat('c', 64), 'second purchase',
  '{}'::jsonb, now() + interval '15 minutes');
do $$
begin
  begin
    perform public.mint_child_mandate(
      'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002',
      1200, 'EUR', 'https://store-d.test.invalid', repeat('d', 64), 'third purchase',
      '{}'::jsonb, now() + interval '15 minutes');
    raise exception 'MINT TEST FAILED: velocity limit must refuse the third mint';
  exception when sqlstate 'MT429' then null;
  end;
end $$;

-- 4) Child expiry beyond parent expiry is refused.
do $$
begin
  begin
    perform public.mint_child_mandate(
      'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002',
      100, 'EUR', 'https://store-e.test.invalid', repeat('e', 64), 'long ttl',
      '{}'::jsonb, now() + interval '30 days');
    raise exception 'MINT TEST FAILED: child expiry beyond parent must be refused';
  exception when sqlstate 'MT422' then null;
  end;
end $$;

-- 5) Revoked parent cannot mint.
update public.mandates set status = 'revoked'
  where id = 'cccccccc-0000-4000-8000-000000000002';
do $$
begin
  begin
    perform public.mint_child_mandate(
      'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002',
      100, 'EUR', 'https://store-f.test.invalid', repeat('f', 64), 'after revoke',
      '{}'::jsonb, now() + interval '15 minutes');
    raise exception 'MINT TEST FAILED: revoked parent must not mint';
  exception when sqlstate 'MT409' then null;
  end;
end $$;

-- 6) App roles cannot execute the function at all.
set role authenticated;
do $$
begin
  begin
    perform public.mint_child_mandate(
      'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002',
      100, 'EUR', 'https://store-g.test.invalid', repeat('0', 64), 'as authenticated',
      '{}'::jsonb, now() + interval '15 minutes');
    raise exception 'MINT TEST FAILED: authenticated must not execute mint function';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ALL MINT TESTS PASSED' as result;

rollback;
