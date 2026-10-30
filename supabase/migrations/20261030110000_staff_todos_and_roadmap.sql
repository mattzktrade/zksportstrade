-- Personal space for CMS staff: a private to-do list for every staff login, and
-- a development roadmap (projects with subtasks) that only Matt's account uses.
-- Every row is private to its owner through RLS; nobody else can read it.

create table if not exists public.staff_todos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  notes text not null default '',
  due_date date,
  done_at timestamptz,
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint staff_todos_title_check check (char_length(btrim(title)) between 1 and 300),
  constraint staff_todos_notes_check check (char_length(notes) <= 4000)
);

create index if not exists staff_todos_profile_idx
  on public.staff_todos (profile_id, done_at, position);

create table if not exists public.roadmap_projects (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  summary text not null default '',
  area text not null default 'other',
  status text not null default 'planned',
  due_date date,
  position integer not null default 0,
  suggested boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint roadmap_projects_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint roadmap_projects_summary_check check (char_length(summary) <= 6000),
  constraint roadmap_projects_status_check check (
    status in ('idea', 'planned', 'in_progress', 'blocked', 'done')
  ),
  constraint roadmap_projects_area_check check (
    area in (
      'crm', 'sales', 'operations', 'marketing', 'ai', 'data', 'client',
      'ticketing', 'website', 'partners', 'finance', 'security', 'other'
    )
  )
);

create index if not exists roadmap_projects_owner_idx
  on public.roadmap_projects (owner_profile_id, position);

create table if not exists public.roadmap_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.roadmap_projects (id) on delete cascade,
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  phase text not null default '',
  due_date date,
  done_at timestamptz,
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint roadmap_tasks_title_check check (char_length(btrim(title)) between 1 and 500),
  constraint roadmap_tasks_phase_check check (char_length(phase) <= 80)
);

create index if not exists roadmap_tasks_project_idx
  on public.roadmap_tasks (project_id, position);

alter table public.staff_todos enable row level security;
alter table public.roadmap_projects enable row level security;
alter table public.roadmap_tasks enable row level security;

drop policy if exists "staff_todos_owner_all" on public.staff_todos;
create policy "staff_todos_owner_all"
  on public.staff_todos for all
  using (profile_id = auth.uid() and public.is_cms_staff())
  with check (profile_id = auth.uid() and public.is_cms_staff());

drop policy if exists "roadmap_projects_owner_all" on public.roadmap_projects;
create policy "roadmap_projects_owner_all"
  on public.roadmap_projects for all
  using (owner_profile_id = auth.uid() and public.is_cms_staff())
  with check (owner_profile_id = auth.uid() and public.is_cms_staff());

drop policy if exists "roadmap_tasks_owner_all" on public.roadmap_tasks;
create policy "roadmap_tasks_owner_all"
  on public.roadmap_tasks for all
  using (owner_profile_id = auth.uid() and public.is_cms_staff())
  with check (
    owner_profile_id = auth.uid()
    and public.is_cms_staff()
    and exists (
      select 1 from public.roadmap_projects p
      where p.id = project_id and p.owner_profile_id = auth.uid()
    )
  );

revoke all on table public.staff_todos, public.roadmap_projects, public.roadmap_tasks from anon;
grant select, insert, update, delete on table public.staff_todos to authenticated;
grant select, insert, update, delete on table public.roadmap_projects to authenticated;
grant select, insert, update, delete on table public.roadmap_tasks to authenticated;
grant all on table public.staff_todos, public.roadmap_projects, public.roadmap_tasks to service_role;

comment on table public.staff_todos is
  'Private to-do list per CMS staff login (Profile in the admin header).';
comment on table public.roadmap_projects is
  'Development roadmap projects. Private to the owner; the app shows it to Matt only.';
comment on table public.roadmap_tasks is
  'Subtasks under a roadmap project. Phase groups them in the expanded view.';

-- ---------------------------------------------------------------------------
-- Starter roadmap for Matt. Runs once: skipped if he already has projects.
-- Due dates are left blank on purpose. suggested = ideas added alongside his list.
-- ---------------------------------------------------------------------------
do $seed$
declare
  owner_id uuid;
  proj jsonb;
  proj_pos bigint;
  task jsonb;
  task_pos bigint;
  new_project_id uuid;
  seed jsonb := $json$
