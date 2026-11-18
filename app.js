const $ = (s) => document.querySelector(s);
const cfg = window.LCFMS_CONFIG || {};
const configured = typeof cfg.SUPABASE_URL === "string" && cfg.SUPABASE_URL.startsWith("https://") &&
  typeof cfg.SUPABASE_ANON_KEY === "string" && cfg.SUPABASE_ANON_KEY.length > 10;
let supabaseClient = null;
let currentUser = null;
let currentProfileRole = null;
let currentCanReviewWhitelist = false;
let currentAccessState = "unknown";
let staffLoginMode = false;
if (configured && window.supabase) supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

function message(text) { $("#login-message").textContent = text || ""; }
function showPublicView(view) {
  ["public-home","public-whitelist","login"].forEach(id => $("#"+id).classList.toggle("hidden", id !== view));
}
$("#open-whitelist").addEventListener("click",()=>showPublicView("public-whitelist"));
function renderAccessOptions(state){
  currentAccessState=state;
  $("#verify-discord").classList.toggle("hidden",state!=="unknown");
  $("#open-whitelist").classList.toggle("hidden",state!=="whitelist");
  $("#open-signin").classList.toggle("hidden",!["member","staff","owner"].includes(state));
  $("#open-signup").classList.remove("hidden");
  $("#access-message").textContent=state==="whitelist"?"Your Discord account is not yet fully whitelisted. Submit your application here.":state==="member"?"Your whitelist is approved. Sign in to access the FMS.":state==="staff"||state==="owner"?"Your whitelist is approved and your Discord ID is authorised for staff access.":"Verify with the Discord account you use in the London Central server.";
}
async function beginDiscordVerification(){
  if(!supabaseClient){$("#access-message").textContent="Database connection is not configured.";return;}
  const button=$("#verify-discord");button.disabled=true;button.textContent="Connecting to Discord…";
  const {error}=await supabaseClient.auth.signInWithOAuth({provider:"discord",options:{redirectTo:window.location.origin+"/"}});
  if(error){$("#access-message").textContent="Discord verification failed: "+error.message;button.disabled=false;button.textContent="Verify with Discord";}
}
$("#verify-discord").addEventListener("click",beginDiscordVerification);
$("#open-signup").addEventListener("click",()=>{staffLoginMode=true;showPublicView("login");$("#discord-login").classList.add("hidden");$("#staff-email-login").open=true;message("");});
$("#open-signin").addEventListener("click",()=>{staffLoginMode=false;showPublicView("login");$("#discord-login").classList.remove("hidden");$("#staff-email-login").open=false;message("");});
$("#back-login-home").addEventListener("click",()=>{staffLoginMode=false;$("#discord-login").classList.remove("hidden");showPublicView("public-home");});
$("#back-public-home").addEventListener("click",()=>showPublicView("public-home"));
$("#public-whitelist-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const status=$("#public-whitelist-message");
  status.textContent="";
  if(!supabaseClient){status.textContent="Whitelist submissions are temporarily unavailable. Please try again later.";return;}
  const roblox=$("#public-roblox").value.trim();
  const discord=$("#public-discord").value.trim();
  if(!roblox||!discord){status.textContent="Please enter both usernames.";return;}
  if(!/^[a-zA-Z0-9_]{3,20}$/.test(roblox)){status.textContent="Please enter a valid Roblox username.";return;}
  const submit=$("#public-whitelist-form button[type=submit]");
  submit.disabled=true;submit.textContent="Checking…";
  const {data,error}=await supabaseClient.rpc("lcfms_submit_public_whitelist",{
    p_roblox_username:roblox,
    p_discord_contact:discord,
    p_discord_user_id:$("#public-discord-id").value.trim()
  });
  submit.disabled=false;submit.textContent="Submit Whitelist";
  if(error){status.textContent="We couldn't submit your request: "+error.message;return;}
  if(data==="already_whitelisted"){
    status.textContent="You are already whitelisted! You do not need to apply again. Please sign in using your Discord account.";
    return;
  }
  if(data==="already_submitted"){
    status.textContent="An application for this Roblox username or Discord account is already pending. Please wait for staff to review it.";
    return;
  }
  $("#public-whitelist-form").reset();
  status.textContent="Your whitelist request has been submitted. Staff will review it manually.";
});
function showPortal(profile, canReviewWhitelist) {
  const isPlayer = profile.role === "player";
  document.querySelectorAll(".player-hidden").forEach(el => el.classList.toggle("hidden", isPlayer));
  document.querySelectorAll(".owner-only").forEach(el => el.classList.toggle("hidden", profile.role !== "owner"));
  document.querySelectorAll(".reviewer-only").forEach(el => el.classList.toggle("hidden", !canReviewWhitelist));
  $("#page-member-numbers").classList.toggle("hidden", profile.role !== "owner");
  $("#page-staff").classList.toggle("hidden", isPlayer);
  $("#page-whitelist").classList.toggle("hidden", !canReviewWhitelist);
  $("#public-home").classList.add("hidden");
  $("#public-whitelist").classList.add("hidden");
  $("#login").classList.add("hidden");
  $("#portal").classList.remove("hidden");
  $("#hello").textContent = `Welcome, ${profile.display_name || (isPlayer ? "LCFMS member" : "LCFMS staff")}`;
  $("#user-name").textContent = profile.display_name || (isPlayer ? "Whitelisted member" : "Staff member");
  $("#rank-pill").textContent = profile.rank_name || (isPlayer ? "Whitelisted Member" : "Approved staff");
  $("#today").textContent = new Intl.DateTimeFormat("en-GB", { dateStyle: "full" }).format(new Date());
  showPage("dashboard");
  if (canReviewWhitelist) loadWhitelistApplications();
}
function showPage(page) {
  if (page === "whitelist" && !currentCanReviewWhitelist) page = "dashboard";
  if (page === "member-numbers" && currentProfileRole !== "owner") page = "dashboard";
  if (["staff","recruitment"].includes(page) && currentProfileRole === "player") page = "dashboard";
  document.querySelectorAll(".page").forEach(el => el.classList.toggle("active", el.id === `page-${page}`));
  document.querySelectorAll("[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === page && el.classList.contains("nav-link")));
  const active = document.querySelector(`.nav-link[data-page="${page}"]`);
  $("#crumb").textContent = active ? active.textContent.trim() : page;
  $("#sidebar").classList.remove("open");
}
async function loadProfile(user, openPortal = false, staffOnly = false) {
  currentUser = user;
  // For Discord OAuth members, securely provision/refresh their profile from the
  // Discord identity in their verified Supabase session. The RPC checks whitelist status.
  if (user.app_metadata?.provider === "discord") {
    const { error: syncError } = await supabaseClient.rpc("lcfms_sync_discord_member_profile");
    if (syncError) {
      const {data: accessState, error: stateError} = await supabaseClient.rpc("lcfms_get_public_access_state");
      if (!stateError && accessState === "whitelist") {
        currentUser=user; renderAccessOptions("whitelist"); showPublicView("public-home"); return;
      }
      message(stateError ? "We could not verify your Discord access. Please try again." : "Your Discord access could not be confirmed. Contact LCFMS management.");
      return;
    }
  }
  const { data, error } = await supabaseClient.from("profiles")
    .select("display_name,rank_name,role,access_status").eq("id", user.id).single();
  if (error || !data || data.access_status !== "approved") {
    await supabaseClient.auth.signOut();
    message("Your account is awaiting approval or is not authorised. Contact LCFMS management.");
    return;
  }
  const staffRoles = ["owner","senior_management","management","staff"];
  if (staffOnly && !staffRoles.includes(data.role)) {
    await supabaseClient.auth.signOut();
    currentUser = null;
    message("Staff access denied. Your account does not have an authorised LCFMS staff role.");
    return;
  }
  currentProfileRole = data.role;
  const { data: reviewPermission } = await supabaseClient.rpc("lcfms_can_review_whitelist");
  currentCanReviewWhitelist = reviewPermission === true;
  if (!openPortal && user.app_metadata?.provider === "discord") {
    const {data: accessState,error:stateError}=await supabaseClient.rpc("lcfms_get_public_access_state");
    if(stateError){message("Could not verify your access options: "+stateError.message);return;}
    currentUser=user; renderAccessOptions(accessState); showPublicView("public-home"); return;
  }
  showPortal(data, currentCanReviewWhitelist);
  if (data.role === "owner") loadMemberNumbers();
}
const discordLoginButton = $("#discord-login");
if (discordLoginButton) discordLoginButton.addEventListener("click", async () => {
  if (!supabaseClient) { message("Database connection is not configured. Check config.js."); return; }
  discordLoginButton.disabled = true;
  discordLoginButton.textContent = "Connecting to Discord…";
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: window.location.origin + "/" }
  });
  if (error) {
    message("Discord sign-in failed: " + error.message);
    discordLoginButton.disabled = false;
    discordLoginButton.textContent = "Continue with Discord";
  }
});
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); message("");
  if (!supabaseClient) { message("Database connection is not configured. Check config.js."); return; }
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: $("#email").value.trim(), password: $("#password").value
  });
  if (error) { message(error.message); return; }
  await loadProfile(data.user, false, staffLoginMode);
});
document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
$("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#signout").addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  $("#portal").classList.add("hidden"); $("#password").value = ""; showPublicView("public-home");
});
(async () => {
  if (!configured || !window.supabase) { message("Setup required: check the Supabase project URL and publishable key in config.js."); return; }
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    currentUser=data.session.user;
    await loadProfile(data.session.user,false);
    await handleDiscordOAuthCallback(data.session);
  } else {
    renderAccessOptions("unknown");
    await handleDiscordOAuthCallback(null);
  }
})();

