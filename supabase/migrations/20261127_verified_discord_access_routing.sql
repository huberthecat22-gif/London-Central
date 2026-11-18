create or replace function public.lcfms_get_public_access_state()
returns text language plpgsql stable security definer set search_path=public,auth,pg_temp as $$
declare d text;
begin
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'provider','')<>'discord' then raise exception 'Please verify Discord first.'; end if;
 d:=coalesce(auth.jwt()->'user_metadata'->>'provider_id',auth.jwt()->'user_metadata'->>'sub');
 if d is null or d !~ '^[0-9]{17,20}$' then raise exception 'Could not verify Discord ID.'; end if;
 if not exists(select 1 from public.whitelist_applications where discord_user_id=d and status='approved')
 and not exists(select 1 from public.discord_members where discord_user_id=d and whitelist_status='approved') then return 'whitelist'; end if;
 if d='1562502975199518823' then return 'owner'; end if;
 if d in ('1567646977527779449','1562228232613535776','1562228439874801704','1562228579528351804','1564358768685359295','1568040859583119461') then return 'staff'; end if;
 return 'member';
end; $$;
revoke all on function public.lcfms_get_public_access_state() from public,anon;
grant execute on function public.lcfms_get_public_access_state() to authenticated;

create or replace function public.lcfms_sync_discord_member_profile()
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare d text; nm text; r public.lcfms_role; rn text;
begin
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'provider','')<>'discord' then raise exception 'Please sign in with Discord.'; end if;
 d:=coalesce(auth.jwt()->'user_metadata'->>'provider_id',auth.jwt()->'user_metadata'->>'sub');
 if d is null or d !~ '^[0-9]{17,20}$' then raise exception 'Could not verify Discord ID.'; end if;
 if not exists(select 1 from public.whitelist_applications where discord_user_id=d and status='approved')
 and not exists(select 1 from public.discord_members where discord_user_id=d and whitelist_status='approved') then raise exception 'Your Discord account is not whitelisted.'; end if;
 if d='1562502975199518823' then r:='owner'; rn:='Owner';
 elsif d in ('1567646977527779449','1562228232613535776','1562228439874801704','1562228579528351804','1564358768685359295','1568040859583119461') then r:='staff'; rn:='Staff';
 else r:='player'; rn:='Whitelisted Member'; end if;
 select coalesce((select nullif(discord_display_name,'') from public.discord_members where discord_user_id=d limit 1),
 (select nullif(discord_username,'') from public.discord_members where discord_user_id=d limit 1),
 (select nullif(roblox_username,'') from public.whitelist_applications where discord_user_id=d and status='approved' order by reviewed_at desc nulls last,submitted_at desc limit 1),
 nullif(auth.jwt()->'user_metadata'->>'global_name',''),nullif(auth.jwt()->'user_metadata'->>'name',''),'LCFMS Member') into nm;
 insert into public.profiles(id,display_name,rank_name,role,access_status,discord_user_id) values(auth.uid(),nm,rn,r,'approved',d)
 on conflict(id) do update set display_name=excluded.display_name,rank_name=excluded.rank_name,role=excluded.role,access_status='approved',discord_user_id=excluded.discord_user_id;
end; $$;
revoke all on function public.lcfms_sync_discord_member_profile() from public,anon;
grant execute on function public.lcfms_sync_discord_member_profile() to authenticated;
