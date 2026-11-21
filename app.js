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
  const button=$("#verify-discord"), status=$("#access-message");
  try {
    if(!supabaseClient){status.textContent="Connection unavailable: Supabase configuration or library is missing. Please contact LCFMS management.";return;}
    button.disabled=true;button.textContent="Connecting to Discord…";
    status.textContent="Opening Discord authorisation…";
    const {data,error}=await supabaseClient.auth.signInWithOAuth({
      provider:"discord",
      options:{redirectTo:window.location.origin+window.location.pathname,skipBrowserRedirect:false}
    });
    if(error) throw error;
    if(data?.url) window.location.assign(data.url);
    else {status.textContent="Discord sign-in could not start. Check the Discord provider settings in Supabase.";button.disabled=false;button.textContent="Verify with Discord";}
  } catch(error) {
    console.error("LCFMS Discord verification error:",error);
    status.textContent="Discord verification could not start: "+(error?.message||"Unknown error")+". Please try again or contact management.";
    button.disabled=false;button.textContent="Verify with Discord";
  }
}
window.beginDiscordVerification=beginDiscordVerification;
const verifyButton=$("#verify-discord");
if(verifyButton){
 verifyButton.addEventListener("click",beginDiscordVerification);
 verifyButton.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();beginDiscordVerification();}});
}
$("#open-signup").addEventListener("click",()=>{staffLoginMode=true;showPublicView("login");$("#discord-login").classList.add("hidden");$("#staff-email-login").open=true;message("");});
$("#open-signin").addEventListener("click",async()=>{
  staffLoginMode=false;
  $("#staff-email-login").open=false;
  message("");
  if(!supabaseClient){showPublicView("login");return;}
  const {data:{session}}=await supabaseClient.auth.getSession();
  const signedInUser=session?.user||currentUser;
  if(signedInUser?.app_metadata?.provider==="discord"){
    await loadProfile(signedInUser,true,false);
    return;
  }
  showPublicView("login");
  $("#discord-login").classList.remove("hidden");
});
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
  setupTrainingNoticeAccess();
  document.querySelectorAll(".fms-add").forEach(el=>el.classList.toggle("hidden",!fmsCanManage()));
  showPage("dashboard");
  if (canReviewWhitelist) loadWhitelistApplications();
  if (["owner","senior_management","management","staff"].includes(profile.role)) loadStaffPlayers();
}
async function showPage(page) {
  if (page === "whitelist" && !currentCanReviewWhitelist) page = "dashboard";
  if (page === "member-numbers" && currentProfileRole !== "owner") page = "dashboard";
  if (page === "staff" && !["owner","senior_management","management","staff"].includes(currentProfileRole)) page = "dashboard";
  if (page === "staff" && currentProfileRole === "player") page = "dashboard";
  document.querySelectorAll(".page").forEach(el => el.classList.toggle("active", el.id === `page-${page}`));
  document.querySelectorAll("[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === page && el.classList.contains("nav-link")));
  const active = document.querySelector(`.nav-link[data-page="${page}"]`);
  $("#crumb").textContent = active ? active.textContent.trim() : page;
  $("#sidebar").classList.remove("open");
  if(page==="training"){await setupTrainingNoticeAccess();loadTrainingNotices();}
  if(page==="recruitment"){setupRecruitmentAccess();loadRecruitmentOpportunities();loadMyRecruitmentApplications();}
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

async function loadStaffPlayers(){
 const host=$("#staff-player-list");
 if(!host||!supabaseClient||!["owner","senior_management","management","staff"].includes(currentProfileRole))return;
 host.textContent="Loading player accounts…";
 const {data,error}=await supabaseClient.rpc("lcfms_staff_list_players");
 if(error){host.textContent="Could not load players: "+error.message;return;}
 if(!data?.length){host.textContent="No registered player accounts found.";return;}
 host.classList.remove("empty-state");
 host.innerHTML='<div class="member-number-table">'+data.map(p=>'<div class="member-number-row staff-player-row"><div><b>'+esc(p.display_name||"FMS Player")+'</b><small>'+esc(p.roblox_username||"Roblox name not recorded")+' · '+esc(p.discord_user_id||"Discord ID unavailable")+'</small><small>Status: '+esc(p.access_status||"unknown")+'</small></div><label>FMS display name<input class="staff-player-name" data-player-id="'+esc(p.id)+'" maxlength="60" value="'+esc(p.display_name||"")+'" autocomplete="off"></label><div class="staff-player-actions"><button class="primary" type="button" data-save-player="'+esc(p.id)+'">Save name</button><button class="review-reject" type="button" data-kick-player="'+esc(p.id)+'">Kick from FMS</button></div></div>').join("")+'</div>';
 host.querySelectorAll("[data-save-player]").forEach(button=>button.addEventListener("click",async()=>{
  const id=button.dataset.savePlayer,input=host.querySelector('.staff-player-name[data-player-id="'+CSS.escape(id)+'"]'),name=(input?.value||"").trim();
  if(!name||name.length>60){window.alert("Enter a name between 1 and 60 characters.");return;}
  button.disabled=true;button.textContent="Saving…";
  const {error:saveError}=await supabaseClient.rpc("lcfms_staff_update_player_name",{p_player_id:id,p_display_name:name});
  if(saveError){window.alert("Could not update player name: "+saveError.message);button.disabled=false;button.textContent="Save name";return;}
  await loadStaffPlayers();
 }));
 host.querySelectorAll("[data-kick-player]").forEach(button=>button.addEventListener("click",async()=>{
  const id=button.dataset.kickPlayer;
  if(!window.confirm("Kick this player from LCFMS? Their approved whitelist access will be revoked and they must submit a new whitelist application to return."))return;
  button.disabled=true;button.textContent="Kicking…";
  const {error:kickError}=await supabaseClient.rpc("lcfms_staff_kick_player",{p_player_id:id});
  if(kickError){window.alert("Could not kick player: "+kickError.message);button.disabled=false;button.textContent="Kick from FMS";return;}
  await loadStaffPlayers();
 }));
}
const refreshStaffPlayers=$("#refresh-staff-players");
if(refreshStaffPlayers)refreshStaffPlayers.addEventListener("click",loadStaffPlayers);

let trainingNoticeRoleAccess=false;
function signedInDiscordId(){
 const u=currentUser||{};
 const discordIdentity=(u.identities||[]).find(identity=>identity.provider==="discord");
 const identityData=discordIdentity?.identity_data||{};
 return String(
  u.app_metadata?.provider_id||
  u.user_metadata?.provider_id||
  identityData.sub||
  identityData.id||
  u.user_metadata?.sub||
  u.user_metadata?.id||
  ""
 );
}
function canCreateTrainingNotice(){return trainingNoticeRoleAccess || ["owner","senior_management","management","staff"].includes(currentProfileRole);}
async function setupTrainingNoticeAccess(){
 const discordId=signedInDiscordId();
 trainingNoticeRoleAccess=false;
 if(discordId&&supabaseClient){
  const {data,error}=await supabaseClient.from("discord_training_notice_creators").select("discord_user_id").eq("discord_user_id",discordId).limit(1);
  if(error)console.error("Training role access check failed:",error.message);
  trainingNoticeRoleAccess=!!data?.length;
 }
 const button=$("#create-training-notice");
 if(button)button.classList.toggle("hidden",!canCreateTrainingNotice());
}
async function loadTrainingNotices(){
 const host=$("#training-list");if(!host||!supabaseClient)return;
 host.textContent="Loading training notices…";
 const {data,error}=await supabaseClient.from("training_notices").select("id,module_name,training_date,training_time,prerequisites,maximum_trainees,trainers,observers,observers_na,location,created_at").order("training_date",{ascending:true}).order("training_time",{ascending:true});
 if(error){host.textContent="Could not load training notices: "+error.message;return;}
 if(!data?.length){host.textContent="No training notices have been published yet.";return;}
 host.classList.remove("empty-state");
 host.innerHTML=data.map(n=>'<article class="training-notice-card"><div class="training-notice-title"><span>TRAINING NOTICE</span><h3>'+esc(n.module_name)+'</h3></div><div class="training-notice-details">'+[
 ["Date",n.training_date?new Date(n.training_date+"T00:00:00").toLocaleDateString("en-GB"):"—"],
 ["Time",n.training_time||"—"],
 ["Prerequisites",n.prerequisites||"None stated"],
 ["Maximum trainees",n.maximum_trainees],
 ["Trainer(s)",n.trainers],
 ["Observer(s)",n.observers_na?"N/A":(n.observers||"Not specified")],
 ["Location for training",n.location||"Waiting Room"]
 ].map(([k,v])=>'<div class="training-detail"><b>'+esc(k)+':</b><span>'+esc(v)+'</span></div>').join("")+'</div>'+(canCreateTrainingNotice()?'<div class="training-notice-footer"><button class="review-reject" type="button" data-delete-training="'+esc(n.id)+'">Delete notice</button></div>':"")+'</article>').join("");
 host.querySelectorAll("[data-delete-training]").forEach(btn=>btn.addEventListener("click",async()=>{
  if(!canCreateTrainingNotice()||!window.confirm("Delete this training notice?"))return;
  btn.disabled=true;
  const {error:delError}=await supabaseClient.from("training_notices").delete().eq("id",btn.dataset.deleteTraining);
  if(delError){window.alert("Could not delete notice: "+delError.message);btn.disabled=false;return;}
  await loadTrainingNotices();
 }));
}
const createTrainingButton=$("#create-training-notice");
if(createTrainingButton)createTrainingButton.addEventListener("click",async()=>{
 await setupTrainingNoticeAccess();
 if(!canCreateTrainingNotice())return;
 $("#training-notice-form").classList.toggle("hidden");
});
const cancelTrainingButton=$("#cancel-training-notice");
if(cancelTrainingButton)cancelTrainingButton.addEventListener("click",()=>{$("#training-notice-form").classList.add("hidden");$("#training-notice-form").reset();$("#training-notice-form").elements.location.value="Waiting Room";});
const trainingForm=$("#training-notice-form");
if(trainingForm)trainingForm.addEventListener("submit",async event=>{
 event.preventDefault();
 const status=$("#training-form-message");
 await setupTrainingNoticeAccess();
 if(!canCreateTrainingNotice()){status.textContent="You are not authorised to publish training notices.";return;}
 if(!supabaseClient){status.textContent="Database connection is unavailable.";return;}
 const form=new FormData(trainingForm);
 const observersNA=form.get("observers_na")==="on";
 const payload={
  module_name:String(form.get("module")||"").trim(),
  training_date:String(form.get("date")||""),
  training_time:String(form.get("time")||""),
  prerequisites:String(form.get("prerequisites")||"").trim()||"None",
  maximum_trainees:Number(form.get("maximum")),
  trainers:String(form.get("trainers")||"").trim(),
  observers:String(form.get("observers")||"").trim(),
  observers_na:observersNA,
  location:String(form.get("location")||"Waiting Room").trim()||"Waiting Room",
  created_by:currentUser.id
 };
 if(observersNA)payload.observers="";
 const submit=trainingForm.querySelector('button[type="submit"]');
 submit.disabled=true;submit.textContent="Publishing…";status.textContent="";
 const {error}=await supabaseClient.from("training_notices").insert(payload);
 submit.disabled=false;submit.textContent="Publish training notice";
 if(error){status.textContent="Could not publish notice: "+error.message;return;}
 trainingForm.reset();trainingForm.elements.location.value="Waiting Room";trainingForm.classList.add("hidden");
 await loadTrainingNotices();
});
const refreshTraining=$("#refresh-training");
if(refreshTraining)refreshTraining.addEventListener("click",loadTrainingNotices);


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


/* LCFMS operational records workbench. Data is stored in Supabase and protected by RLS. */
const FMS_MODULES={
 cad:{title:"CAD incident",fields:[["title","Incident summary"],["reference","Incident / call reference"],["status","Status","New|Assigned|En route|On scene|Resolved|Closed"],["details","Location, caller details, priority, units and actions"]]},
 mdt:{title:"MDT log",fields:[["title","Officer / unit / activity"],["reference","Callsign / incident reference"],["status","Unit status","Available|En route|On scene|Busy|Off duty"],["details","Operational update and notes"]]},
 pnc:{title:"PNC record",fields:[["title","Person / vehicle / record subject"],["reference","Record reference / registration"],["status","Record status","Information|Wanted|Warning|Located|Archived"],["details","Record details, grounds and review notes"]]},
 custody:{title:"Custody record",fields:[["title","Detainee / subject"],["reference","Custody reference"],["status","Status","Booked in|In custody|Released|Transferred"],["details","Booking notes, grounds and outcome"]]},
 hr:{title:"Personnel record",fields:[["title","Member / subject"],["reference","Record reference"],["status","Status","Open|Under review|Approved|Rejected|Closed"],["details","Details and management decision"]]},
 fleet:{title:"Fleet record",fields:[["title","Vehicle / callsign"],["reference","Registration / fleet ID"],["status","Status","Available|Assigned|Under repair|Out of service"],["details","Allocation, defects or maintenance notes"]]},
 forms:{title:"Administrative form",fields:[["title","Request / form type"],["reference","Submitted by / reference"],["status","Status","Submitted|Under review|Approved|Rejected|Completed"],["details","Request details and decision"]]},
 notifications:{title:"Force notification",fields:[["title","Notification title"],["reference","Category / reference"],["status","Status","Active|Acknowledged|Archived"],["details","Notification message"]]}
};
const fmsRecords={};
function fmsCanManage(){return ["owner","senior_management","management","staff"].includes(currentProfileRole);}
function fmsEscape(v){return esc(v);}
async function loadFmsRecords(module){
 const host=$("#records-"+module);if(!host||!supabaseClient)return;
 host.textContent="Loading records…";
 const {data,error}=await supabaseClient.from("fms_records").select("id,module,title,reference,status,details,created_at,created_by").eq("module",module).order("created_at",{ascending:false}).limit(150);
 if(error){host.textContent="Could not load records: "+error.message;return;}
 fmsRecords[module]=data||[];renderFmsRecords(module);
}
function renderFmsRecords(module){
 const host=$("#records-"+module);if(!host)return;
 const query=($('[data-search="'+module+'"]')?.value||"").toLowerCase();
 const status=$('[data-filter="'+module+'"]')?.value||"";
 const rows=(fmsRecords[module]||[]).filter(r=>(!status||r.status===status)&&[r.title,r.reference,r.details,r.status].join(" ").toLowerCase().includes(query));
 if(!rows.length){host.innerHTML='<div class="fms-empty">No matching records. Use the create button to add the first record.</div>';return;}
 host.innerHTML=rows.map(r=>'<article class="fms-record"><div class="fms-record-top"><div><span class="fms-kicker">'+fmsEscape(module.toUpperCase())+' / '+fmsEscape(r.reference||"NO REFERENCE")+'</span><h3>'+fmsEscape(r.title)+'</h3></div><span class="fms-status">'+fmsEscape(r.status)+'</span></div><p>'+fmsEscape(r.details||"No additional details.")+'</p><div class="fms-record-foot"><small>'+new Date(r.created_at).toLocaleString("en-GB")+'</small>'+(fmsCanManage()?'<button class="secondary fms-update" data-id="'+fmsEscape(r.id)+'" data-module="'+module+'">Update status</button>':"")+'</div></article>').join("");
 host.querySelectorAll(".fms-update").forEach(btn=>btn.addEventListener("click",async()=>{
  const row=(fmsRecords[module]||[]).find(x=>x.id===btn.dataset.id);if(!row||!fmsCanManage())return;
  const options=FMS_MODULES[module].fields.find(x=>x[0]==="status")[2].split("|");
  const next=window.prompt("Enter status: "+options.join(", "),row.status);if(next===null)return;
  if(!options.includes(next)){window.alert("Choose one of: "+options.join(", "));return;}
  btn.disabled=true;
  const {error}=await supabaseClient.from("fms_records").update({status:next,updated_at:new Date().toISOString()}).eq("id",row.id);
  if(error){window.alert("Could not update record: "+error.message);btn.disabled=false;return;}
  await loadFmsRecords(module);
 }));
}
function openFmsRecordForm(module){
 if(!fmsCanManage()){window.alert("Only authorised staff can create or update these records.");return;}
 const def=FMS_MODULES[module];if(!def)return;
 const values={};
 for(const field of def.fields){
  let value=window.prompt(field[1]+(field[2]?" ("+field[2].split("|").join(" / ")+")":""),field[0]==="status" ? field[2].split("|")[0] : "");
  if(value===null)return;
  if(field[2]&&!field[2].split("|").includes(value)){window.alert("Invalid status. Use: "+field[2].split("|").join(", "));return;}
  values[field[0]]=value.trim();
 }
 if(!values.title){window.alert("A title is required.");return;}
 supabaseClient.from("fms_records").insert({...values,module,created_by:currentUser.id}).then(async({error})=>{
  if(error){window.alert("Could not save record: "+error.message);return;}
  await loadFmsRecords(module);
 });
}
document.querySelectorAll(".fms-add").forEach(btn=>btn.addEventListener("click",()=>openFmsRecordForm(btn.dataset.module)));
document.querySelectorAll(".fms-search").forEach(input=>input.addEventListener("input",()=>renderFmsRecords(input.dataset.search)));
document.querySelectorAll(".fms-filter").forEach(input=>input.addEventListener("change",()=>renderFmsRecords(input.dataset.filter)));
const fmsOriginalShowPage=showPage;
showPage=function(page){fmsOriginalShowPage(page);if(FMS_MODULES[page])loadFmsRecords(page);};


const RECRUITMENT_ROLE_IDS=["1562229509791678514","1562519700028657845","1568036085601411083","1568036518709305444","1568036745994444831","1562524241935474789","1562244907119280128","1562244660863180974","1562229847806189578","1568036958779736124","1568037032721383544","1568037096789123173","1568037156851556392","1562519805968252998","1562520367094964224","1562520546984591450","1568037960304173217","1568038069800665239","1568038554406486087","1568038490451611648","1568038612115783730","1568038675181346837","1568038735730184243","1568038833000423444","1568038876495347854","1568038914722365470","1568038975204233287"];
let recruitmentCanCreate=false,recruitmentRows=[],recruitmentStatus="Open",recruitmentPage=1,recruitmentQuestions=1;
function recruitmentDiscordId(){const i=(currentUser?.identities||[]).find(x=>x.provider==="discord");return i?.identity_data?.provider_id||i?.identity_data?.sub||i?.id||currentUser?.user_metadata?.provider_id||currentUser?.user_metadata?.sub||null;}
async function setupRecruitmentAccess(){recruitmentCanCreate=false;if(supabaseClient&&currentUser){const {data,error}=await supabaseClient.rpc("lcfms_can_manage_recruitment");if(error)console.error("Recruitment permission check:",error.message);recruitmentCanCreate=data===true;}$("#make-recruitment")?.classList.toggle("hidden",!recruitmentCanCreate);return recruitmentCanCreate;}
function recruitmentDate(v){return v?new Date(v).toLocaleString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}):"—";}
async function loadRecruitmentOpportunities(){const host=$("#recruitment-list");if(!host||!supabaseClient)return;host.innerHTML='<tr><td colspan="5">Loading…</td></tr>';const {data,error}=await supabaseClient.from("recruitment_opportunities").select("id,title,creator_name,opens_at,closes_at,prerequisites,description,questions").order("id",{ascending:false});if(error){host.innerHTML='<tr><td colspan="5">Could not load opportunities: '+esc(error.message)+'</td></tr>';return;}const now=Date.now();recruitmentRows=(data||[]).filter(x=>recruitmentStatus==="Open"?(new Date(x.opens_at).getTime()<=now&&new Date(x.closes_at).getTime()>=now):(new Date(x.closes_at).getTime()<now||new Date(x.opens_at).getTime()>now));renderRecruitmentTable();}
function renderRecruitmentTable(){const host=$("#recruitment-list");if(!host)return;const q=$("#recruitment-search")?.value.toLowerCase()||"",rows=recruitmentRows.filter(x=>(x.title+" "+x.creator_name+" "+x.id).toLowerCase().includes(q)),size=Number($("#recruitment-page-size")?.value||10),pages=Math.max(1,Math.ceil(rows.length/size));recruitmentPage=Math.min(recruitmentPage,pages);const start=(recruitmentPage-1)*size,shown=rows.slice(start,start+size);host.innerHTML=shown.length?shown.map(x=>'<tr><td><button class="recruitment-view" data-recruitment-view="'+x.id+'">▣</button></td><td>'+x.id+'</td><td>'+esc(x.title)+'</td><td>'+esc(x.creator_name)+'</td><td>'+recruitmentDate(x.closes_at)+'</td></tr>').join(""):'<tr><td colspan="5">No '+recruitmentStatus.toLowerCase()+' opportunities found.</td></tr>';host.querySelectorAll("[data-recruitment-view]").forEach(b=>b.addEventListener("click",()=>openRecruitmentDetail(b.dataset.recruitmentView)));$("#recruitment-count").textContent=rows.length?'Showing '+(start+1)+' to '+Math.min(start+size,rows.length)+' of '+rows.length+' entries':"Showing 0 entries";$("#recruitment-pages").innerHTML=Array.from({length:pages},(_,i)=>'<button class="secondary '+(i+1===recruitmentPage?'active':'')+'" data-recruitment-page="'+(i+1)+'">'+(i+1)+'</button>').join("");$("#recruitment-pages").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{recruitmentPage=Number(b.dataset.recruitmentPage);renderRecruitmentTable();}));}
async function openRecruitmentDetail(id){const {data:item,error}=await supabaseClient.from("recruitment_opportunities").select("*").eq("id",id).single();if(error||!item)return;const host=$("#recruitment-detail"),open=new Date(item.opens_at)<=new Date()&&new Date(item.closes_at)>=new Date();host.innerHTML='<div class="recruitment-detail-head"><h2>Career '+item.id+' details</h2><button class="secondary" id="close-recruitment-detail">Back to opportunities</button></div><div class="recruitment-meta"><div><b>Title</b><span>'+esc(item.title)+'</span></div><div><b>Creator</b><span>'+esc(item.creator_name)+'</span></div><div><b>Deadline</b><span>'+recruitmentDate(item.closes_at)+' ('+(open?'Open':'Closed')+')</span></div></div><div class="recruitment-copy"><h3>Prerequisites</h3><div>'+esc(item.prerequisites).replace(/\n/g,"<br>")+'</div></div><div class="recruitment-copy"><h3>Description</h3><div>'+esc(item.description).replace(/\n/g,"<br>")+'</div></div>'+(open?'<form id="recruitment-apply-form" class="recruitment-apply"><h3>Application form</h3>'+item.questions.map((q,i)=>'<label>'+esc(q)+'<textarea name="answer_'+i+'" required maxlength="2000"></textarea></label>').join("")+'<button class="primary" type="submit">Submit application</button><p id="recruitment-apply-message" class="form-message"></p></form>':'<p class="form-message">This opportunity is not currently accepting applications.</p>')+(recruitmentCanCreate?'<div class="recruitment-admin-actions"><button class="secondary" id="recruitment-close-opportunity">Close opportunity</button><button class="review-reject" id="recruitment-delete-opportunity">Delete opportunity</button><button class="secondary" id="recruitment-view-applicants">View applications</button></div><div id="recruitment-applicants"></div>':'');host.classList.remove("hidden");host.scrollIntoView({behavior:"smooth",block:"start"});$("#close-recruitment-detail").onclick=()=>host.classList.add("hidden");$("#recruitment-apply-form")?.addEventListener("submit",async e=>{e.preventDefault();const f=e.currentTarget,answers={};item.questions.forEach((q,i)=>answers[q]=f.elements["answer_"+i].value.trim());const {error}=await supabaseClient.from("recruitment_applications").insert({opportunity_id:item.id,applicant_id:currentUser.id,applicant_name:currentUser.user_metadata?.full_name||currentUser.user_metadata?.name||"Member",answers});$("#recruitment-apply-message").textContent=error?"Application failed: "+error.message:"Application submitted successfully.";if(!error){f.reset();loadMyRecruitmentApplications();}});$("#recruitment-close-opportunity")?.addEventListener("click",async()=>{if(!recruitmentCanCreate)return;const {error}=await supabaseClient.from("recruitment_opportunities").update({closes_at:new Date().toISOString()}).eq("id",item.id);if(error)alert(error.message);else{host.classList.add("hidden");loadRecruitmentOpportunities();}});$("#recruitment-delete-opportunity")?.addEventListener("click",async()=>{if(!recruitmentCanCreate||!confirm("Delete this opportunity and its applications?"))return;const {error}=await supabaseClient.from("recruitment_opportunities").delete().eq("id",item.id);if(error)alert(error.message);else{host.classList.add("hidden");loadRecruitmentOpportunities();}});$("#recruitment-view-applicants")?.addEventListener("click",()=>loadRecruitmentApplicants(item.id));}
async function loadMyRecruitmentApplications(){const host=$("#recruitment-my-list");if(!host||!supabaseClient||!currentUser)return;const {data,error}=await supabaseClient.from("recruitment_applications").select("id,status,submitted_at,answers,recruitment_opportunities(title)").eq("applicant_id",currentUser.id).order("submitted_at",{ascending:false});if(error){host.textContent="Could not load your applications: "+error.message;return;}host.innerHTML=data?.length?data.map(x=>'<div class="recruitment-my-row"><b>'+esc(x.recruitment_opportunities?.title||"Opportunity")+'</b><span>'+esc(x.status)+'</span><small>'+recruitmentDate(x.submitted_at)+'</small></div>').join(""):"You have not submitted any applications yet.";}
async function loadRecruitmentApplicants(id){const host=$("#recruitment-applicants");if(!host||!recruitmentCanCreate)return;const {data,error}=await supabaseClient.from("recruitment_applications").select("*").eq("opportunity_id",id).order("submitted_at",{ascending:false});if(error){host.textContent=error.message;return;}host.innerHTML='<h3>Applications ('+(data?.length||0)+')</h3>'+(data||[]).map(a=>'<article class="recruitment-applicant"><b>'+esc(a.applicant_name)+'</b><span>'+esc(a.status)+'</span>'+Object.entries(a.answers||{}).map(([q,v])=>'<p><strong>'+esc(q)+'</strong><br>'+esc(v)+'</p>').join("")+'<select data-application-status="'+a.id+'"><option>Submitted</option><option>Under review</option><option>Accepted</option><option>Rejected</option></select></article>').join("");host.querySelectorAll("[data-application-status]").forEach(sel=>{const a=data.find(x=>x.id===sel.dataset.applicationStatus);sel.value=a.status;sel.addEventListener("change",async()=>{const {error}=await supabaseClient.from("recruitment_applications").update({status:sel.value}).eq("id",a.id);if(error)alert(error.message);});});}
$("#make-recruitment")?.addEventListener("click",async()=>{await setupRecruitmentAccess();if(recruitmentCanCreate)$("#recruitment-create-form").classList.remove("hidden");});
$("#cancel-recruitment")?.addEventListener("click",()=>{$("#recruitment-create-form").classList.add("hidden");$("#recruitment-create-form").reset();});
$("#add-recruitment-question")?.addEventListener("click",()=>{if(recruitmentQuestions>=8)return;recruitmentQuestions++;const label=document.createElement("label");label.textContent="Question "+recruitmentQuestions;const input=document.createElement("input");input.name="question";input.required=true;input.maxLength=300;input.placeholder="Enter application question";label.append(input);$("#recruitment-question-list").append(label);$("#recruitment-question-count").textContent=recruitmentQuestions+" / 8";if(recruitmentQuestions===8)$("#add-recruitment-question").disabled=true;});
$("#recruitment-create-form")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,msg=$("#recruitment-create-message");await setupRecruitmentAccess();if(!recruitmentCanCreate){msg.textContent="You are not authorised to create recruitment opportunities.";return;}const f=new FormData(form),questions=[...form.querySelectorAll('input[name="question"]')].map(x=>x.value.trim()).filter(Boolean),opens=new Date(f.get("opens_at")),closes=new Date(f.get("closes_at")),prereq=String(f.get("prerequisites")).trim(),description=String(f.get("description")).trim();if(closes<=opens||prereq.length<30||prereq.length>1000||description.length<500||description.length>1000||questions.length<1||questions.length>8){msg.textContent="Check dates, prerequisites (30–1000), description (500–1000) and 1–8 questions.";return;}const btn=form.querySelector('[type="submit"]');btn.disabled=true;const {error}=await supabaseClient.from("recruitment_opportunities").insert({title:String(f.get("title")).trim(),opens_at:opens.toISOString(),closes_at:closes.toISOString(),prerequisites:prereq,description,questions,creator_name:currentUser.user_metadata?.full_name||currentUser.user_metadata?.name||"LCFMS Staff",created_by:currentUser.id});btn.disabled=false;if(error){msg.textContent="Could not publish: "+error.message;return;}form.reset();recruitmentQuestions=1;$("#recruitment-question-list").innerHTML='<label>Question 1<input name="question" required maxlength="300"></label>';$("#recruitment-question-count").textContent="1 / 8";$("#add-recruitment-question").disabled=false;form.classList.add("hidden");await loadRecruitmentOpportunities();});
document.querySelectorAll("[data-recruitment-status]").forEach(b=>b.addEventListener("click",()=>{recruitmentStatus=b.dataset.recruitmentStatus;recruitmentPage=1;document.querySelectorAll("[data-recruitment-status]").forEach(x=>x.classList.toggle("active",x===b));loadRecruitmentOpportunities();}));
$("#recruitment-search")?.addEventListener("input",()=>{recruitmentPage=1;renderRecruitmentTable();});$("#recruitment-page-size")?.addEventListener("change",()=>{recruitmentPage=1;renderRecruitmentTable();});