function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function loadWhitelistApplications(){
 const host=$("#whitelist-list"); if(!host||!supabaseClient||!currentUser)return;
 host.textContent="Loading whitelist applications…";
 const {data,error}=await supabaseClient.from("whitelist_applications").select("id,discord_user_id,discord_contact,roblox_username,status,submitted_at,review_note,answers").order("submitted_at",{ascending:false}).limit(100);
 if(error){host.textContent="Could not load applications: "+error.message;return;}
 const rows=data||[], n=s=>rows.filter(r=>r.status===s).length;
 $("#whitelist-pending-count").textContent=n("pending");$("#whitelist-approved-count").textContent=n("approved");$("#whitelist-rejected-count").textContent=n("rejected");
 if(!rows.length){host.textContent="No whitelist applications have been submitted yet.";return;}
 host.innerHTML=rows.map(r=>{
 const date=r.submitted_at?new Date(r.submitted_at).toLocaleString("en-GB"):"Date unavailable";
 const answers=r.answers&&typeof r.answers==="object"?Object.entries(r.answers).map(([k,v])=>"<div><b>"+esc(k)+":</b> "+esc(v)+"</div>").join(""):"";
 const actions=r.status==="pending"?'<div class="whitelist-actions"><button class="primary" data-review="approved" data-id="'+esc(r.id)+'">Approve</button><button class="review-reject" data-review="rejected" data-id="'+esc(r.id)+'">Reject</button></div>':"";
 return '<article class="whitelist-card"><div class="whitelist-top"><div><h3>'+esc(r.roblox_username)+'</h3><small>Discord: '+esc(r.discord_contact||r.discord_user_id||"Not supplied")+' · '+esc(date)+'</small></div><span class="whitelist-status status-'+esc(r.status)+'">'+esc(r.status)+'</span></div>'+(answers?'<div class="whitelist-answers">'+answers+'</div>':"")+(r.review_note?'<p class="review-note">Review note: '+esc(r.review_note)+'</p>':"")+actions+'</article>';
 }).join("");
 host.querySelectorAll("[data-review]").forEach(btn=>btn.addEventListener("click",async()=>{
 const decision=btn.dataset.review, note=window.prompt(decision==="approved"?"Optional approval note:":"Reason for rejection:");if(note===null)return;btn.disabled=true;
 const {error:e}=await supabaseClient.from("whitelist_applications").update({status:decision,reviewed_by:currentUser.id,reviewed_at:new Date().toISOString(),review_note:note.trim()||null}).eq("id",btn.dataset.id).eq("status","pending");
 if(e){window.alert("Could not save review: "+e.message);btn.disabled=false;return;}
 const row=rows.find(x=>x.id===btn.dataset.id);
 if(row?.discord_user_id){const {error:me}=await supabaseClient.from("discord_members").update({whitelist_status:decision,updated_at:new Date().toISOString()}).eq("discord_user_id",row.discord_user_id);if(me)window.alert("Decision saved; member status update failed: "+me.message);}
 await loadWhitelistApplications();
 }));
}
const refreshWhitelist=$("#refresh-whitelist");if(refreshWhitelist)refreshWhitelist.addEventListener("click",loadWhitelistApplications);

