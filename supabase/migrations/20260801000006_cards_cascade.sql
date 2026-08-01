-- cards.mandate_id was ON DELETE RESTRICT, which blocked user deletion
-- entirely (users -> tabs -> mandates cascade stopped at cards). Card rows
-- hold only the Stripe card ID reference; when the mandate goes (test
-- cleanup, GDPR erasure per OT-082), the row goes with it. The Stripe-side
-- card object is cancelled separately by application logic.
alter table public.cards
  drop constraint cards_mandate_id_fkey,
  add constraint cards_mandate_id_fkey
    foreign key (mandate_id) references public.mandates (id) on delete cascade;
