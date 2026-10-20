
-- Privacy settings (per user)
CREATE TABLE public.privacy_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  allow_friend_requests boolean not null default true,
  group_visibility text not null default 'public', -- public | friends | private
  allow_community_posting boolean not null default true,
  show_avatar_publicly boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.privacy_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Privacy viewable by all authed" ON public.privacy_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own privacy" ON public.privacy_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own privacy" ON public.privacy_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_privacy_settings_updated BEFORE UPDATE ON public.privacy_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Communities
CREATE TABLE public.communities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  description text,
  sport text,
  emoji text not null default '🏆',
  privacy text not null default 'public', -- public | private | invite
  member_count integer not null default 1,
  trending_score numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Communities viewable by all" ON public.communities FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users create communities" ON public.communities FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update communities" ON public.communities FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete communities" ON public.communities FOR DELETE TO authenticated USING (auth.uid() = owner_id);
CREATE TRIGGER trg_communities_updated BEFORE UPDATE ON public.communities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Members
CREATE TABLE public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member', -- leader | moderator | member
  notifications_enabled boolean not null default true,
  joined_at timestamptz not null default now(),
  unique(community_id, user_id)
);
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members viewable by all authed" ON public.community_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users join communities" ON public.community_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own membership" ON public.community_members FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users leave or owner removes" ON public.community_members FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.communities c WHERE c.id = community_id AND c.owner_id = auth.uid()));

-- Security definer to check membership without recursion
CREATE OR REPLACE FUNCTION public.is_community_member(_community_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_members WHERE community_id = _community_id AND user_id = _user_id);
$$;

-- Posts
CREATE TABLE public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null,
  content text not null,
  created_at timestamptz not null default now()
);
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Posts viewable by members" ON public.community_posts FOR SELECT TO authenticated
  USING (public.is_community_member(community_id, auth.uid()));
CREATE POLICY "Members can post" ON public.community_posts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_community_member(community_id, auth.uid()));
CREATE POLICY "Authors delete own posts" ON public.community_posts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Pinned avatars (per community)
CREATE TABLE public.community_pinned_avatars (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null,
  position integer not null default 0,
  pinned_at timestamptz not null default now(),
  unique(community_id, user_id)
);
ALTER TABLE public.community_pinned_avatars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pinned avatars viewable by all authed" ON public.community_pinned_avatars FOR SELECT TO authenticated USING (true);
CREATE POLICY "Members pin own avatar" ON public.community_pinned_avatars FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_community_member(community_id, auth.uid()));
CREATE POLICY "Users unpin own" ON public.community_pinned_avatars FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Trigger: maintain member_count + auto-add owner as leader
CREATE OR REPLACE FUNCTION public.handle_community_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'leader');
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_community_owner_join AFTER INSERT ON public.communities
FOR EACH ROW EXECUTE FUNCTION public.handle_community_created();

CREATE OR REPLACE FUNCTION public.sync_community_member_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.communities SET member_count = member_count + 1, trending_score = trending_score + 1 WHERE id = NEW.community_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.communities SET member_count = GREATEST(0, member_count - 1) WHERE id = OLD.community_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_member_count_ins AFTER INSERT ON public.community_members
FOR EACH ROW EXECUTE FUNCTION public.sync_community_member_count();
CREATE TRIGGER trg_member_count_del AFTER DELETE ON public.community_members
FOR EACH ROW EXECUTE FUNCTION public.sync_community_member_count();