async function loadMemberNumbers(){
 const host=$("#member-number-list");
 if(!host||!supabaseClient||currentProfileRole!=="owner")return;
 host.textContent="Loading member records…";
 const {data,error}=await supabaseClient.from("discord_members")
  .select("discord_user_id,discord_username,discord_display_name,member_number")
  .order("member_number",{ascending:true});
 if(error){host.textContent="Could not load member records: "+error.message;return;}
 if(!data?.length){host.textContent="No member numbers have been assigned yet.";return;}
 host.innerHTML='<div class="member-number-table">'+data.map(m=>'<div class="member-number-row"><div><b>'+esc(m.discord_display_name||m.discord_username||"Discord member")+'</b><small>'+esc(m.discord_username||"")+' · '+esc(m.discord_user_id)+'</small></div><label>Member number<input class="member-number-input" data-member-id="'+esc(m.discord_user_id)+'" maxlength="12" value="'+esc(m.member_number)+'" autocomplete="off" pattern="[A-Za-z0-9]{1,12}"></label><button class="primary" data-save-member-number="'+esc(m.discord_user_id)+'" type="button">Save</button></div>').join("")+'</div>';
 host.querySelectorAll("[data-save-member-number]").forEach(button=>button.addEventListener("click",async()=>{
  const id=button.dataset.saveMemberNumber;
  const input=host.querySelector('.member-number-input[data-member-id="'+CSS.escape(id)+'"]');
  const value=(input?.value||"").trim().toUpperCase();
  if(!/^[A-Z0-9]{1,12}$/.test(value)){window.alert("Use 1 to 12 letters or numbers, with no spaces or symbols.");return;}
  button.disabled=true;button.textContent="Saving…";
  const {error:saveError}=await supabaseClient.rpc("lcfms_owner_set_member_number",{p_discord_user_id:id,p_new_member_number:value});
  if(saveError){window.alert("Could not change member number: "+saveError.message);button.disabled=false;button.textContent="Save";return;}
  button.textContent="Saved";
  await loadMemberNumbers();
 }));
}
const refreshMemberNumbers=$("#refresh-member-numbers");
if(refreshMemberNumbers)refreshMemberNumbers.addEventListener("click",loadMemberNumbers);


