require("dotenv").config();
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
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
 if(!record||!record.member_number||!member.manageable)return;
 const nickname=(record.nickname||record.custom_nickname||`[${String(record.member_number).padStart(4,"0")}] ${record.custom_prefix?record.custom_prefix+" ":""}${record.discord_display_name||record.discord_username}${record.custom_suffix?" "+record.custom_suffix:""}`).slice(0,32);
 if(member.nickname!==nickname) await member.setNickname(nickname,"LCFMS member number updated");
 const {error}=await db.from("discord_members").update({nickname_sync_pending:false}).eq("discord_user_id",member.id);
 if(error) throw error;
}

async function processPendingNicknameUpdates(){
 const {data,error}=await db.from("discord_members")
  .select("discord_user_id,member_number,nickname,custom_nickname,custom_prefix,custom_suffix,discord_display_name,discord_username")
  .eq("nickname_sync_pending",true).limit(50);
 if(error) throw error;
 if(!data?.length)return;
 const guild=await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
 for(const record of data){
  try{
   const member=await guild.members.fetch(record.discord_user_id);
   if(!member)continue;
   await syncNickname(member,record);
   console.log("Discord nickname synced:",record.discord_user_id,record.member_number);
  }catch(error){console.error("Discord nickname sync failed:",record.discord_user_id,error.message);}
 }
}

