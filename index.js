const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, InteractionType, ChannelType, PermissionsBitField 
} = require('discord.js');
const mongoose = require('mongoose');
const nblox = require('noblox.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// --- KẾT NỐI DATABASE ---
mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ MongoDB đã kết nối thành công!"));

const User = mongoose.model('User', new mongoose.Schema({
    discordId: String, 
    robloxId: String, 
    robloxName: String,
    elo: { type: Number, default: 1000 }, 
    wins: { type: Number, default: 0 }, 
    losses: { type: Number, default: 0 }
}));

// --- CẤU HÌNH HỆ THỐNG ---
const queues = { 
    "1v1": { p: [], lim: 2 }, 
    "2v2": { p: [], lim: 4 }, 
    "5v5": { p: [], lim: 10 } 
};
let activeMatches = [];
const teamNames = ["ALPHA", "OMEGA", "RADIANT", "DIRE", "STORM", "THUNDER", "TITAN", "PHOENIX", "COBRA", "VALOR"];

// Hàm lấy thông tin Rank dựa trên ELO
const getRankInfo = (elo) => {
    if (elo >= 1800) return { name: "LEGENDARY", color: 0xFFD700 };
    if (elo >= 1500) return { name: "SURGE", color: 0xFF0000 };
    if (elo >= 1200) return { name: "TRACE", color: 0x00FF00 };
    return { name: "UNRANKED", color: 0x888888 };
};

client.on('ready', () => console.log(`🚀 Bot Ranked sẵn sàng: ${client.user.tag}`));

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const args = message.content.split(' ');

    // --- LỆNH THAM GIA HÀNG CHỜ (!j 1v1|2v2|5v5) ---
    if (args[0] === '!j') {
        const mode = args[1];
        if (!queues[mode]) return message.reply("❌ Cú pháp: `!j 1v1`, `!j 2v2` hoặc `!j 5v5`!");

        const userData = await User.findOne({ discordId: message.author.id });
        if (!userData) return message.reply("❌ Bạn chưa xác minh! Hãy nhấn nút **Verify** trước.");
        
        // Kiểm tra xem đã ở trong hàng chờ nào chưa
        if (Object.values(queues).some(q => q.p.find(p => p.id === message.author.id))) {
            return message.reply("⚠️ Bạn đang ở trong một hàng chờ rồi!");
        }

        queues[mode].p.push({ id: message.author.id, name: userData.robloxName, elo: userData.elo });
        
        const qEmbed = new EmbedBuilder()
            .setTitle(`🎮 QUEUE: ${mode}`)
            .setDescription(`**${userData.robloxName}** đã tham gia!\n📊 Trạng thái: **${queues[mode].p.length}/${queues[mode].lim}**`)
            .setColor(0x00AAFF);
        message.channel.send({ embeds: [qEmbed] });

        // XỬ LÝ KHI ĐỦ NGƯỜI
        if (queues[mode].p.length === queues[mode].lim) {
            const players = [...queues[mode].p].sort(() => 0.5 - Math.random());
            const mid = players.length / 2;
            const matchId = Math.floor(1000 + Math.random() * 9000);
            
            const randNames = teamNames.sort(() => 0.5 - Math.random());
            const name1 = randNames[0];
            const name2 = randNames[1];

            // Tạo Voice Channels
            const category = message.guild.channels.cache.find(c => c.name.toUpperCase() === 'RANKED') || null;
            const v1 = await message.guild.channels.create({ name: `🟦 Đội ${name1} - #${matchId}`, type: ChannelType.GuildVoice, parent: category?.id });
            const v2 = await message.guild.channels.create({ name: `🟥 Đội ${name2} - #${matchId}`, type: ChannelType.GuildVoice, parent: category?.id });

            const matchData = {
                id: matchId, mode,
                t1Name: name1, t1Players: players.slice(0, mid),
                t2Name: name2, t2Players: players.slice(mid),
                voices: [v1.id, v2.id]
            };
            activeMatches.push(matchData);

            // Move Members vào Voice
            for (const p of matchData.t1Players) {
                const mem = await message.guild.members.fetch(p.id).catch(() => null);
                if (mem?.voice.channel) mem.voice.setChannel(v1).catch(() => {});
            }
            for (const p of matchData.t2Players) {
                const mem = await message.guild.members.fetch(p.id).catch(() => null);
                if (mem?.voice.channel) mem.voice.setChannel(v2).catch(() => {});
            }

            const matchFoundEmbed = new EmbedBuilder()
                .setTitle(`⚔️ MATCH FOUND: ${mode} (ID: ${matchId})`)
                .setDescription("🔥 Trận đấu đã sẵn sàng! Bot đã tự động chia phòng Voice.")
                .addFields(
                    { name: `🟦 TEAM ${name1}`, value: matchData.t1Players.map(p => `• ${p.name}`).join('\n'), inline: true },
                    { name: `🟥 TEAM ${name2}`, value: matchData.t2Players.map(p => `• ${p.name}`).join('\n'), inline: true }
                )
                .setColor(0xFFAA00).setFooter({ text: `Admin sử dụng: !win ${matchId} [Tên Team Thắng]` });

            message.channel.send({ content: "@everyone", embeds: [matchFoundEmbed] });
            queues[mode].p = [];
        }
    }

    // --- LỆNH WIN (ADMIN): !win [ID] [Tên_Team] ---
    if (args[0] === '!win' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const mId = parseInt(args[1]);
        const winnerInput = args[2]?.toUpperCase();
        const mIdx = activeMatches.findIndex(m => m.id === mId);

        if (mIdx === -1) return message.reply("❌ ID trận đấu không hợp lệ!");
        const match = activeMatches[mIdx];

        let winners, losers, winTeamName, loseTeamName;
        if (winnerInput === match.t1Name) {
            winners = match.t1Players; losers = match.t2Players;
            winTeamName = match.t1Name; loseTeamName = match.t2Name;
        } else if (winnerInput === match.t2Name) {
            winners = match.t2Players; losers = match.t1Players;
            winTeamName = match.t2Name; loseTeamName = match.t1Name;
        } else return message.reply(`❌ Team thắng phải là **${match.t1Name}** hoặc **${match.t2Name}**!`);

        let winResults = "";
        let loseResults = "";

        // Xử lý đội thắng + Gửi DM
        for (const p of winners) {
            const data = await User.findOneAndUpdate({ discordId: p.id }, { $inc: { elo: 25, wins: 1 } }, { new: true });
            winResults += `• **${p.name}**: +25 ELO\n`;
            
            const user = await client.users.fetch(p.id).catch(() => null);
            if (user) {
                const rank = getRankInfo(data.elo);
                const dm = new EmbedBuilder().setTitle("🏆 CHIẾN THẮNG!").setColor(0x00FF00)
                    .setDescription(`Trận **${match.mode}** (#${match.id}) đã xong.\n📈 ELO: **${data.elo}** (+25)\n🎖️ Rank: **${rank.name}**`);
                user.send({ embeds: [dm] }).catch(() => {});
            }
        }

        // Xử lý đội thua + Gửi DM
        for (const p of losers) {
            const data = await User.findOneAndUpdate({ discordId: p.id }, { $inc: { elo: -20, losses: 1 } }, { new: true });
            loseResults += `• **${p.name}**: -20 ELO\n`;
            
            const user = await client.users.fetch(p.id).catch(() => null);
            if (user) {
                const rank = getRankInfo(data.elo);
                const dm = new EmbedBuilder().setTitle("❌ THẤT BẠI!").setColor(0xFF0000)
                    .setDescription(`Trận **${match.mode}** (#${match.id}) đã xong.\n📉 ELO: **${data.elo}** (-20)\n🎖️ Rank: **${rank.name}**`);
                user.send({ embeds: [dm] }).catch(() => {});
            }
        }

        // Xóa phòng Voice
        match.voices.forEach(id => message.guild.channels.cache.get(id)?.delete().catch(() => {}));
        
        // --- EMBED KẾT QUẢ (ẢNH 4) ---
        const resultEmbed = new EmbedBuilder()
            .setTitle("🔒 MATCH ENDED")
            .setDescription(`## 🏆 WINNER: TEAM ${winTeamName}\n**ID:** ${match.id} | **Mode:** ${match.mode}`)
            .addFields(
                { name: `🟦 Đội ${winTeamName} (WIN)`, value: winResults, inline: true },
                { name: `🟥 Đội ${loseTeamName} (LOSS)`, value: loseResults, inline: true }
            )
            .setColor(0x5865F2).setTimestamp();
        
        message.channel.send({ embeds: [resultEmbed] });
        activeMatches.splice(mIdx, 1);
    }

    // --- LỆNH SETUP & STATS ---
    if (message.content === '!setup-verify') {
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('v').setLabel('Verify Account').setStyle(ButtonStyle.Success));
        const embed = new EmbedBuilder().setTitle("🔒 PrimeBlox Verification").setDescription("Nhấn nút bên dưới để liên kết với tài khoản Roblox của bạn.").setColor(0xFFAA00);
        message.channel.send({ embeds: [embed], components: [row] });
    }

    if (args[0] === '!stats') {
        const target = message.mentions.users.first() || message.author;
        const data = await User.findOne({ discordId: target.id });
        if (!data) return message.reply("Người chơi này chưa xác minh!");
        const rank = getRankInfo(data.elo);
        const embed = new EmbedBuilder().setAuthor({ name: `${data.robloxName}'s Stats`, iconURL: target.displayAvatarURL() })
            .setColor(rank.color).addFields(
                { name: '🎖️ Rank', value: rank.name, inline: true },
                { name: '📊 ELO', value: `${data.elo}`, inline: true },
                { name: '🏆 W/L', value: `${data.wins}W - ${data.losses}L`, inline: true }
            );
        message.reply({ embeds: [embed] });
    }
});

// --- XỬ LÝ VERIFY MODAL ---
client.on('interactionCreate', async (i) => {
    if (i.customId === 'v') {
        const m = new ModalBuilder().setCustomId('vm').setTitle('Verify Account');
        const input = new TextInputBuilder().setCustomId('n').setLabel("Nhập Username Roblox").setStyle(TextInputStyle.Short).setRequired(true);
        m.addComponents(new ActionRowBuilder().addComponents(input));
        await i.showModal(m);
    }
    if (i.type === InteractionType.ModalSubmit && i.customId === 'vm') {
        const name = i.fields.getTextInputValue('n');
        try {
            const id = await nblox.getIdFromUsername(name);
            await User.findOneAndUpdate({ discordId: i.user.id }, { robloxName: name, robloxId: id.toString() }, { upsert: true });
            i.reply({ content: `✅ Đã xác minh thành công: **${name}**`, ephemeral: true });
        } catch { i.reply({ content: "❌ Không tìm thấy tên Roblox!", ephemeral: true }); }
    }
});

client.login(process.env.DISCORD_TOKEN);cess.env.DISCORD_TOKEN);
