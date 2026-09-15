-- Operations fulfilment board: ops contact, structured fulfilment methods,
-- deal-scoped delivery proof, and editable email templates.

alter table public.deals
  add column if not exists operations_contact_id uuid references public.crm_contacts (id) on delete set null;

create index if not exists deals_operations_contact_idx
  on public.deals (operations_contact_id)
  where operations_contact_id is not null;

comment on column public.deals.operations_contact_id is
  'Contact who receives guest/ticket emails for this booking. Falls back to primary_contact_id.';

alter table public.order_operations
  add column if not exists supplier_fulfilment_method text,
  add column if not exists client_delivery_method text,
  add column if not exists thank_you_skipped_at timestamptz;

alter table public.deal_operations
  add column if not exists supplier_fulfilment_method text,
  add column if not exists client_delivery_method text,
  add column if not exists thank_you_skipped_at timestamptz;

alter table public.order_operations
  drop constraint if exists order_operations_supplier_fulfilment_method_check;
alter table public.order_operations
  add constraint order_operations_supplier_fulfilment_method_check check (
    supplier_fulfilment_method is null
    or supplier_fulfilment_method in (
      'names_only',
      'digital_to_zk',
      'collect_from_supplier',
      'supplier_posts_to_guest',
      'official_ships'
    )
  );

alter table public.order_operations
  drop constraint if exists order_operations_client_delivery_method_check;
alter table public.order_operations
  add constraint order_operations_client_delivery_method_check check (
    client_delivery_method is null
    or client_delivery_method in (
      'supplier_handles',
      'send_digital',
      'local_collection',
      'posted_to_guest',
      'official_shipment'
    )
  );

alter table public.deal_operations
  drop constraint if exists deal_operations_supplier_fulfilment_method_check;
alter table public.deal_operations
  add constraint deal_operations_supplier_fulfilment_method_check check (
    supplier_fulfilment_method is null
    or supplier_fulfilment_method in (
      'names_only',
      'digital_to_zk',
      'collect_from_supplier',
      'supplier_posts_to_guest',
      'official_ships'
    )
  );

alter table public.deal_operations
  drop constraint if exists deal_operations_client_delivery_method_check;
alter table public.deal_operations
  add constraint deal_operations_client_delivery_method_check check (
    client_delivery_method is null
    or client_delivery_method in (
      'supplier_handles',
      'send_digital',
      'local_collection',
      'posted_to_guest',
      'official_shipment'
    )
  );

comment on column public.order_operations.supplier_fulfilment_method is
  'How tickets or names move from the supplier to ZK.';
comment on column public.order_operations.client_delivery_method is
  'How the guest actually receives their tickets.';

-- Proof of delivery: allow deal-only bookings and ops staff.
alter table public.order_delivery_proofs
  add column if not exists deal_id uuid references public.deals (id) on delete cascade;

alter table public.order_delivery_proofs
  alter column invoice_id drop not null;

alter table public.order_delivery_proofs
  alter column order_id drop not null;

alter table public.order_delivery_proofs
  drop constraint if exists order_delivery_proofs_parent_check;
alter table public.order_delivery_proofs
  add constraint order_delivery_proofs_parent_check
  check (order_id is not null or deal_id is not null);

create index if not exists order_delivery_proofs_deal_idx
  on public.order_delivery_proofs (deal_id, created_at desc)
  where deal_id is not null;

drop policy if exists "order_delivery_proofs_select_admin" on public.order_delivery_proofs;
create policy "order_delivery_proofs_select_admin"
  on public.order_delivery_proofs for select
  using (public.has_cms_permission('operations.view') or public.is_admin());

drop policy if exists "order_delivery_proofs_insert_admin" on public.order_delivery_proofs;
create policy "order_delivery_proofs_insert_admin"
  on public.order_delivery_proofs for insert
  with check (public.has_cms_permission('operations.manage') or public.is_admin());

-- Email kinds used by the operations templates and send log.
alter table public.operations_emails
  drop constraint if exists operations_emails_kind_check;
alter table public.operations_emails
  add constraint operations_emails_kind_check check (
    kind in (
      'guest_details',
      'operations_intro',
      'guest_details_reminder',
      'names_sent',
      'collection_details',
      'tickets_sent',
      'after_event'
    )
  );

