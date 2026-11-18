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

// Read-only lookup: joining Discord must never allocate a number.
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

client.once(Events.ClientReady,async ready=>{
 console.log("LCFMS bot online as "+ready.user.tag);
 const rest=new REST({version:"10"}).setToken(process.env.DISCORD_BOT_TOKEN);
 await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,process.env.DISCORD_GUILD_ID),{body:commands});
 const guild=await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
 await guild.members.fetch();
 for(const member of guild.members.cache.values()){
  if(member.user.bot) continue;
  try{
   const record=await getMemberRecord(member.id);
   if(record) await syncNickname(member,record);
  }catch(error){console.error("Existing member sync failed",member.id,error.message);}
 }
});

// New Discord members do not receive a number until their website application is approved.
client.on(Events.GuildMemberAdd,member=>{
 if(member.guild.id!==process.env.DISCORD_GUILD_ID||member.user.bot)return;
 console.log("New member joined; no number assigned until website whitelist approval:",member.id);
});

client.on(Events.InteractionCreate,async interaction=>{
 if(!interaction.isChatInputCommand()||interaction.commandName!=="member")return;
 try{
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