// Keep Supabase's reviewer roster in sync with the configured Discord role.
async function syncWhitelistReviewerRole(){
 const roleId=process.env.DISCORD_WHITELIST_REVIEW_ROLE_ID || "1572689837176131696";
 const guildId=process.env.DISCORD_GUILD_ID;
 if(!roleId) return;
 const reviewers=[];
 let after="0";
 while(true){
  const response=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`,{headers:{Authorization:`Bot ${process.env.DISCORD_BOT_TOKEN}`}});
  if(!response.ok) throw new Error(`Discord member-list HTTP ${response.status}: ${await response.text()}`);
  const page=await response.json();
  if(!Array.isArray(page)||page.length===0) break;
  for(const member of page){
   if(member.user&&!member.user.bot&&Array.isArray(member.roles)&&member.roles.includes(roleId)){
    reviewers.push({discord_user_id:member.user.id,role_id:roleId,synced_at:new Date().toISOString()});
   }
  }
  after=page[page.length-1].user.id;
  if(page.length<1000) break;
 }
 const {error:deleteError}=await db.from("discord_whitelist_reviewers").delete().eq("role_id",roleId);
 if(deleteError) throw deleteError;
 if(reviewers.length){
  const {error:insertError}=await db.from("discord_whitelist_reviewers").upsert(reviewers,{onConflict:"discord_user_id"});
  if(insertError) throw insertError;
 }
 console.log("Whitelist reviewer role synced:",reviewers.length,"members");
}


const TRAINING_CHANNEL_ID=process.env.DISCORD_TRAINING_CHANNEL_ID||"1562246158472978462";
function trainingEmbed(notice,playerCount=0){
 const date=notice.training_date?new Date(notice.training_date+"T00:00:00").toLocaleDateString("en-GB"):"Not set";
 const time=String(notice.training_time||"").slice(0,5)||"Not set";
 return new EmbedBuilder()
  .setColor(0x263f56)
  .setTitle("📋 Training Notice — "+notice.module_name)
  .setDescription("A new London Central training session has been scheduled. Use the buttons below to register or withdraw.")
  .addFields(
   {name:"Training module:",value:notice.module_name||"—",inline:false},
   {name:"Date:",value:date,inline:true},
   {name:"Time:",value:time,inline:true},
   {name:"Prerequisites:",value:notice.prerequisites||"None",inline:false},
   {name:"Players:",value:`${playerCount} / ${notice.maximum_trainees??"—"}`,inline:true},
   {name:"Maximum trainees:",value:String(notice.maximum_trainees??"—"),inline:true},
   {name:"Trainer(s):",value:notice.trainers||"—",inline:false},
   {name:"Observer(s):",value:notice.observers_na?"N/A":(notice.observers||"—"),inline:false},
   {name:"Location for training:",value:notice.location||"Waiting Room",inline:false}
  )
  .setFooter({text:"LCFMS • Training and Development"});
}
function trainingButtons(id){
 return new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("training_signup:"+id).setLabel("Sign Up").setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId("training_withdraw:"+id).setLabel("Withdraw").setStyle(ButtonStyle.Primary)
 );
}
async function getTrainingPlayerCount(noticeId){
 const {count,error}=await db.from("training_notice_signups").select("id",{count:"exact",head:true}).eq("training_notice_id",noticeId);
 if(error)throw error;
 return count||0;
}
async function refreshTrainingNoticeMessage(noticeId){
 const {data:notice,error}=await db.from("training_notices")
  .select("id,module_name,training_date,training_time,prerequisites,maximum_trainees,trainers,observers,observers_na,location,discord_message_id,discord_channel_id")
  .eq("id",noticeId).maybeSingle();
 if(error)throw error;
 if(!notice?.discord_message_id||!notice.discord_channel_id)return;
 const count=await getTrainingPlayerCount(noticeId);
 const channel=await client.channels.fetch(notice.discord_channel_id);
 if(!channel||!channel.isTextBased())throw new Error("Training notice channel is unavailable.");
 const message=await channel.messages.fetch(notice.discord_message_id);
 await message.edit({embeds:[trainingEmbed(notice,count)],components:[trainingButtons(noticeId)]});
 console.log("Training player counter updated:",noticeId,count);
}
async function publishPendingTrainingNotices(){
 const {data:notices,error}=await db.from("training_notices")
  .select("id,module_name,training_date,training_time,prerequisites,maximum_trainees,trainers,observers,observers_na,location")
  .is("discord_message_id",null).order("created_at",{ascending:true}).limit(10);
 if(error)throw error;
 if(!notices?.length)return;
 const channel=await client.channels.fetch(TRAINING_CHANNEL_ID);
 if(!channel||!channel.isTextBased())throw new Error("Training notices channel is unavailable or not a text channel.");
 for(const notice of notices){
  try{
   const playerCount=await getTrainingPlayerCount(notice.id);
   const message=await channel.send({embeds:[trainingEmbed(notice,playerCount)],components:[trainingButtons(notice.id)]});
   const {error:updateError}=await db.from("training_notices").update({
    discord_message_id:message.id,discord_channel_id:channel.id
   }).eq("id",notice.id).is("discord_message_id",null);
   if(updateError)throw updateError;
   console.log("Training notice published to Discord:",notice.id,message.id);
  }catch(error){console.error("Training notice publish failed:",notice.id,error.message);}
 }
}
async function handleTrainingButton(interaction){
 const [action,noticeId]=interaction.customId.split(":");
 if(!["training_signup","training_withdraw"].includes(action)||!noticeId)return false;
 const {data:notice,error:noticeError}=await db.from("training_notices")
  .select("id,module_name,maximum_trainees").eq("id",noticeId).maybeSingle();
 if(noticeError||!notice)return interaction.reply({content:"This training notice is no longer available.",ephemeral:true}),true;
 // Check the synced member record first, then the authoritative approved whitelist application.
 const {data:member,error:memberError}=await db.from("discord_members")
  .select("whitelist_status").eq("discord_user_id",interaction.user.id).maybeSingle();
 if(memberError) throw memberError;
 let isApproved=interaction.user.id==="960821533922705408"||member?.whitelist_status==="approved";
 if(!isApproved){
  const {data:application,error:applicationError}=await db.from("whitelist_applications")
   .select("id").eq("discord_user_id",interaction.user.id).eq("status","approved").limit(1).maybeSingle();
  if(applicationError) throw applicationError;
  isApproved=!!application;
 }
 if(!isApproved)
  return interaction.reply({content:"Only approved LCFMS members can register for training.",ephemeral:true}),true;
 if(action==="training_withdraw"){
  const {error}=await db.from("training_notice_signups").delete()
   .eq("training_notice_id",noticeId).eq("discord_user_id",interaction.user.id);
  if(error)return interaction.reply({content:"Your withdrawal could not be processed. Please try again.",ephemeral:true}),true;
  await refreshTrainingNoticeMessage(noticeId).catch(error=>console.error("Training counter refresh failed after withdrawal:",error.message));
  return interaction.reply({content:"You have withdrawn from **"+notice.module_name+"**.",ephemeral:true}),true;
 }
 const {data:signupResult,error:signupError}=await db.rpc("lcfms_training_signup",{
  p_training_notice_id:noticeId,
  p_discord_user_id:interaction.user.id,
  p_discord_username:interaction.user.username
 });
 if(signupError)return interaction.reply({content:"Your sign-up could not be saved. Please try again.",ephemeral:true}),true;
 if(signupResult==="full")return interaction.reply({content:"Sorry, this training session has reached its maximum number of trainees.",ephemeral:true}),true;
 if(signupResult==="already_signed_up")return interaction.reply({content:"You are already signed up for this training.",ephemeral:true}),true;
 if(signupResult!=="signed_up")return interaction.reply({content:"This training notice is no longer available.",ephemeral:true}),true;
 await refreshTrainingNoticeMessage(noticeId).catch(error=>console.error("Training counter refresh failed after sign-up:",error.message));
 return interaction.reply({content:"You are signed up for **"+notice.module_name+"**. See you there!",ephemeral:true}),true;
}

// Approved website applications are the only trigger for allocating a new number.
async function processApprovedApplications(){
 const {data:applications,error}=await db.from("whitelist_applications")
  .select("id,discord_user_id,roblox_username,status")
  .eq("status","approved").is("processed_at",null).not("discord_user_id","is",null).limit(100);
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
   const {error:processedError}=await db.from("whitelist_applications")
    .update({processed_at:new Date().toISOString()}).eq("id",application.id).eq("status","approved");
   if(processedError) throw processedError;
   console.log("Whitelist application synced:",application.id,application.discord_user_id);
  }catch(error){console.error("Approved whitelist sync failed",application.id,application.discord_user_id,error.message);}
 }
}

client.once(Events.ClientReady,async ready=>{
 console.log("LCFMS bot online as "+ready.user.tag);
 const rest=new REST({version:"10"}).setToken(process.env.DISCORD_BOT_TOKEN);
 await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,process.env.DISCORD_GUILD_ID),{body:commands});
 const guild=await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
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
 setInterval(()=>processPendingNicknameUpdates().catch(error=>console.error("Pending nickname sync failed",error.message)),10000);
 // Publish website-created training notices to the configured Discord channel.
 await publishPendingTrainingNotices().catch(error=>console.error("Initial training notice publish failed:",error.message));
 setInterval(()=>publishPendingTrainingNotices().catch(error=>console.error("Training notice publish failed:",error.message)),10000);
 setInterval(()=>syncWhitelistReviewerRole().catch(error=>console.error("Whitelist reviewer role sync failed:",error.message)),60000);
});

client.on(Events.GuildMemberAdd,member=>{
 if(member.guild.id!==process.env.DISCORD_GUILD_ID||member.user.bot)return;
 console.log("New member joined; no number assigned until website whitelist approval:",member.id);
});

client.on(Events.InteractionCreate,async interaction=>{
 if(interaction.isButton()){
  try{if(await handleTrainingButton(interaction))return;}catch(error){console.error("Training button failed:",error);if(!interaction.replied)await interaction.reply({content:"Something went wrong. Please contact LCFMS management.",ephemeral:true}).catch(()=>{});}
  return;
 }
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