create table if not exists public.operations_email_templates (
  kind text primary key,
  subject text not null,
  body text not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint operations_email_templates_kind_check check (
    kind in (
      'guest_details',
      'operations_intro',
      'guest_details_reminder',
      'names_sent',
      'collection_details',
      'tickets_sent',
      'after_event'
    )
  ),
  constraint operations_email_templates_subject_check check (btrim(subject) <> ''),
  constraint operations_email_templates_body_check check (btrim(body) <> '')
);

alter table public.operations_email_templates enable row level security;

drop policy if exists "operations_email_templates_cms_select" on public.operations_email_templates;
create policy "operations_email_templates_cms_select"
  on public.operations_email_templates for select
  using (public.has_cms_permission('operations.view') or public.is_admin());

drop policy if exists "operations_email_templates_cms_write" on public.operations_email_templates;
create policy "operations_email_templates_cms_write"
  on public.operations_email_templates for all
  using (public.has_cms_permission('operations.manage') or public.is_admin())
  with check (public.has_cms_permission('operations.manage') or public.is_admin());

insert into public.operations_email_templates (kind, subject, body)
values
  (
    'operations_intro',
    'Next steps for {{event}}',
    E'Hi {{first_name}},\n\nI''m Jenny from ZK Sports & Entertainment. I hope you are well. Now that the {{account_name}} booking for {{event}} is confirmed, I wanted to introduce myself — I will look after guest names, tickets, and delivery from here, so you have one place to go with any practical questions.\n\nWhat happens next:\n1. We collect guest details for each place on the booking\n2. We send the tickets to you (or the named guests) ahead of the event\n\nPlease reply to this email if you need anything on seating, hospitality, delivery timing, or guest names. Your sales contact remains available for anything commercial.\n\nI will be in touch again once tickets are ready to send.\n\nKind regards,\nJenny Kent\nZK Sports & Entertainment'
  ),
  (
    'guest_details',
    'Guest details needed — {{event}}',
    E'Hi {{first_name}},\n\nI''m Jenny from ZK Sports & Entertainment. Thank you for confirming this booking with us.\n\nTo get tickets and delivery organised for {{event}}, I now need guest details for the {{guests}} on this booking.\n\n{{guest_details_block}}\n\nOnce I have this, I can prepare the tickets and send them across ahead of the event.\n\nIf anything has changed on the booking, just reply and I will help.\n\nKind regards,\nJenny Kent\nZK Sports & Entertainment'
  ),
  (
    'guest_details_reminder',
    'Reminder: guest details for {{event}}',
    E'Hi {{first_name}},\n\nJust a reminder that we still need guest details for {{event}} so we can meet the supplier deadline{{deadline_clause}}.\n\n{{guest_details_block}}\n\nPlease send these as soon as you can.\n\nKind regards,\nJenny Kent\nZK Sports & Entertainment'
  ),
  (
    'names_sent',
    'Guest names sent for {{event}}',
    E'Hi {{first_name}},\n\nI have sent the guest names for {{event}} through to the supplier. They will look after issuing and delivery from here.\n\nIf anything on the booking changes, reply to this email and I will update them.\n\nKind regards,\nJenny Kent\nZK Sports & Entertainment'
  ),
  (
    'collection_details',
    'Ticket collection for {{event}}',
    E'Hi {{first_name}},\n\nTickets for {{event}} will be collected locally.\n\nCollection point: {{collection_point}}\nCollection time: {{collection_time}}\n\nPlease have photo ID matching the guest names with you. Reply if you need to change the collection plan.\n\nKind regards,\nJenny Kent\nZK Sports & Entertainment'
  ),
  (
    'tickets_sent',
    'Your tickets for {{event}}',
    E'Hi {{first_name}},\n\nYour tickets for {{event}} are attached / on the way. Please check names and dates, and keep them handy for entry.\n\nIf anything looks wrong, reply to this email and I will help straight away.\n\nKind regards,\nJenny Kent\nZK Sports & Entertainment'
  ),
  (
    'after_event',
    'Thank you for {{event}}',
    E'Hi {{first_name}},\n\nI hope you enjoyed {{event}}. If you would like to attend again next year, or there are any other races or events you would like to go to, just let us know — we would be happy to help.\n\nKind regards,\nJenny Kent\nZK Sports & Entertainment'
  )
on conflict (kind) do nothing;