[
  {
    "title": "Email sync with clients (like Salesforce)",
    "area": "crm",
    "status": "planned",
    "summary": "Every email between the team and a client logs itself on the right account, enquiry and deal, without anyone forwarding or copying. The CRM then uses those emails to move work along: mark an enquiry as replied, stop the outreach sequence, suggest the next stage, and flag a client who has gone quiet. Built on Microsoft 365 (Graph) against our existing Outlook mailboxes. MX stays on Outlook.",
    "tasks": [
      {"phase": "Connect", "title": "Register a ZK app in Microsoft Entra with Mail.Read (application) and limit it to staff mailboxes with an Exchange application access policy"},
      {"phase": "Connect", "title": "Agree which mailboxes sync (sales@, Ollie, Michel, Matt, operations) and get each person's OK"},
      {"phase": "Connect", "title": "Store the Microsoft credentials in Vercel, never in code"},
      {"phase": "Connect", "title": "Subscribe to new-mail notifications per mailbox and renew them automatically before they expire"},
      {"phase": "Match and log", "title": "Match each email to a contact by address, then to the open enquiry or deal (company domain as a fallback for new people)"},
      {"phase": "Match and log", "title": "One email timeline on account, enquiry and deal pages: sent and received, threaded, with attachments"},
      {"phase": "Match and log", "title": "Skip internal-only mail, newsletters and anything marked Private in Outlook"},
      {"phase": "Match and log", "title": "Optional, your call: pull in the last 12 months of email for existing accounts"},
      {"phase": "Automate", "title": "When a client replies, mark the enquiry as replied and pause the outreach sequence"},
      {"phase": "Automate", "title": "Suggest a stage change from what the email says (for example 'please send the contract') for one-click approval"},
      {"phase": "Automate", "title": "Alert the owner when a hot client has waited 24 hours for a reply"},
      {"phase": "Automate", "title": "Use the same feed for sales@ replies into Inbox, replacing the planned Power Automate step"},
      {"phase": "Automate", "title": "Calendar sync: log client meetings on the account"}
    ]
  },
  {
    "title": "ZK knowledge hub (company data centre)",
    "area": "data",
    "status": "planned",
    "summary": "One organised home inside the CRM for everything the business knows: product photos and video, brochures, contracts, supplier terms, venue and circuit info, brand assets, policies and how-to guides. Everything is tagged and searchable, so staff find things in seconds, and the AI assistant and agents read from one trusted source instead of guessing.",
    "tasks": [
      {"phase": "Plan", "title": "Agree folders and tags: Events, Products, Venues, Suppliers, Brand, Legal, Finance, How-to"},
      {"phase": "Plan", "title": "Decide what stays in SharePoint/OneDrive and what moves into the CRM"},
      {"phase": "Plan", "title": "Set who can see what (sales, finance, operations, admin) before anything is uploaded"},
      {"phase": "Build", "title": "Hub page: upload, tag, preview, version history and search"},
      {"phase": "Build", "title": "Link files to events, products, suppliers and accounts so they show on those pages"},
      {"phase": "Build", "title": "Sync from SharePoint/OneDrive through Microsoft Graph so files do not need moving by hand"},
      {"phase": "Build", "title": "Media library with tags (event, venue, package) and usage rights, feeding brochures, the website and social"},
      {"phase": "AI", "title": "Index documents for AI search in Supabase (pgvector), respecting who can see what"},
      {"phase": "AI", "title": "Ask the hub: a search box that answers with links to the source document"},
      {"phase": "AI", "title": "Let the assistant and agents read approved knowledge only"},
      {"phase": "AI", "title": "Flag out-of-date documents (for example last season's venue guide) for review"}
    ]
  },
  {
    "title": "AI agent control room (foundations)",
    "area": "ai",
    "status": "planned",
    "summary": "The base every AI agent runs on. One page shows what each agent did, what it is waiting on, and what needs a person. Agents report to a manager agent for their area (Sales, Operations, Marketing, IT and security, Finance). Managers send a short daily summary and flag anything risky straight away. Nothing leaves the business (a client message, a payment, a price change) without the right approval until we trust that agent.",
    "tasks": [
      {"phase": "Foundations", "title": "Agent register: name, area, manager, job, tools it may use, and who approves its work"},
      {"phase": "Foundations", "title": "Shared approval queue: agents propose, a person approves or edits with one tap on web or phone"},
      {"phase": "Foundations", "title": "Audit log of every agent action with the reason and the data it used"},
      {"phase": "Foundations", "title": "Autonomy levels per agent: suggest only, act with approval, act and report"},
      {"phase": "Foundations", "title": "Spend limit and an off switch per agent"},
      {"phase": "Foundations", "title": "Tool layer (MCP) over CRM actions so agents follow the same rules as staff, never raw database access"},
      {"phase": "Managers", "title": "Daily manager digest by email or WhatsApp: done, waiting on you, problems"},
      {"phase": "Managers", "title": "Escalation rules: low confidence, money, legal or an unhappy client goes to a person immediately"},
      {"phase": "Quality", "title": "Weekly sample review of agent output and a scorecard per agent"},
      {"phase": "Quality", "title": "Pick the model per job (fast and cheap for sorting, strongest for writing to clients) and track cost per agent"}
    ]
  },
  {
    "title": "Sales agent team",
    "area": "ai",
    "status": "planned",
    "summary": "A Sales manager agent running specialist agents that find, warm up and convert clients and keep the pipeline tidy. Staff stay the face of the business; agents do the legwork and draft the messages.",
    "tasks": [
      {"phase": "Find", "title": "Prospecting agent: target lists (corporate hospitality buyers, PAs, travel agents, family offices) from approved sources, with a reason for each pick"},
      {"phase": "Find", "title": "Outreach agent: personalised first-touch emails and LinkedIn drafts using our real packages, sent only after approval"},
      {"phase": "Convert", "title": "Warm enquiry agent: answers new website and marketing enquiries within minutes with availability and the brochure"},
      {"phase": "Convert", "title": "Deal creator agent: turns an agreed quote in email or WhatsApp into a draft deal with the right products and quantities"},
      {"phase": "Convert", "title": "Follow-up agent: chases quiet quotes on the existing follow-up cadence and logs each touch"},
      {"phase": "Grow", "title": "Upsell agent: suggests extra days, hotels, transfers and experiences based on what similar clients bought"},
      {"phase": "Grow", "title": "Rebooking agent: contacts last season's clients when next season's stock is added"},
      {"phase": "Manage", "title": "Sales manager agent: daily pipeline summary, deals at risk, and who needs a call today"},
      {"phase": "Manage", "title": "Measure reply time, conversion and revenue against before the agents"}
    ]
  },
  {
    "title": "Operations agent team",
    "area": "ai",
    "status": "planned",
    "summary": "An Operations manager agent with specialists that handle the busy work between booking and event day: chasing guest details, getting tickets from suppliers, assigning tickets to guests and keeping clients informed. Builds on the guest details form, ticketing and the operations board already in the CRM.",
    "tasks": [
      {"phase": "Guests", "title": "Guest comms agent: pre-event messages, and answers routine questions using the client event hub"},
      {"phase": "Guests", "title": "Guest details agent: chases missing names, dietary needs and headshots until the booking is complete"},
      {"phase": "Tickets", "title": "Supplier ticket agent: requests tickets from suppliers, tracks promised dates and escalates delays"},
      {"phase": "Tickets", "title": "Ticket assignment agent: matches tickets to guests and prepares the send for approval"},
      {"phase": "Event", "title": "Logistics agent: hotels, transfers and on-site timings checklist per booking"},
      {"phase": "Event", "title": "Event-week agent: checks 7, 3 and 1 day out, with a red, amber, green board"},
      {"phase": "Event", "title": "After-event agent: thank-you, feedback request, review request and hand-over to sales for rebooking"},
      {"phase": "Manage", "title": "Operations manager agent: daily list of blockers per event"}
    ]
  },
  {
    "title": "Marketing agent team",
    "area": "ai",
    "status": "planned",
    "summary": "A Marketing manager agent with specialists for research, competitors, social, email and paid ads. They draft and analyse; a person approves anything that goes public or spends money.",
    "tasks": [
      {"phase": "Research", "title": "Market research agent: weekly demand signals per event (search trends, price moves, news)"},
      {"phase": "Research", "title": "Competitor agent: tracks competitor packages, prices and messaging and alerts on changes"},
      {"phase": "Create", "title": "Social media agent: drafts posts and short video scripts from our media library, scheduled after approval"},
      {"phase": "Create", "title": "Email campaign agent: segmented campaigns (past clients, agents, event interest) with subject line tests"},
      {"phase": "Create", "title": "Website content agent: event and venue guides for the new site, checked against the knowledge hub"},
      {"phase": "Paid", "title": "Paid ads agent: reads Meta and Google results daily and suggests budget and audience changes; changes need approval"},
      {"phase": "Reputation", "title": "Reviews agent: asks for reviews after events and drafts replies"},
      {"phase": "Manage", "title": "Marketing manager agent: weekly report on leads, cost per lead and bookings by channel"}
    ]
  },
  {
    "title": "IT and security agent team",
    "area": "security",
    "status": "planned",
    "summary": "Agents that watch the CRM, websites and company accounts for security problems, keep us current on threats that matter to a ticketing and hospitality business, and prepare fixes for a person to approve.",
    "tasks": [
      {"phase": "Code", "title": "Review agent on every change: secrets, access rules and injection risks"},
      {"phase": "Code", "title": "Dependency watch: alert on vulnerable packages and prepare the fix"},
      {"phase": "Code", "title": "Weekly database check: every table has row-level security and nothing is open to the public key"},
      {"phase": "Watch", "title": "Uptime and error alerts for the CRM, websites, webhooks and scheduled jobs"},
      {"phase": "Watch", "title": "Threat news digest: breaches and scams relevant to us (ticket fraud, invoice fraud, Microsoft 365 phishing)"},
      {"phase": "Watch", "title": "Payment fraud guard: flag changed bank details on invoices and unusual booking patterns"},
      {"phase": "People", "title": "Account hygiene: two-factor on Microsoft 365, CRM, Meta and Xero; remove leavers the same day"},
      {"phase": "People", "title": "Backups with a restore test every quarter"},
      {"phase": "Manage", "title": "Security manager agent: weekly security score and anything that needs action"}
    ]
  },
  {
    "title": "Client event hub page",
    "area": "client",
    "status": "planned",
    "summary": "One link per booking that the client keeps: their tickets and how they get them, venue and hospitality info, the schedule, getting there, parking, what to know and who to contact. Each event or product has a set template that staff fill once, and every booking page pulls from it. Replaces lots of separate emails and PDFs, and gives the guest comms agent one place to point clients to.",
    "tasks": [
      {"phase": "Template", "title": "Template per event or product, using the guest guide sections (Welcome, Before race weekend, Digital ticket, Arriving, Experience, Getting there, Parking, On-ground support, Things to know)"},
      {"phase": "Template", "title": "Branding: ZK by default, white-label for agent clients, Velocity Terrace style for VT bookings"},
      {"phase": "Booking page", "title": "Secure link per booking (like the ticket pass link) showing the client's own tickets and guest list"},
      {"phase": "Booking page", "title": "Ticket status per guest: not sent yet, sent, how to collect, Add to Wallet"},
      {"phase": "Booking page", "title": "Schedule in the venue's time zone, updated by staff and shown straight away"},
      {"phase": "Booking page", "title": "Map, transport and parking with one-tap directions"},
      {"phase": "Booking page", "title": "Guest details and dietary updates from the same page"},
      {"phase": "Booking page", "title": "On-ground contact card, shown only when staff add one"},
      {"phase": "Send", "title": "Include the link in the booking confirmation and pre-event messages"},
      {"phase": "Send", "title": "Track opens so operations can see who has read the info"}
    ]
  },
  {
    "title": "Ticketing app: final testing and Wallets",
    "area": "ticketing",
    "status": "in_progress",
    "summary": "Finish the in-house ticketing rebuild so we can run our own hospitality doors without TicketBud. The CRM side (issue, send, guest pass, door scanning, physical tickets, offline scanning) is built. What is left is a full live rehearsal and Apple and Google Wallet passes.",
    "tasks": [
      {"phase": "Built", "title": "Issue, send, guest pass, door check-in and physical tickets (phases A to D)", "done": true},
      {"phase": "Built", "title": "Offline scan queue on the phone and the Help guide", "done": true},
      {"phase": "Test", "title": "Confirm both ticketing migrations and TICKET_SIGNING_SECRET are live in production"},
      {"phase": "Test", "title": "Full rehearsal: issue, send and scan 50+ test tickets on three phones, including with no signal"},
      {"phase": "Test", "title": "Edge cases: reissue, void, wrong day, multi-day pass, walk-up"},
      {"phase": "Wallets", "title": "Apple Developer account and Pass Type ID certificate"},
      {"phase": "Wallets", "title": "Apple Wallet pass with the QR, using the classic event ticket style (Apple's new poster style does not support QR entry)"},
      {"phase": "Wallets", "title": "Google Wallet issuer account, event class and Add to Google Wallet button"},
      {"phase": "Wallets", "title": "Push changes (time, seat, void) to passes already saved on phones"},
      {"phase": "Go live", "title": "Send tickets from Jenny's zk-sports.com address once the domain is on Resend"},
      {"phase": "Go live", "title": "Pilot at the next ZK-hosted event after Singapore 2026, then retire TicketBud"},
      {"phase": "Go live", "title": "Replace the TicketBud wording in the Velocity Terrace guest guide"}
    ]
  },
  {
    "title": "WhatsApp AI assistant for Ollie and Michel",
    "area": "sales",
    "status": "in_progress",
    "summary": "Finish the sales assistant so it answers enquiries on Ollie's and Michel's WhatsApp in their voice: quick, accurate replies using our real stock, with anything uncertain handed back to them. The Inbox, knowledge base and the ZK Cloud API number are already live.",
    "tasks": [
      {"phase": "Built", "title": "Sales Inbox with WhatsApp inbound, knowledge base and readiness checks", "done": true},
      {"phase": "Connect", "title": "Check Ollie's and Michel's numbers are on the WhatsApp Business app (personal WhatsApp cannot be connected)"},
      {"phase": "Connect", "title": "Connect their numbers with Meta coexistence so they keep the app on their phones and the CRM sees every chat, without ZK becoming a Meta Tech Provider"},
      {"phase": "Train", "title": "Write their tone of voice and rules: what it may say, what needs them, when to hand over"},
      {"phase": "Train", "title": "Test set from real chats, re-run before every change"},
      {"phase": "Train", "title": "Try a newer model than gpt-4o and compare accuracy and cost"},
      {"phase": "Roll out", "title": "Shadow mode for two weeks: the assistant drafts, they send, and we compare"},
      {"phase": "Roll out", "title": "Auto-reply to simple questions (availability, what is included, dates); prices and contracts stay on approval"},
      {"phase": "Roll out", "title": "Hand-over alert with a short summary when the assistant is unsure"},
      {"phase": "Roll out", "title": "Weekly report: replies sent, time saved, deals started"}
    ]
  },
  {
    "title": "Sourcing agent and supplier hub",
    "area": "operations",
    "status": "planned",
    "summary": "When a client wants something we do not hold, the sourcing agent knows which suppliers to ask from a supplier hub, messages them as ZK, reads the replies, and puts the answer on the enquiry's sourcing stage so the sales lead knows quickly whether we can help.",
    "tasks": [
      {"phase": "Supplier hub", "title": "What each supplier sells (events, packages, ticket types), contacts, typical lead time, terms and a reliability score"},
      {"phase": "Supplier hub", "title": "Fill it from the Suppliers page and past purchase orders"},
      {"phase": "Agent", "title": "When an enquiry reaches sourcing, pick the best suppliers to ask and show why"},
      {"phase": "Agent", "title": "Send the request by email or WhatsApp as ZK from a sourcing mailbox, using approved wording"},
      {"phase": "Agent", "title": "Read replies and pull out price, quantity and how long the quote is valid"},
      {"phase": "Agent", "title": "Update the sourcing stage (quote in, cannot help, waiting) and alert the sales lead"},
      {"phase": "Agent", "title": "Chase suppliers that miss the reply deadline"},
      {"phase": "Close", "title": "Margin check: our sell price against the quote before the lead replies to the client"},
      {"phase": "Close", "title": "One click to accept a quote and raise the purchase order"},
      {"phase": "Close", "title": "Learn which suppliers answer fastest and at the best price"}
    ]
  },
  {
    "title": "ZK Sports website rebuild and search plan",
    "area": "website",
    "status": "planned",
    "summary": "Rebuild zk-sports.com on our own platform (the same stack as the CRM) so stock, prices and bookings come straight from the CRM. Keep our current Google rankings from Wix with a careful move, then grow visibility in Google and AI answers (ChatGPT, Gemini, Google AI Mode) with genuinely useful event and venue content. Google's 2026 guidance: no special AI files or schema needed; clear pages that answer real buyer questions win.",
    "tasks": [
      {"phase": "Before the build", "title": "Export every Wix URL, title and description, the Wix redirect list, and 16 months of Search Console data"},
      {"phase": "Before the build", "title": "List the top pages and backlinks that must keep working"},
      {"phase": "Before the build", "title": "Page plan: events, packages, venues, guides, about, contact"},
      {"phase": "Build", "title": "Event and package pages driven by CRM products, with live availability"},
      {"phase": "Build", "title": "Online booking and payment (see the online payments project)"},
      {"phase": "Build", "title": "Fast, mobile-first pages (Core Web Vitals green)"},
      {"phase": "Build", "title": "Structured data that matches the page: Organization, Event, Product, Breadcrumb"},
      {"phase": "Move", "title": "One-to-one permanent redirect from every Wix URL, tested on a preview site first"},
      {"phase": "Move", "title": "Keep Wix running until the new site is stable; do not touch email DNS"},
      {"phase": "Move", "title": "Submit the sitemap and watch Search Console daily for two weeks"},
      {"phase": "Grow", "title": "Event and venue guides that answer real buyer questions, taken from sales calls and assistant chats"},
      {"phase": "Grow", "title": "Allow AI search crawlers (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot) and track how often we appear in AI answers"},
      {"phase": "Grow", "title": "Google Business Profile, real reviews, and genuine press and partner mentions"},
      {"phase": "Grow", "title": "Agent-ready checkout: watch OpenAI's Agentic Commerce Protocol and Google's Universal Commerce Protocol so AI assistants can book our packages"}
    ]
  },
  {
    "title": "CRM on mobile and smarter notifications",
    "area": "crm",
    "status": "planned",
    "summary": "Make the CRM easy to run from a phone (check a deal, reply to a client, log a call, scan a ticket) and send each person only the alerts that matter to them, where they will see them.",
    "tasks": [
      {"phase": "Mobile", "title": "List the top 10 phone tasks per role and fix each screen"},
      {"phase": "Mobile", "title": "Install on the home screen as an app, with the ZK icon"},
      {"phase": "Mobile", "title": "Tap to call and tap to WhatsApp wherever a number appears"},
      {"phase": "Notifications", "title": "Phone push alerts for new enquiries, client replies, signatures and payments"},
      {"phase": "Notifications", "title": "Settings per person: which alerts, where (push, email, WhatsApp) and quiet hours"},
      {"phase": "Notifications", "title": "Notification bell in the header with read and unread"},
      {"phase": "Notifications", "title": "Bundle low-priority alerts into a daily digest"}
    ]
  },
  {
    "title": "Ongoing CRM improvements",
    "area": "crm",
    "status": "in_progress",
    "summary": "A running list of smaller fixes and ideas from the team. Add a subtask whenever something comes up.",
    "tasks": [
      {"phase": "", "title": "Monthly check-in with the team on what slows them down"},
      {"phase": "", "title": "Speed check of the slowest pages"},
      {"phase": "", "title": "Tidy old one-off scripts and Salesforce leftovers"},
      {"phase": "", "title": "Keep the Help guide current after each change"}
    ]
  },
  {
    "title": "Velocity Terrace website revamp",
    "area": "website",
    "status": "planned",
    "summary": "Make Velocity Terrace look and feel like an official product brand in its own right: a clear story, strong photography, easy booking, and the same live stock as the CRM.",
    "tasks": [
      {"phase": "Brand", "title": "Brand basics: logo use, colours, type, photography style and tone"},
      {"phase": "Brand", "title": "Photo and video brief for the next event"},
      {"phase": "Site", "title": "Page plan: the experience, gallery, what is included, location, FAQs, book"},
      {"phase": "Site", "title": "Booking connected to the CRM: live availability, enquiries straight into Enquiries"},
      {"phase": "Site", "title": "Partners and press section, only real partners with their permission"},
      {"phase": "Site", "title": "Search basics and redirects from the current site"},
      {"phase": "Site", "title": "Use the client event hub style for Velocity Terrace bookings"}
    ]
  },
  {
    "title": "Trade portal APIs for agents",
    "area": "partners",
    "status": "planned",
    "summary": "Let approved agents and travel companies show and sell our stock on their own websites and systems through a secure API, using the same live stock, holds and trade pricing as the trade portal, so nothing can oversell.",
    "tasks": [
      {"phase": "Plan", "title": "Decide what agents can see: products, trade prices, availability, images, inclusions"},
      {"phase": "Build", "title": "API key per agent, with limits and an instant off switch"},
      {"phase": "Build", "title": "Read endpoints: events, products, availability"},
      {"phase": "Build", "title": "Booking endpoints: hold, confirm, cancel, using the existing stock rules"},
      {"phase": "Build", "title": "Webhooks to agents when stock or prices change"},
      {"phase": "Launch", "title": "Developer docs page and a test (sandbox) mode"},
      {"phase": "Launch", "title": "Usage dashboard: who is calling and what they sold"},
      {"phase": "Launch", "title": "Consider listing on B2B distribution networks (for example SeatsConnect or XS2Event) through the same API"}
    ]
  },
  {
    "title": "Partner stock on our website (inbound APIs)",
    "area": "partners",
    "status": "planned",
    "summary": "Show other companies' stock on our website next to ours, so clients get more choice from us. Start with one partner, then make it easy to add more. Partner stock is kept separate from our own stock and costs.",
    "tasks": [
      {"phase": "Plan", "title": "Shortlist partners with APIs and agree terms (commission or net rates)"},
      {"phase": "Plan", "title": "Challenges to settle: duplicate listings, different cancellation terms, currency, and who supports the client"},
      {"phase": "Build", "title": "One common product format so every partner's stock looks the same on our site"},
      {"phase": "Build", "title": "Connector per partner: products, availability, prices, booking"},
      {"phase": "Build", "title": "Mark partner stock in the CRM and never mix it with our own cost layers"},
      {"phase": "Build", "title": "Price rules: our margin on top of the partner's net price, per partner"},
      {"phase": "Run", "title": "Book through the partner's API at checkout, with a fallback if the partner is down"},
      {"phase": "Run", "title": "Nightly check that partner stock and prices still match"}
    ]
  },
  {
    "title": "Online card payments and payment plans",
    "area": "finance",
    "status": "idea",
    "suggested": true,
    "summary": "Let clients pay deposits and balances online by card or bank transfer from the booking form, invoice or website, with automatic reminders and Xero reconciliation. Faster cash and fewer chasers, and needed for online booking on the new website.",
    "tasks": [
      {"phase": "", "title": "Pick a provider (for example Stripe) and agree fees and currencies (GBP, EUR, USD, AED)"},
      {"phase": "", "title": "Pay link on booking forms and invoices"},
      {"phase": "", "title": "Payment plans: deposit now, balance by a date, automatic reminders"},
      {"phase": "", "title": "Mark paid in the CRM and Xero automatically"},
      {"phase": "", "title": "Fraud checks and 3D Secure"}
    ]
  },
  {
    "title": "Client retention and rebooking",
    "area": "marketing",
    "status": "idea",
    "suggested": true,
    "summary": "Our best clients come back every season. Make that happen on purpose: feedback after each event, reviews from happy clients, and first access to next season's stock before it goes public.",
    "tasks": [
      {"phase": "", "title": "One-minute feedback survey after each event, with a score per client"},
      {"phase": "", "title": "Ask happy clients for a Google or Trustpilot review"},
      {"phase": "", "title": "Client history on the account: every event, spend, preferences and guests"},
      {"phase": "", "title": "Early access list when next season's stock is added"},
      {"phase": "", "title": "Referral thank-you for clients who introduce others"}
    ]
  },
  {
    "title": "Stock risk and pricing insights",
    "area": "sales",
    "status": "idea",
    "suggested": true,
    "summary": "See early which events risk unsold stock and where we could charge more, using sales speed, days to the event and enquiries per product. Staff make the price decision; the CRM shows the evidence.",
    "tasks": [
      {"phase": "", "title": "Sell-through per product against days to the event, compared with last season"},
      {"phase": "", "title": "At-risk alert for stock that will not sell at the current pace"},
      {"phase": "", "title": "Price suggestions: raise when demand is hot, push when slow"},
      {"phase": "", "title": "Money tied up in unsold stock per event and supplier"},
      {"phase": "", "title": "Weekly summary to Matt"}
    ]
  },
  {
    "title": "Finance agent team",
    "area": "finance",
    "status": "idea",
    "suggested": true,
    "summary": "A fifth agent team for the money side: chasing payments, matching supplier bills to purchase orders, and spotting mismatches between the CRM, Xero and the bank before they become problems.",
    "tasks": [
      {"phase": "", "title": "Payment chaser agent: polite reminders before and after due dates"},
      {"phase": "", "title": "Supplier bill agent: reads supplier invoices from email and matches them to purchase orders"},
      {"phase": "", "title": "Reconciliation agent: flags mismatches between the CRM, Xero and the bank"},
      {"phase": "", "title": "Month-end pack: revenue, margin, cash and stock exposure per event"},
      {"phase": "", "title": "Currency watch: alert when exchange rates hurt the margin on open deals"}
    ]
  },
  {
    "title": "Staff two-factor sign-in and access review",
    "area": "security",
    "status": "idea",
    "suggested": true,
    "summary": "Protect the CRM with a second step at sign-in for every staff login, and check regularly who can access what. Most real-world breaches start with one stolen password.",
    "tasks": [
      {"phase": "", "title": "Two-factor (authenticator app) for CRM staff logins"},
      {"phase": "", "title": "Alert on sign-in from a new device"},
      {"phase": "", "title": "Quarterly access review by role"},
      {"phase": "", "title": "Same-day leaver checklist: CRM, Microsoft 365, Meta, Xero"}
    ]
  },
  {
    "title": "AI phone line for missed calls",
    "area": "sales",
    "status": "idea",
    "suggested": true,
    "summary": "When nobody can answer, an AI voice picks up, says it is an AI assistant, takes the enquiry details and books a call back. The transcript lands on the enquiry. Trial on out-of-hours calls only before going further.",
    "tasks": [
      {"phase": "", "title": "Choose a voice provider and a UK or UAE number"},
      {"phase": "", "title": "Script: greet, take details, book a call back, never quote prices"},
      {"phase": "", "title": "Transcript and summary saved on the enquiry"},
      {"phase": "", "title": "Two-week out-of-hours trial, then review"}
    ]
  }
]
$json$::jsonb;
begin
  select id into owner_id
  from public.profiles
  where lower(email) = 'matt@zk-sports.com'
  limit 1;

  if owner_id is null then
    return;
  end if;

  if exists (select 1 from public.roadmap_projects where owner_profile_id = owner_id) then
    return;
  end if;

  for proj, proj_pos in
    select value, ordinality from jsonb_array_elements(seed) with ordinality
  loop
    insert into public.roadmap_projects (owner_profile_id, title, summary, area, status, position, suggested)
    values (
      owner_id,
      proj ->> 'title',
      coalesce(proj ->> 'summary', ''),
      coalesce(proj ->> 'area', 'other'),
      coalesce(proj ->> 'status', 'planned'),
      proj_pos::integer,
      coalesce((proj ->> 'suggested')::boolean, false)
    )
    returning id into new_project_id;

    for task, task_pos in
      select value, ordinality from jsonb_array_elements(proj -> 'tasks') with ordinality
    loop
      insert into public.roadmap_tasks (project_id, owner_profile_id, title, phase, position, done_at)
      values (
        new_project_id,
        owner_id,
        task ->> 'title',
        coalesce(task ->> 'phase', ''),
        task_pos::integer,
        case when coalesce((task ->> 'done')::boolean, false) then timezone('utc', now()) else null end
      );
    end loop;
  end loop;
end
$seed$;
