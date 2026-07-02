-- ============================================================
-- BDPS v2 — Business Digital Presence Scoring
-- Supabase / PostgreSQL schema with Auth integration
-- Run this entire file in Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- Clean slate (safe to re-run during setup)
-- ============================================================
drop table if exists analytics_logs cascade;
drop table if exists businesses cascade;
drop table if exists profiles cascade;
drop type if exists user_role;

-- ============================================================
-- Roles
-- ============================================================
create type user_role as enum ('admin', 'user');

-- ============================================================
-- Table: profiles
-- One row per auth.users entry. Created automatically via trigger
-- the moment someone signs up through Supabase Auth.
-- ============================================================
create table profiles (
    id              uuid primary key references auth.users(id) on delete cascade,
    email           varchar(255) not null,
    full_name       varchar(255) not null default '',
    role            user_role    not null default 'user',
    is_active       boolean      not null default true,
    created_at      timestamptz  not null default now(),
    updated_at      timestamptz  not null default now()
);

create index idx_profiles_role on profiles(role);

-- ============================================================
-- Table: businesses
-- Each business is owned by exactly one user (owner_id).
-- ============================================================
create table businesses (
    id              bigserial primary key,
    owner_id        uuid not null references profiles(id) on delete cascade,

    name            varchar(255) not null check (char_length(trim(name)) > 0),
    category        varchar(100) not null
        check (category in ('Restaurant','Retail','Healthcare','Education','Hotel','Fitness','Tech','Beauty','Other')),
    city            varchar(100) not null check (char_length(trim(city)) > 0),

    rating          decimal(3,1) not null default 4.0 check (rating >= 0 and rating <= 5),
    reviews         integer      not null default 0   check (reviews >= 0),
    website         boolean      not null default false,
    instagram       varchar(100) default '',
    followers       integer      not null default 0   check (followers >= 0),
    engagement      decimal(5,2) not null default 0   check (engagement >= 0),
    last_post       integer      not null default 30  check (last_post >= 0),

    score           integer      not null default 0   check (score >= 0 and score <= 100),

    created_at      timestamptz  not null default now(),
    updated_at      timestamptz  not null default now()
);

create index idx_businesses_owner    on businesses(owner_id);
create index idx_businesses_category on businesses(category);
create index idx_businesses_city     on businesses(city);
create index idx_businesses_score    on businesses(score desc);
create index idx_businesses_name     on businesses using gin (to_tsvector('english', name));

-- ============================================================
-- Table: analytics_logs (history of score changes, optional use)
-- ============================================================
create table analytics_logs (
    id              bigserial primary key,
    business_id     bigint references businesses(id) on delete cascade,
    metric_name     varchar(100) not null,
    metric_value    decimal(10,2) not null,
    recorded_at     timestamptz  not null default now()
);

create index idx_logs_business on analytics_logs(business_id);

-- ============================================================
-- Auto-create a profile row whenever someone signs up via Supabase Auth
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, email, full_name, role)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        coalesce((new.raw_user_meta_data->>'role')::user_role, 'user')
    );
    return new;
end;
$$ language plpgsql security definer;

create trigger trg_on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ============================================================
-- Auto-update updated_at on row changes
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated_at
before update on profiles
for each row execute function set_updated_at();

create trigger trg_businesses_updated_at
before update on businesses
for each row execute function set_updated_at();

-- ============================================================
-- Score calculation function (mirrors analytics.py / frontend exactly)
-- ============================================================
create or replace function calculate_score(
    p_rating      decimal,
    p_reviews     integer,
    p_website     boolean,
    p_followers   integer,
    p_engagement  decimal,
    p_last_post   integer
) returns integer as $$
declare
    rating_score      decimal;
    review_score      decimal;
    website_score     decimal;
    followers_score   decimal;
    engagement_score  decimal;
    activity_score    decimal;
begin
    rating_score     := (p_rating / 5.0) * 25;
    review_score     := least(p_reviews / 125.0, 1) * 20;
    website_score    := case when p_website then 15 else 0 end;
    followers_score  := least(p_followers / 2600.0, 1) * 20;
    engagement_score := least(p_engagement * 2.5, 10) / 10.0 * 15;

    if p_last_post <= 7 then
        activity_score := 5;
    elsif p_last_post <= 14 then
        activity_score := 3;
    else
        activity_score := 1;
    end if;

    return round(rating_score + review_score + website_score + followers_score + engagement_score + activity_score);
end;
$$ language plpgsql immutable;

create or replace function set_score()
returns trigger as $$
begin
    new.score := calculate_score(new.rating, new.reviews, new.website, new.followers, new.engagement, new.last_post);
    return new;
end;
$$ language plpgsql;

create trigger trg_businesses_score
before insert or update on businesses
for each row execute function set_score();

-- ============================================================
-- Helper: is the current user an admin?
-- ============================================================
create or replace function is_admin()
returns boolean as $$
begin
    return exists (
        select 1 from profiles
        where id = auth.uid() and role = 'admin' and is_active = true
    );
end;
$$ language plpgsql security definer stable;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table profiles enable row level security;
alter table businesses enable row level security;
alter table analytics_logs enable row level security;

-- ---- profiles ----
create policy "Users can view their own profile"
    on profiles for select
    using (id = auth.uid());

create policy "Admins can view all profiles"
    on profiles for select
    using (is_admin());

create policy "Users can update their own profile"
    on profiles for update
    using (id = auth.uid());

-- Prevent non-admins from changing their own role, even though the UPDATE
-- policy above allows the row update itself (regular users editing name/email
-- should not be able to smuggle in role='admin').
create or replace function prevent_self_role_escalation()
returns trigger as $$
begin
    if new.role <> old.role and not is_admin() then
        new.role := old.role;
    end if;
    if new.is_active <> old.is_active and not is_admin() then
        new.is_active := old.is_active;
    end if;
    return new;
end;
$$ language plpgsql security definer;

create trigger trg_prevent_self_role_escalation
before update on profiles
for each row execute function prevent_self_role_escalation();

create policy "Admins can update any profile"
    on profiles for update
    using (is_admin());

-- ---- businesses ----
create policy "Owners can view their own businesses"
    on businesses for select
    using (owner_id = auth.uid());

create policy "Admins can view all businesses"
    on businesses for select
    using (is_admin());

create policy "Owners can insert their own businesses"
    on businesses for insert
    with check (owner_id = auth.uid());

create policy "Admins can insert any business"
    on businesses for insert
    with check (is_admin());

create policy "Owners can update their own businesses"
    on businesses for update
    using (owner_id = auth.uid());

create policy "Admins can update any business"
    on businesses for update
    using (is_admin());

create policy "Owners can delete their own businesses"
    on businesses for delete
    using (owner_id = auth.uid());

create policy "Admins can delete any business"
    on businesses for delete
    using (is_admin());

-- ---- analytics_logs ----
create policy "Owners can view logs for their businesses"
    on analytics_logs for select
    using (exists (select 1 from businesses where businesses.id = analytics_logs.business_id and businesses.owner_id = auth.uid()));

create policy "Admins can view all logs"
    on analytics_logs for select
    using (is_admin());

create policy "System can insert logs"
    on analytics_logs for insert
    with check (true);

-- ============================================================
-- NOTE: No seed/demo data — table starts empty.
-- To create your first admin: sign up normally through the app,
-- then run this in the SQL editor (replace the email):
--
--   update profiles set role = 'admin' where email = 'you@example.com';
-- ============================================================
