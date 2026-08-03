-- OT-120: hosted-service tiers. The paid product is SaaS convenience around
-- test-mode operation (G1 untouched): free self-hosts everything and gets
-- one hosted tab; paid tiers lift hosted limits. Entitlements are enforced
-- server-side at the API layer.
alter table public.users
  add column if not exists tier text not null default 'free'
    check (tier in ('free', 'hosted_dev', 'design_partner'));
