-- RLS policy tests (OT-002 / OT-101).
-- Run with: pnpm test:rls   (wraps: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f this-file)
--
-- Strategy: create fixtures for two users as the table owner (bypasses RLS),
-- then switch to the `authenticated` role with request.jwt.claims set to user
-- A's sub and assert: A sees exactly A's rows, none of B's, and cannot
-- insert/update/delete anything (no write policies exist for app roles).
-- Then the same as `anon` (sees nothing). Everything rolls back.

begin;

create function pg_temp.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'RLS TEST FAILED: %', msg;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (as owner; RLS does not apply)
-- ---------------------------------------------------------------------------
insert into public.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rls-test-a@test.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'rls-test-b@test.invalid');

insert into public.credentials (user_id, credential_id, public_key) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cred-a', '\x00'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cred-b', '\x00');

insert into public.tabs (id, user_id, total_minor, remaining_minor, expires_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 40000, 40000, now() + interval '7 days'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 40000, 40000, now() + interval '7 days');

insert into public.mandates
  (id, tab_id, kind, status, bounds, amount_minor, currency, merchant_scope,
   task_declaration, step_up_policy, webauthn_assertion, challenge_hash, expires_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'root', 'active',
   '{}'::jsonb, 40000, 'EUR', '*', 'rls test', '{}'::jsonb, '{}'::jsonb, repeat('0', 64), now() + interval '7 days'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'root', 'active',
   '{}'::jsonb, 40000, 'EUR', '*', 'rls test', '{}'::jsonb, '{}'::jsonb, repeat('0', 64), now() + interval '7 days');

insert into public.cards (mandate_id, stripe_card_id) values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'ic_test_rls_a'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'ic_test_rls_b');

insert into public.receipts
  (tab_id, mandate_id, rung, rail, merchant, amount_minor, currency, idempotency_key, mandate_chain)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'L1',
   'card_stripe_test', 'https://store-a.test.invalid', 1200, 'EUR', 'rls-test-key-a',
   '["aaaaaaaa-0000-4000-8000-000000000002"]'::jsonb),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'L1',
   'card_stripe_test', 'https://store-b.test.invalid', 1200, 'EUR', 'rls-test-key-b',
   '["bbbbbbbb-0000-4000-8000-000000000002"]'::jsonb);

insert into public.events (tab_id, user_id, actor, type) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'system', 'rls.test'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'system', 'rls.test');

-- ---------------------------------------------------------------------------
-- As authenticated user A: owner-scoped reads only, no writes
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

select pg_temp.assert(
  (select count(*) from public.users) = 1
  and (select id from public.users) = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'authenticated A must see exactly own users row');

select pg_temp.assert(
  (select count(*) from public.credentials) = 1
  and (select credential_id from public.credentials) = 'cred-a',
  'authenticated A must see exactly own credential');

select pg_temp.assert(
  (select count(*) from public.tabs) = 1
  and not exists (select 1 from public.tabs where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'authenticated A must see own tab and not B''s');

select pg_temp.assert(
  (select count(*) from public.mandates) = 1
  and (select tab_id from public.mandates) = 'aaaaaaaa-0000-4000-8000-000000000001',
  'authenticated A must see only mandates of own tabs');

select pg_temp.assert(
  (select count(*) from public.cards) = 1
  and (select stripe_card_id from public.cards) = 'ic_test_rls_a',
  'authenticated A must see only cards of own mandates');

select pg_temp.assert(
  (select count(*) from public.receipts) = 1
  and (select idempotency_key from public.receipts) = 'rls-test-key-a',
  'authenticated A must see only receipts of own tabs');

select pg_temp.assert(
  (select count(*) from public.events) = 1
  and (select tab_id from public.events where type = 'rls.test') = 'aaaaaaaa-0000-4000-8000-000000000001',
  'authenticated A must see only own events');

-- Writes: no policies exist for app roles -> inserts must be rejected by RLS,
-- updates/deletes must silently affect 0 rows (nothing passes the USING filter
-- of a nonexistent policy).
do $$
begin
  begin
    insert into public.tabs (user_id, total_minor, remaining_minor, expires_at)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 100, 100, now() + interval '1 day');
    raise exception 'RLS TEST FAILED: authenticated must not insert into tabs';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.events (actor, type) values ('agent', 'rls.test.write');
    raise exception 'RLS TEST FAILED: authenticated must not insert into events';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
declare n int;
begin
  update public.users set display_name = 'hacked';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS TEST FAILED: authenticated updated % users rows', n; end if;
  update public.tabs set remaining_minor = 0;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS TEST FAILED: authenticated updated % tabs rows', n; end if;
  delete from public.receipts;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS TEST FAILED: authenticated deleted % receipts rows', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- As anon: sees nothing, writes nothing
-- ---------------------------------------------------------------------------
reset role;
set role anon;

select pg_temp.assert((select count(*) from public.users) = 0, 'anon must see no users');
select pg_temp.assert((select count(*) from public.tabs) = 0, 'anon must see no tabs');
select pg_temp.assert((select count(*) from public.mandates) = 0, 'anon must see no mandates');
select pg_temp.assert((select count(*) from public.cards) = 0, 'anon must see no cards');
select pg_temp.assert((select count(*) from public.receipts) = 0, 'anon must see no receipts');
select pg_temp.assert((select count(*) from public.events) = 0, 'anon must see no events');

do $$
begin
  begin
    insert into public.users (email) values ('anon@test.invalid');
    raise exception 'RLS TEST FAILED: anon must not insert into users';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'ALL RLS TESTS PASSED' as result;

rollback;
