require("dotenv").config();
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

const required=["DISCORD_BOT_TOKEN","DISCORD_CLIENT_ID","DISCORD_GUILD_ID","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
for(const key of required) if(!process.env[key]) throw new Error("Missing environment variable: "+key);

const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
const commands=[
 new SlashCommandBuilder().setName("member").setDescription("Check your LCFMS member number")
].map(c=>c.toJSON());

async function getMemberRecord(discordUserId){
 const {data,error}=await db.from("discord_members").select("*").eq("discord_user_id",discordUserId).maybeSingle();
 if(error) throw error;
 return data;
}
async function syncNickname(member,record){
 if(!record||!record.member_number)return;
 const nickname=record.custom_nickname||`[${String(record.member_number).padStart(4,"0")}] ${record.custom_prefix?record.custom_prefix+" ":""}${record.discord_display_name||record.discord_username}${record.custom_suffix?" "+record.custom_suffix:""}`;
 if(member.manageable&&member.nickname!==nickname) await member.setNickname(nickname.slice(0,32),"LCFMS approved member number");
}

// Keep Supabase's reviewer roster in sync with the configured Discord role.
async function syncWhitelistReviewerRole(){
 const roleId=process.env.DISCORD_WHITELIST_REVIEW_ROLE_ID || "1572689837176131696";
 if(!roleId) return;
 const guild=await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
 await guild.members.fetch();
 const role=await guild.roles.fetch(roleId);
 if(!role) throw new Error("Whitelist reviewer role not found: "+roleId);
 const reviewers=[...role.members.values()].filter(m=>!m.user.bot).map(m=>({
  discord_user_id:m.id,
  role_id:roleId,
  synced_at:new Date().toISOString()
 }));
 const {error:deleteError}=await db.from("discord_whitelist_reviewers").delete().eq("role_id",roleId);
 if(deleteError) throw deleteError;
 if(reviewers.length){
  const {error:insertError}=await db.from("discord_whitelist_reviewers").upsert(reviewers,{onConflict:"discord_user_id"});
  if(insertError) throw insertError;
 }
 console.log("Whitelist reviewer role synced:",reviewers.length,"members");
}

// Approved website applications are the only trigger for allocating a new number.
async function processApprovedApplications(){
 const {data:applications,error}=await db.from("whitelist_applications")
  .select("id,discord_user_id,roblox_username,status")
  .eq("status","approved").not("discord_user_id","is",null).limit(100);
 if(error) throw error;
 const guild=await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
 for(const application of applications||[]){
  try{
   const member=await guild.members.fetch(application.discord_user_id).catch(()=>null);
   if(!member||member.user.bot) continue;
   let record=await getMemberRecord(member.id);
   if(!record){
    const {error:allocationError}=await db.rpc("lcfms_allocate_member_number",{
     p_discord_user_id:member.id,
     p_username:member.user.username,
     p_display_name:member.displayName||member.user.username
    });
    if(allocationError) throw allocationError;
    record=await getMemberRecord(member.id);
   }
   const {error:updateError}=await db.from("discord_members").update({
    whitelist_status:"approved",
    roblox_username:application.roblox_username,
    updated_at:new Date().toISOString()
   }).eq("discord_user_id",member.id);
   if(updateError) throw updateError;
   await syncNickname(member,record);
   if(process.env.DISCORD_WHITELIST_ROLE_ID){
    const role=await guild.roles.fetch(process.env.DISCORD_WHITELIST_ROLE_ID);
    if(role&&!member.roles.cache.has(role.id)) await member.roles.add(role,"LCFMS website whitelist approved");
   }
  }catch(error){console.error("Approved whitelist sync failed",application.id,application.discord_user_id,error.message);}
 }
}

client.once(Events.ClientReady,async ready=>{
 console.log("LCFMS bot online as "+ready.user.tag);
 const rest=new REST({version:"10"}).setToken(process.env.DISCORD_BOT_TOKEN);
 await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,process.env.DISCORD_GUILD_ID),{body:commands});
 const guild=await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
 await guild.members.fetch();
 // Existing records are only synced; no number is created just because someone joined.
 for(const member of guild.members.cache.values()){
  if(member.user.bot) continue;
  try{
   const record=await getMemberRecord(member.id);
   if(record&&record.member_number) await syncNickname(member,record);
  }catch(error){console.error("Existing member sync failed",member.id,error.message);}
 }
 await processApprovedApplications();
 await syncWhitelistReviewerRole().catch(error=>console.error("Whitelist reviewer role sync failed:",error.message));
 setInterval(()=>processApprovedApplications().catch(error=>console.error("Whitelist approval scan failed",error.message)),15000);
 setInterval(()=>syncWhitelistReviewerRole().catch(error=>console.error("Whitelist reviewer role sync failed:",error.message)),60000);
});

client.on(Events.GuildMemberAdd,member=>{
 if(member.guild.id!==process.env.DISCORD_GUILD_ID||member.user.bot)return;
 console.log("New member joined; no number assigned until website whitelist approval:",member.id);
});

client.on(Events.InteractionCreate,async interaction=>{
 if(!interaction.isChatInputCommand())return;
 try{
  if(interaction.commandName!=="member")return;
  const record=await getMemberRecord(interaction.user.id);
  if(!record||!record.member_number){
   return interaction.reply({content:"You don't have an LCFMS member number yet. Submit your whitelist application on the LCFMS website. A number is assigned only after an authorised manager approves it.",ephemeral:true});
  }
  return interaction.reply({content:`Your LCFMS member number is **[${String(record.member_number).padStart(4,"0")}]**.`,ephemeral:true});
 }catch(error){
  console.error(error);
  const reply={content:"Something went wrong. Please contact LCFMS management.",ephemeral:true};
  if(interaction.replied||interaction.deferred)return interaction.followUp(reply);
  return interaction.reply(reply);
 }
});

client.login(process.env.DISCORD_BOT_TOKEN);
