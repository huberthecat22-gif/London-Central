const $ = (s) => document.querySelector(s);
const cfg = window.LCFMS_CONFIG || {};
const configured = typeof cfg.SUPABASE_URL === "string" && cfg.SUPABASE_URL.startsWith("https://") &&
  typeof cfg.SUPABASE_ANON_KEY === "string" && cfg.SUPABASE_ANON_KEY.length > 10;
let supabaseClient = null;
let currentUser = null;
if (configured && window.supabase) supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

function message(text) { $("#login-message").textContent = text || ""; }
function showPortal(profile) {
  $("#login").classList.add("hidden");
  $("#portal").classList.remove("hidden");
  $("#hello").textContent = `Welcome, ${profile.display_name || "LCFMS staff"}`;
  $("#user-name").textContent = profile.display_name || "Staff member";
  $("#rank-pill").textContent = profile.rank_name || "Approved staff";
  $("#today").textContent = new Intl.DateTimeFormat("en-GB", { dateStyle: "full" }).format(new Date());
  showPage("dashboard");
  loadWhitelistApplications();
}
function showPage(page) {
  document.querySelectorAll(".page").forEach(el => el.classList.toggle("active", el.id === `page-${page}`));
  document.querySelectorAll("[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === page && el.classList.contains("nav-link")));
  const active = document.querySelector(`.nav-link[data-page="${page}"]`);
  $("#crumb").textContent = active ? active.textContent.trim() : page;
  $("#sidebar").classList.remove("open");
}
async function loadProfile(user) {
  currentUser = user;
  const { data, error } = await supabaseClient.from("profiles")
    .select("display_name,rank_name,role,access_status").eq("id", user.id).single();
  if (error || !data || data.access_status !== "approved") {
    await supabaseClient.auth.signOut();
    message("Your account is awaiting approval or is not authorised. Contact LCFMS management.");
    return;
  }
  showPortal(data);
}
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); message("");
  if (!supabaseClient) { message("Database connection is not configured. Check config.js."); return; }
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: $("#email").value.trim(), password: $("#password").value
  });
  if (error) { message(error.message); return; }
  await loadProfile(data.user);
});
document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
$("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#signout").addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  $("#portal").classList.add("hidden"); $("#login").classList.remove("hidden"); $("#password").value = "";
});
(async () => {
  if (!configured || !window.supabase) { message("Setup required: check the Supabase project URL and publishable key in config.js."); return; }
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) await loadProfile(data.session.user);
})();

function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function loadWhitelistApplications(){
 const host=$("#whitelist-list"); if(!host||!supabaseClient||!currentUser)return;
 host.textContent="Loading whitelist applications…";
 const {data,error}=await supabaseClient.from("whitelist_applications").select("id,discord_user_id,roblox_username,status,submitted_at,review_note,answers").order("submitted_at",{ascending:false}).limit(100);
 if(error){host.textContent="Could not load applications: "+error.message;return;}
 const rows=data||[], n=s=>rows.filter(r=>r.status===s).length;
 $("#whitelist-pending-count").textContent=n("pending");$("#whitelist-approved-count").textContent=n("approved");$("#whitelist-rejected-count").textContent=n("rejected");
 if(!rows.length){host.textContent="No whitelist applications have been submitted yet.";return;}
 host.innerHTML=rows.map(r=>{
 const date=r.submitted_at?new Date(r.submitted_at).toLocaleString("en-GB"):"Date unavailable";
 const answers=r.answers&&typeof r.answers==="object"?Object.entries(r.answers).map(([k,v])=>"<div><b>"+esc(k)+":</b> "+esc(v)+"</div>").join(""):"";
 const actions=r.status==="pending"?'<div class="whitelist-actions"><button class="primary" data-review="approved" data-id="'+esc(r.id)+'">Approve</button><button class="review-reject" data-review="rejected" data-id="'+esc(r.id)+'">Reject</button></div>':"";
 return '<article class="whitelist-card"><div class="whitelist-top"><div><h3>'+esc(r.roblox_username)+'</h3><small>Discord ID: '+esc(r.discord_user_id)+' · '+esc(date)+'</small></div><span class="whitelist-status status-'+esc(r.status)+'">'+esc(r.status)+'</span></div>'+(answers?'<div class="whitelist-answers">'+answers+'</div>':"")+(r.review_note?'<p class="review-note">Review note: '+esc(r.review_note)+'</p>':"")+actions+'</article>';
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