const linkDiscordButton=$("#link-discord-reviewer");
async function startDiscordReviewerLink(){
 if(!supabaseClient||!currentUser){window.alert("Please sign in to LCFMS first.");return;}
 const {data}=await supabaseClient.auth.getSession();
 if(!data.session){window.alert("Your LCFMS session has expired. Please sign in again.");return;}
 if(linkDiscordButton){linkDiscordButton.disabled=true;linkDiscordButton.textContent="Opening Discord…";}
 try{
  const response=await fetch("/api/discord/link",{
   method:"POST",
   headers:{"Content-Type":"application/json","Authorization":"Bearer "+data.session.access_token},
   body:JSON.stringify({action:"state"})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.state||!result.client_id||!result.redirect_uri)throw new Error(result.error||"Discord connection is not configured yet.");
  const params=new URLSearchParams({
   client_id:result.client_id,
   redirect_uri:result.redirect_uri,
   response_type:"code",
   scope:"identify guilds.members.read",
   state:result.state
  });
  window.location.href="https://discord.com/oauth2/authorize?"+params.toString();
 }catch(error){
  window.alert(error.message);
  if(linkDiscordButton){linkDiscordButton.disabled=false;linkDiscordButton.textContent="Connect Discord";}
 }
}
if(linkDiscordButton) linkDiscordButton.addEventListener("click",startDiscordReviewerLink);

async function handleDiscordOAuthCallback(session){
 const params=new URLSearchParams(window.location.search);
 const code=params.get("code"), returnedState=params.get("state"), oauthError=params.get("error");
 // Supabase handles Discord sign-in callback codes itself. Only handle the
 // separate, signed state used by the reviewer-account linking flow.
 if(!returnedState)return;
 if(!code&&!oauthError)return;
 const cleanUrl=window.location.origin+window.location.pathname;
 if(oauthError){
  window.history.replaceState({},document.title,cleanUrl);
  window.alert("Discord connection was cancelled or denied.");
  return;
 }
 if(!returnedState){
  window.history.replaceState({},document.title,cleanUrl);
  window.alert("Discord connection could not be verified. Please try again.");
  return;
 }
 window.history.replaceState({},document.title,cleanUrl);
 if(!session?.access_token){window.alert("Please sign in to LCFMS, then connect Discord again.");return;}
 if(linkDiscordButton){linkDiscordButton.disabled=true;linkDiscordButton.textContent="Connecting…";}
 try{
  const response=await fetch("/api/discord/link",{
   method:"POST",
   headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token},
   body:JSON.stringify({action:"link",code,state:returnedState})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||"Discord connection failed.");
  window.alert("Discord connected. Your reviewer access will activate when the bot completes its next role sync.");
  await loadWhitelistApplications();
 }catch(error){window.alert(error.message);}
 finally{if(linkDiscordButton){linkDiscordButton.disabled=false;linkDiscordButton.textContent="Connect Discord";}}
}
