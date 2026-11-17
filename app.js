const $=s=>document.querySelector(s);
$("#year").textContent=new Date().getFullYear();
const cfg=window.LCFMS_CONFIG||{};
const configured=cfg.SUPABASE_URL?.startsWith("https://")&&!cfg.SUPABASE_URL.includes("PASTE_")&&cfg.SUPABASE_ANON_KEY&&!cfg.SUPABASE_ANON_KEY.includes("PASTE_");
let supabaseClient=null;
if(configured&&window.supabase){supabaseClient=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);}

function message(t){$("#login-message").textContent=t;}
function showPortal(profile){
  $("#login").classList.add("hidden");$("#portal").classList.remove("hidden");$("#signout").classList.remove("hidden");
  $("#hello").textContent=`Welcome, ${profile.display_name||"LCFMS staff"}`;
  $("#rank-pill").textContent=profile.rank_name||"Approved staff";
}
async function loadProfile(user){
  const {data,error}=await supabaseClient.from("profiles").select("display_name,rank_name,access_status").eq("id",user.id).single();
  if(error||!data||data.access_status!=="approved"){await supabaseClient.auth.signOut();message("Your account is awaiting approval or is not authorised. Contact LCFMS management.");return;}
  showPortal(data);
}
$("#login-form").addEventListener("submit",async e=>{
  e.preventDefault();message("");
  if(!supabaseClient){message("Database not connected yet. Follow SETUP-GUIDE.txt to connect Supabase.");return;}
  const {data,error}=await supabaseClient.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});
  if(error){message(error.message);return;}await loadProfile(data.user);
});
$("#signout").addEventListener("click",async()=>{if(supabaseClient)await supabaseClient.auth.signOut();$("#portal").classList.add("hidden");$("#login").classList.remove("hidden");$("#signout").classList.add("hidden");});
(async()=>{if(!configured){message("Setup required: connect your free Supabase project to enable staff sign-in.");return;}const {data}=await supabaseClient.auth.getSession();if(data.session)await loadProfile(data.session.user);})();
