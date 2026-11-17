require("dotenv").config();
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");

const required=["DISCORD_BOT_TOKEN","DISCORD_CLIENT_ID","DISCORD_GUILD_ID","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
for(const key of required) if(!process.env[key]) throw new Error("Missing environment variable: "+key);

const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
const commands=[
 new SlashCommandBuilder().setName("whitelist").setDescription("Submit a Roblox whitelist application")
  .addStringOption(o=>o.setName("roblox_username").setDescription("Your Roblox username").setRequired(true))
  .addStringOption(o=>o.setName("reason").setDescription("Why you are applying").setRequired(false)),
 new SlashCommandBuilder().setName("member").setDescription("Show your LCFMS member number")
].map(c=>c.toJSON());

async function ensureMember(member){
 const {data:existing,error:readError}=await db.from("discord_members").select("*").eq("discord_user_id",member.id).maybeSingle();
 if(readError) throw readError;
 if(existing) return existing;
 const displayName=member.displayName||member.user.username;
 const {data:allocated,error:allocateError}=await db.rpc("lcfms_allocate_member_number",{
  p_discord_user_id:member.id,p_username:member.user.username,p_display_name:displayName
 });
 if(allocateError) throw allocateError;
 const {data,error}=await db.from("discord_members").select("*").eq("discord_user_id",member.id).single();
 if(error) throw error;
 return data;
}
async function syncNickname(member,record){
 const nickname=record.custom_nickname||`[${String(record.member_number).padStart(4,"0")}] ${record.custom_prefix?record.custom_prefix+" ":""}${record.discord_display_name||record.discord_username}${record.custom_suffix?" "+record.custom_suffix:""}`;
 if(member.manageable&&member.nickname!==nickname) await member.setNickname(nickname.slice(0,32),"LCFMS member number");
}
client.once(Events.ClientReady,async ready=>{
 console.log("LCFMS bot online as "+ready.user.tag);
 const rest=new REST({version:"10"}).setToken(process.env.DISCORD_BOT_TOKEN);
 await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,process.env.DISCORD_GUILD_ID),{body:commands});
 const guild=await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
 await guild.members.fetch();
 for(const member of guild.members.cache.values()){
  if(member.user.bot) continue;
  try{const record=await ensureMember(member);await syncNickname(member,record);}
  catch(error){console.error("Member sync failed",member.id,error.message);}
 }
});
client.on(Events.GuildMemberAdd,async member=>{
 if(member.guild.id!==process.env.DISCORD_GUILD_ID||member.user.bot)return;
 try{const record=await ensureMember(member);await syncNickname(member,record);}
 catch(error){console.error("New member setup failed",member.id,error.message);}
});
client.on(Events.InteractionCreate,async interaction=>{
 if(!interaction.isChatInputCommand())return;
 try{
  if(interaction.commandName==="member"){
   const member=await interaction.guild.members.fetch(interaction.user.id);
   const record=await ensureMember(member);
   return interaction.reply({content:`Your LCFMS member number is **[${record.member_number}]**.`,ephemeral:true});
  }
  if(interaction.commandName==="whitelist"){
   const member=await interaction.guild.members.fetch(interaction.user.id);
   const record=await ensureMember(member);
   const username=interaction.options.getString("roblox_username",true).trim();
   const reason=interaction.options.getString("reason")||null;
   const {error:updateError}=await db.from("discord_members").update({roblox_username:username,whitelist_status:"pending",updated_at:new Date().toISOString()}).eq("discord_user_id",interaction.user.id);
   if(updateError)throw updateError;
   const {error}=await db.from("whitelist_applications").insert({discord_user_id:interaction.user.id,roblox_username:username,reason,status:"pending"});
   if(error)throw error;
   if(process.env.DISCORD_REVIEW_CHANNEL_ID){
    const channel=await interaction.guild.channels.fetch(process.env.DISCORD_REVIEW_CHANNEL_ID);
    if(channel?.isTextBased())await channel.send(`**New LCFMS whitelist application**\nMember: <@${interaction.user.id}> [${record.member_number}]\nRoblox username: **${username}**\nReason: ${reason||"Not supplied"}\nReview in the LCFMS dashboard.`);
   }
   return interaction.reply({content:"Your application has been submitted and is awaiting an authorised LCFMS review. No access has been granted yet.",ephemeral:true});
  }
 }catch(error){
  console.error(error);
  const reply={content:"Something went wrong. Please contact LCFMS management.",ephemeral:true};
  if(interaction.replied||interaction.deferred)return interaction.followUp(reply);
  return interaction.reply(reply);
 }
});
client.login(process.env.DISCORD_BOT_TOKEN);
